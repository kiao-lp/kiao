package refactor

import (
	"kiao/worker/internal/core/filesystem"
	"os"
	"path/filepath"
	"testing"
)

func TestLinkFixRename(t *testing.T) {
	root := t.TempDir()
	storage := &filesystem.Storage{Root: root}
	lf := NewLinkFixer(storage, []string{".md"})

	content := "see /docs/old here\nnested /docs/old/child.png\nword /docsoldnomatch\n\"/docs/old\"\n"
	mustWrite(t, filepath.Join(root, "ref.md"), content)
	// a binary-ish file with the same extension list excluded
	mustWrite(t, filepath.Join(root, "data.bin"), "/docs/old\n")

	report, err := lf.FixAfterRename("docs/old", "docs/new")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.FileChanges) != 1 || report.FileChanges[0].FilePath != "ref.md" {
		t.Fatalf("unexpected file changes: %+v", report.FileChanges)
	}
	got := mustRead(t, filepath.Join(root, "ref.md"))
	want := "see /docs/new here\nnested /docs/new/child.png\nword /docsoldnomatch\n\"/docs/new\"\n"
	if got != want {
		t.Errorf("rename rewrite:\n got=%q\nwant=%q", got, want)
	}
	// .bin is not in the scanned extensions, must be untouched
	if b := mustRead(t, filepath.Join(root, "data.bin")); b != "/docs/old\n" {
		t.Errorf("data.bin was modified: %q", b)
	}
}

func TestLinkFixDelete(t *testing.T) {
	root := t.TempDir()
	storage := &filesystem.Storage{Root: root}
	lf := NewLinkFixer(storage, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "link (/docs/gone) end\n")

	if _, err := lf.FixAfterDelete("docs/gone"); err != nil {
		t.Fatal(err)
	}
	got := mustRead(t, filepath.Join(root, "ref.md"))
	want := "link (" + DeletedSentinel + ") end\n"
	if got != want {
		t.Errorf("delete rewrite: got=%q want=%q", got, want)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
