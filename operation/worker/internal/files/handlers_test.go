package files

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// newFileTestServer builds a Service wired for the file endpoints, rooted at a fresh temp
// directory. It returns the service and the root.
func newFileTestServer(t *testing.T) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	// The state directory is a temp directory of its own rather than <root>/.kiao-config: these tests
	// list and count the store root, and service state appearing there would break them for a reason
	// that has nothing to do with what they assert.
	cfg := &Config{Config: &core.Config{AuthMode: "debug", RootPath: root, StatePath: t.TempDir(), MaxUploadBytes: 1 << 20}}
	storage := &core.Storage{Root: root}
	return &Service{
		cfg:     cfg,
		files:   newFileService(storage, newLinkFixer(storage, []string{".md", ".txt"})),
		git:     newGitService(cfg),
		actions: newActionCatalog(),
		media:   newMediaCutter(storage),
	}, root
}

// ── core.StatusForError: the mapping is the contract ───────────────────────────────

func TestStatusForError(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantMsg    string // "" = don't assert the body
	}{
		{"outside root", core.ErrOutsideRoot, http.StatusBadRequest, core.ErrOutsideRoot.Error()},
		{"wrapped outside root", fmt.Errorf("save: %w", core.ErrOutsideRoot), http.StatusBadRequest, ""},
		{"not exist", os.ErrNotExist, http.StatusNotFound, os.ErrNotExist.Error()},
		{"wrapped not exist", &os.PathError{Op: "open", Path: "x", Err: os.ErrNotExist}, http.StatusNotFound, ""},
		{"not a directory", fmt.Errorf("%w: foo", core.ErrNotDirectory), http.StatusBadRequest, ""},
		{"bad pattern", fmt.Errorf("%w: [", errBadPattern), http.StatusBadRequest, ""},
		{"explicit httpError", &core.HTTPError{Status: http.StatusConflict, Msg: "conflict"}, http.StatusConflict, "conflict"},
		{"unknown → 500", errors.New("boom"), http.StatusInternalServerError, "internal error"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, msg := core.StatusForError(c.err)
			if status != c.wantStatus {
				t.Errorf("status = %d, want %d", status, c.wantStatus)
			}
			if c.wantMsg != "" && msg != c.wantMsg {
				t.Errorf("msg = %q, want %q", msg, c.wantMsg)
			}
		})
	}
}

// ── handler status pins: invalid path → 400, missing → 404, bad regex → 400 ────

func TestHandlerInvalidPathIsBadRequest(t *testing.T) {
	s, _ := newFileTestServer(t)
	cases := []struct{ method, target string }{
		{http.MethodGet, "/list?path=../escape"},
		{http.MethodGet, "/listRecursive?path=../escape"},
		{http.MethodGet, "/getFile?path=../escape"},
		{http.MethodPost, "/rename?path=../escape&newPath=ok.md"},
		{http.MethodDelete, "/delete?path=../escape"},
		{http.MethodPost, "/createFolder?path=../escape"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.target, nil)
		if got := do(s, req).Code; got != http.StatusBadRequest {
			t.Errorf("%s %s: status = %d, want 400", c.method, c.target, got)
		}
	}
}

func TestHandlerGetFileMissingIsNotFound(t *testing.T) {
	s, _ := newFileTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/getFile?path=nope.md", nil)
	if got := do(s, req).Code; got != http.StatusNotFound {
		t.Errorf("getFile of missing file: status = %d, want 404", got)
	}
}

