package fileshttp

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"kiao/worker/internal/core/http"
	pkgContent "kiao/worker/internal/files/content"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func writeZip(t *testing.T, archivePath string, add func(t *testing.T, w *zip.Writer)) {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	add(t, w)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, archivePath, buf.Bytes())
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func zipFile(t *testing.T, w *zip.Writer, name, content string) {
	t.Helper()
	fw, err := w.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(fw, content); err != nil {
		t.Fatal(err)
	}
}

func TestUnzipKeepsStructureBesideTheArchive(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	writeZip(t, filepath.Join(root, "docs", "bundle.zip"), func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "readme.md", "readme")
		zipFile(t, w, "notes/2024/may.md", "may")
	})

	result, err := svc.Unzip("docs/bundle.zip", false, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Extracted) != 2 || result.Extracted[0] != "docs/readme.md" || result.Extracted[1] != "docs/notes/2024/may.md" {
		t.Errorf("extracted = %v, want [docs/readme.md docs/notes/2024/may.md]", result.Extracted)
	}
	if got := mustRead(t, filepath.Join(root, "docs", "notes", "2024", "may.md")); got != "may" {
		t.Errorf("nested file = %q, want %q", got, "may")
	}
	if _, err := os.Stat(filepath.Join(root, "docs", "bundle.zip")); err != nil {
		t.Errorf("the archive should still be there: %v", err)
	}
}

func TestUnzipOverwritesAndDeletesOnAsk(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "old.md"), "stale")
	writeZip(t, filepath.Join(root, "bundle.zip"), func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "old.md", "fresh")
	})

	if _, err := svc.Unzip("bundle.zip", true, 1<<20); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(root, "old.md")); got != "fresh" {
		t.Errorf("old.md = %q, want %q", got, "fresh")
	}
	if _, err := os.Stat(filepath.Join(root, "bundle.zip")); !os.IsNotExist(err) {
		t.Errorf("the archive should be gone, stat err = %v", err)
	}
}

func TestUnzipRefusals(t *testing.T) {
	writeSymlink := func(t *testing.T, w *zip.Writer) {
		t.Helper()
		header := &zip.FileHeader{Name: "link", Method: zip.Store}
		header.SetMode(os.ModeSymlink | 0o777)
		fw, err := w.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(fw, "target"); err != nil {
			t.Fatal(err)
		}
	}
	cases := []struct {
		name    string
		archive string
		add     func(t *testing.T, w *zip.Writer)
		setup   func(t *testing.T, root string)
		wantErr error
	}{
		{"parent escape", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			zipFile(t, w, "ok.md", "ok")
			zipFile(t, w, "../evil.md", "evil")
		}, nil, pkgContent.ErrZipEntry},
		{"absolute entry", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			zipFile(t, w, "/tmp/evil.md", "evil")
		}, nil, pkgContent.ErrZipEntry},
		{"symlink entry", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			writeSymlink(t, w)
		}, nil, pkgContent.ErrZipEntry},
		{"over the archive itself", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			zipFile(t, w, "bundle.zip", "itself")
		}, nil, pkgContent.ErrZipEntry},
		{"file over a folder", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			zipFile(t, w, "sub", "file")
		}, func(t *testing.T, root string) { mustMkdir(t, root, "sub") }, pkgContent.ErrZipEntry},
		{"folder over a file", "bundle.zip", func(t *testing.T, w *zip.Writer) {
			zipFile(t, w, "taken/nested.md", "nested")
		}, func(t *testing.T, root string) { mustWrite(t, filepath.Join(root, "taken"), "file") }, pkgContent.ErrZipEntry},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			svc := newTestService(root)
			if c.setup != nil {
				c.setup(t, root)
			}
			writeZip(t, filepath.Join(root, c.archive), c.add)
			before := dirNames(t, root)

			if _, err := svc.Unzip(c.archive, false, 1<<20); !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
			// A refused archive writes nothing: not even the entries that would have landed.
			if after := dirNames(t, root); len(after) != len(before) {
				t.Errorf("root holds %v after a refused unzip, want %v", after, before)
			}
		})
	}
}

func TestUnzipRefusesWhatIsNotAZip(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	mustWrite(t, filepath.Join(root, "notes.txt"), "plain text")
	mustMkdir(t, root, "folder")

	if _, err := svc.Unzip("notes.txt", false, 1<<20); !errors.Is(err, pkgContent.ErrNotZip) {
		t.Errorf("plain text: err = %v, want %v", err, pkgContent.ErrNotZip)
	}
	if _, err := svc.Unzip("folder", false, 1<<20); !errors.Is(err, pkgContent.ErrNotZip) {
		t.Errorf("folder: err = %v, want %v", err, pkgContent.ErrNotZip)
	}
	if _, err := svc.Unzip("missing.zip", false, 1<<20); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("missing: err = %v, want %v", err, os.ErrNotExist)
	}
}

// The declared sizes are checked before anything is written; the streamed total is capped while
// writing, for headers that lie. Both refusals are 413s naming the limit.
func TestUnzipSizeCap(t *testing.T) {
	root := t.TempDir()
	svc := newTestService(root)
	writeZip(t, filepath.Join(root, "big.zip"), func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "big.bin", string(make([]byte, 1024)))
	})

	_, err := svc.Unzip("big.zip", false, 100)
	var httpErr *httpkit.HTTPError
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("err = %v, want a 413", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "big.bin")); !os.IsNotExist(statErr) {
		t.Errorf("an oversize archive should write nothing")
	}
}

func TestWriteUnzippedCapsTheStreamedTotal(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "a.zip")
	writeZip(t, archive, func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "data.bin", string(make([]byte, 64)))
	})
	zr, err := zip.OpenReader(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()

	target := pkgContent.UnzipTarget{Entry: zr.File[0], Rel: "data.bin", Abs: filepath.Join(root, "data.bin")}
	if _, err := pkgContent.WriteUnzipped(target, 10, 100); err == nil {
		t.Fatalf("expected a 413, got nil")
	} else {
		var httpErr *httpkit.HTTPError
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusRequestEntityTooLarge {
			t.Fatalf("err = %v, want a 413", err)
		}
	}
}

func TestHandlerUnzip(t *testing.T) {
	s, root := newFileTestServer(t)
	writeZip(t, filepath.Join(root, "bundle.zip"), func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "a.md", "a")
		zipFile(t, w, "sub/b.md", "b")
	})

	req := httptest.NewRequest(http.MethodPost, "/unzip?path=bundle.zip", nil)
	rec := do(s, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var result pkgContent.UnzipResultDto
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Extracted) != 2 || result.Extracted[0] != "a.md" || result.Extracted[1] != "sub/b.md" {
		t.Errorf("extracted = %v, want [a.md sub/b.md]", result.Extracted)
	}
}

func TestHandlerUnzipDeletesTheArchiveOnAsk(t *testing.T) {
	s, root := newFileTestServer(t)
	writeZip(t, filepath.Join(root, "bundle.zip"), func(t *testing.T, w *zip.Writer) {
		zipFile(t, w, "a.md", "a")
	})

	req := httptest.NewRequest(http.MethodPost, "/unzip?path=bundle.zip&deleteArchive=true", nil)
	if rec := do(s, req); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "bundle.zip")); !os.IsNotExist(err) {
		t.Errorf("the archive should be gone, stat err = %v", err)
	}
	if got := mustRead(t, filepath.Join(root, "a.md")); got != "a" {
		t.Errorf("a.md = %q, want %q", got, "a")
	}
}

func TestHandlerUnzipStatusPins(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "notes.txt"), "plain text")
	cases := []struct {
		target string
		want   int
	}{
		{"/unzip?path=../escape", http.StatusBadRequest},
		{"/unzip?path=missing.zip", http.StatusNotFound},
		{"/unzip?path=notes.txt", http.StatusBadRequest},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, c.target, nil)
		if got := do(s, req).Code; got != c.want {
			t.Errorf("POST %s: status = %d, want %d", c.target, got, c.want)
		}
	}
}