// /info must stay 200-with-null for a missing path (Optional.empty() contract), not 404.
func TestHandlerInfoMissingIsOkNull(t *testing.T) {
	s, _ := newFileTestServer(t)
	rec := do(s, httptest.NewRequest(http.MethodGet, "/info?path=nope.md", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("info of missing path: status = %d, want 200", rec.Code)
	}
	if body := bytes.TrimSpace(rec.Body.Bytes()); string(body) != "null" {
		t.Errorf("info of missing path: body = %q, want null", body)
	}
}

func TestHandlerSearchBadRegexIsBadRequest(t *testing.T) {
	s, _ := newFileTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/search?path=&query=%2F%5B%2F", nil) // query = /[/
	rec := do(s, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("search with invalid regex: status = %d, want 400", rec.Code)
	}
	// Dashboard shows this body on the search box, so it has to say something.
	if !strings.Contains(rec.Body.String(), "invalid search pattern") {
		t.Errorf("error body = %q, want the pattern complaint", rec.Body.String())
	}
}

// TestHandlerSearchResponseShape pins the envelope: a bare array would leave nowhere to report that
// the result set was capped.
func TestHandlerSearchResponseShape(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "note.md"), "the needle is here\n")

	rec := do(s, httptest.NewRequest(http.MethodGet, "/search?path=&query=needle", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("search: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var got SearchResponseDto
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if got.Truncated || len(got.Results) != 1 || got.Results[0].File != "note.md" {
		t.Fatalf("results = %+v, truncated = %v", got.Results, got.Truncated)
	}
	if m := got.Results[0].Matches; len(m) != 1 || m[0].Line != 1 || len(m[0].Ranges) != 1 {
		t.Errorf("match should carry its line and one highlight range: %+v", m)
	}
}

// TestHandlerSearchNameOnlyHitSerialisesEmptyMatches guards a crash, not a nicety: the clients read
// `matches.length` without checking, so a name-only hit must serialise `[]` and never `null`.
func TestHandlerSearchNameOnlyHitSerialisesEmptyMatches(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWriteBytes(t, filepath.Join(root, "diagram.png"), []byte{0x89, 'P', 'N', 'G', 0x00, 0xff})

	rec := do(s, httptest.NewRequest(http.MethodGet, "/search?path=&query=diagram", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("search: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"matches":[]`) {
		t.Errorf("body = %s, want an empty matches array", rec.Body.String())
	}
}

// TestHandlerStoreInfo checks the one thing /storeInfo promises: the root it reports is absolute,
// since a client uses it to name a file to something outside this process.
func TestHandlerStoreInfo(t *testing.T) {
	s, root := newFileTestServer(t)

	rec := do(s, httptest.NewRequest(http.MethodGet, "/storeInfo", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("storeInfo: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var got StoreInfoDto
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if !filepath.IsAbs(got.RootPath) {
		t.Errorf("rootPath = %q, want an absolute path", got.RootPath)
	}
	if got.RootPath != root {
		t.Errorf("rootPath = %q, want the storage root %q", got.RootPath, root)
	}
}

// TestHandlerRoundTrip exercises the file endpoints end-to-end through the handler chain:
// upload a file, list the directory, read it back byte-for-byte, then delete it.
func TestHandlerRoundTrip(t *testing.T) {
	s, root := newFileTestServer(t)
	const name = "note.md"
	const content = "hello round-trip\n"

	// upload
	if rec := do(s, multipartUpload(t, "sub", name, content)); rec.Code != http.StatusOK {
		t.Fatalf("upload: status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(root + "/sub/" + name); err != nil {
		t.Fatalf("uploaded file missing on disk: %v", err)
	}

	// list
	rec := do(s, httptest.NewRequest(http.MethodGet, "/list?path=sub", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list: status = %d, want 200", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"path":"sub/note.md"`)) {
		t.Errorf("list did not include the uploaded file: %s", rec.Body.String())
	}

	// getFile
	rec = do(s, httptest.NewRequest(http.MethodGet, "/getFile?path=sub/"+name, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("getFile: status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != content {
		t.Errorf("getFile body = %q, want %q", rec.Body.String(), content)
	}

	// delete
	rec = do(s, httptest.NewRequest(http.MethodDelete, "/delete?path=sub/"+name, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: status = %d, want 200", rec.Code)
	}
	if _, err := os.Stat(root + "/sub/" + name); !os.IsNotExist(err) {
		t.Errorf("file should be gone after delete; stat err = %v", err)
	}
}

// A regular file is served with the headers a download needs: a total to show progress against,
// an advertised range unit, and a modification time to resume or revalidate against. A Range
// request gets exactly the bytes it asked for, and a repeat request with the same timestamp is
// answered 304 rather than the whole file again.
func TestHandlerGetFileServesRanges(t *testing.T) {
	s, _ := newFileTestServer(t)
	const content = "0123456789abcdef"
	if rec := do(s, multipartUpload(t, "media", "episode.mp3", content)); rec.Code != http.StatusOK {
		t.Fatalf("upload: status = %d", rec.Code)
	}

	rec := do(s, httptest.NewRequest(http.MethodGet, "/getFile?path=media/episode.mp3", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("getFile: status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != content {
		t.Errorf("body = %q, want %q", rec.Body.String(), content)
	}
	if got := rec.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Errorf("Content-Type = %q, want audio/mpeg", got)
	}
	if got := rec.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", got)
	}
	if got := rec.Header().Get("Content-Length"); got != strconv.Itoa(len(content)) {
		t.Errorf("Content-Length = %q, want %d", got, len(content))
	}
	lastModified := rec.Header().Get("Last-Modified")
	if lastModified == "" {
		t.Fatal("Last-Modified is empty; a resumed download has nothing to revalidate against")
	}
	// A regular file is not an attachment: the browser preview and the editors depend on it being
	// served inline, and only the zip of a directory names a download.
	if cd := rec.Header().Get("Content-Disposition"); cd != "" {
		t.Errorf("Content-Disposition = %q, want none on a regular file", cd)
	}
	// Last-Modified is what lets a browser invent a freshness lifetime for a response that states
	// none, so the response has to state one: a file edited under an open editor must be re-read,
	// not remembered.
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}

	req := httptest.NewRequest(http.MethodGet, "/getFile?path=media/episode.mp3", nil)
	req.Header.Set("Range", "bytes=10-")
	rec = do(s, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("ranged getFile: status = %d, want 206", rec.Code)
	}
	if rec.Body.String() != "abcdef" {
		t.Errorf("ranged body = %q, want %q", rec.Body.String(), "abcdef")
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 10-15/16" {
		t.Errorf("Content-Range = %q, want bytes 10-15/16", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/getFile?path=media/episode.mp3", nil)
	req.Header.Set("If-Modified-Since", lastModified)
	if rec := do(s, req); rec.Code != http.StatusNotModified {
		t.Errorf("If-Modified-Since: status = %d, want 304", rec.Code)
	}
}

// TestHandlerGetFolderZips confirms a directory path streams a zip with a download filename.
func TestHandlerGetFolderZips(t *testing.T) {
	s, _ := newFileTestServer(t)
	if rec := do(s, multipartUpload(t, "bundle", "a.md", "A\n")); rec.Code != http.StatusOK {
		t.Fatalf("upload: status = %d", rec.Code)
	}
	rec := do(s, httptest.NewRequest(http.MethodGet, "/getFile?path=bundle", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("getFile(dir): status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="bundle.zip"` {
		t.Errorf("Content-Disposition = %q, want bundle.zip attachment", cd)
	}
}

// multipartUpload builds a POST /upload request carrying a single file part.
func multipartUpload(t *testing.T, parent, filename, content string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("path", parent); err != nil {
		t.Fatal(err)
	}
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(part, content); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/upload", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// multipartUpdate builds a PUT /update request carrying a single file part.
func multipartUpdate(t *testing.T, path, content string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(part, content); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/update?path="+path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// MaxUploadBytes has to bound the request, not merely the parser's memory: past its in-memory
// threshold ParseMultipartForm spills to temp files and reads the body to its end, so a cap given
// only to it would let an endless body fill the disk. The refusal is a 413 that names the number,
// and nothing is written.
func TestHandlerUploadRefusesAnOversizeBody(t *testing.T) {
	s, root := newFileTestServer(t)
	s.cfg.MaxUploadBytes = 4 << 10

	oversize := strings.Repeat("x", 16<<10)
	rec := do(s, multipartUpload(t, "sub", "big.bin", oversize))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d (%s), want 413", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "4.0 KB") {
		t.Errorf("body = %q, want a refusal naming the limit the caller has to get under", rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "sub", "big.bin")); !os.IsNotExist(err) {
		t.Errorf("the file was written despite the refusal; stat err = %v", err)
	}
}

// /update is bounded the same way, but keeps the blunt 500 documented on the handler: the client
// reads a 500 there as "not there yet" and retries the write as an /upload, which is the call that
// answers 413 and names the limit. What matters here is that the target is left alone.
func TestHandlerUpdateRefusesAnOversizeBody(t *testing.T) {
	s, root := newFileTestServer(t)
	s.cfg.MaxUploadBytes = 4 << 10
	mustWrite(t, filepath.Join(root, "note.md"), "original\n")

	rec := do(s, multipartUpdate(t, "note.md", strings.Repeat("x", 16<<10)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d (%s), want 500", rec.Code, rec.Body.String())
	}
	if got := string(mustReadBytes(t, filepath.Join(root, "note.md"))); got != "original\n" {
		t.Errorf("file = %q, want it untouched", got)
	}
}

// The small in-memory threshold is not a size limit: a part larger than it goes to a temp file and
// still lands on disk byte-for-byte, so long as the whole request stays under MaxUploadBytes.
func TestHandlerUploadAcceptsAPartLargerThanTheMemoryThreshold(t *testing.T) {
	s, root := newFileTestServer(t)
	s.cfg.MaxUploadBytes = 8 << 20

	content := strings.Repeat("abcdefgh", (2<<20)/8) // 2 MiB, twice uploadParseMemoryBytes
	if rec := do(s, multipartUpload(t, "big", "spill.bin", content)); rec.Code != http.StatusOK {
		t.Fatalf("upload: status = %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if got := mustReadBytes(t, filepath.Join(root, "big", "spill.bin")); string(got) != content {
		t.Errorf("stored %d bytes, want the %d uploaded", len(got), len(content))
	}
}

func TestHandlerDeleteBatch(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "a.txt"), "A\n")
	mustWrite(t, filepath.Join(root, "b.txt"), "B\n")

	body := bytes.NewBufferString(`{"paths": ["a.txt", "b.txt"]}`)
	req := httptest.NewRequest(http.MethodPost, "/deleteBatch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("deleteBatch status = %d, want 200", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(root, "a.txt")); !os.IsNotExist(err) {
		t.Errorf("a.txt should be deleted")
	}
	if _, err := os.Stat(filepath.Join(root, "b.txt")); !os.IsNotExist(err) {
		t.Errorf("b.txt should be deleted")
	}
}

func TestHandlerMoveBatch(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "a.txt"), "A\n")
	mustWrite(t, filepath.Join(root, "b.txt"), "B\n")
	_ = os.MkdirAll(filepath.Join(root, "dest"), 0o755)

	body := bytes.NewBufferString(`{"paths": ["a.txt", "b.txt"], "targetFolder": "dest"}`)
	req := httptest.NewRequest(http.MethodPost, "/moveBatch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("moveBatch status = %d, want 200", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(root, "dest", "a.txt")); err != nil {
		t.Errorf("dest/a.txt should exist")
	}
	if _, err := os.Stat(filepath.Join(root, "dest", "b.txt")); err != nil {
		t.Errorf("dest/b.txt should exist")
	}
}

func TestHandlerCopyBatch(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "A\n")
	mustWrite(t, filepath.Join(root, "src", "sub", "b.txt"), "B\n")
	_ = os.MkdirAll(filepath.Join(root, "dest"), 0o755)

	body := bytes.NewBufferString(`{"paths": ["src"], "targetFolder": "dest"}`)
	req := httptest.NewRequest(http.MethodPost, "/copyBatch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("copyBatch status = %d, want 200", rec.Code)
	}
	var results []CopyResultDto
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(results) != 1 || results[0].From != "src" || results[0].To != "dest/src" {
		t.Fatalf("unexpected results: %+v", results)
	}
	if _, err := os.Stat(filepath.Join(root, "dest", "src", "sub", "b.txt")); err != nil {
		t.Errorf("dest/src/sub/b.txt should exist")
	}
	if _, err := os.Stat(filepath.Join(root, "src", "sub", "b.txt")); err != nil {
		t.Errorf("the source tree should be untouched")
	}
}

func TestHandlerCopyBatchIntoOwnSubtreeIsBadRequest(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "src", "a.txt"), "A\n")

	body := bytes.NewBufferString(`{"paths": ["src"], "targetFolder": "src"}`)
	req := httptest.NewRequest(http.MethodPost, "/copyBatch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("copyBatch status = %d, want 400", rec.Code)
	}
}

func TestHandlerCopyBatchTraversalIsBadRequest(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "a.txt"), "A\n")

	body := bytes.NewBufferString(`{"items": [{"from": "a.txt", "to": "../escaped.txt"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/copyBatch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("copyBatch status = %d, want 400", rec.Code)
	}
}

func TestHandlerCopyBatchInvalidBodyIsBadRequest(t *testing.T) {
	s, _ := newFileTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/copyBatch", bytes.NewBufferString(`not json`))
	req.Header.Set("Content-Type", "application/json")
	rec := do(s, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("copyBatch status = %d, want 400", rec.Code)
	}
}

// /listRecursive takes the whole selection in one request: `path` repeats, and the answer is the
// combined scope plus the flag saying whether it is all of it. One round trip is the point of the
// endpoint — a client that had to ask per path would be back to walking the store itself.
func TestHandlerListRecursiveTakesEveryPathAtOnce(t *testing.T) {
	s, root := newFileTestServer(t)
	mustWrite(t, filepath.Join(root, "folder", "a.md"), "a\n")
	mustWrite(t, filepath.Join(root, "loose.md"), "l\n")

	rec := do(s, httptest.NewRequest(http.MethodGet, "/listRecursive?path=folder&path=loose.md&path=gone.md", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Files     []FileDto `json:"files"`
		Truncated bool      `json:"truncated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body = %s (%v)", rec.Body.String(), err)
	}
	if body.Truncated {
		t.Error("truncated = true for a scope of three entries")
	}
	got := make([]string, 0, len(body.Files))
	for _, f := range body.Files {
		got = append(got, f.Path)
	}
	// A path that is not there contributes nothing: /delete succeeds on it too.
	want := []string{"folder", "folder/a.md", "loose.md"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("files = %v, want %v", got, want)
	}
}
