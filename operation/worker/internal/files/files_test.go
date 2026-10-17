package files

import (
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolvePath(t *testing.T) {
	root := "/data/root"
	cases := []struct {
		sub     string
		want    string
		wantErr bool
	}{
		{"", "/data/root", false},
		{"foo.md", "/data/root/foo.md", false},
		{"/foo.md", "/data/root/foo.md", false},
		{"a/b/c.md", "/data/root/a/b/c.md", false},
		{"../escape", "", true},
		{"a/../../escape", "", true},
		{"a/../b.md", "/data/root/b.md", false},
	}
	for _, c := range cases {
		got, err := core.ResolvePath(root, c.sub)
		if c.wantErr {
			if err == nil {
				t.Errorf("resolvePath(%q): expected error, got %q", c.sub, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("resolvePath(%q): unexpected error %v", c.sub, err)
			continue
		}
		if got != c.want {
			t.Errorf("resolvePath(%q) = %q, want %q", c.sub, got, c.want)
		}
	}
}

func TestSubsidiaryMainName(t *testing.T) {
	if m, ok := mainFileName("foo.pdf.index.md"); !ok || m != "foo.pdf" {
		t.Errorf("mainFileName(foo.pdf.index.md) = %q,%v want foo.pdf,true", m, ok)
	}
	if m, ok := mainFileName("foo.pdf.blog.md"); !ok || m != "foo.pdf" {
		t.Errorf("mainFileName(foo.pdf.blog.md) = %q,%v want foo.pdf,true", m, ok)
	}
	if _, ok := mainFileName("foo.pdf"); ok {
		t.Errorf("mainFileName(foo.pdf) should not be a subsidiary")
	}
}

func TestLinkFixRename(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root}
	lf := newLinkFixer(storage, []string{".md"})

	content := "see /docs/old here\nnested /docs/old/child.png\nword /docsoldnomatch\n\"/docs/old\"\n"
	mustWrite(t, filepath.Join(root, "ref.md"), content)
	// a binary-ish file with the same extension list excluded
	mustWrite(t, filepath.Join(root, "data.bin"), "/docs/old\n")

	report, err := lf.fixAfterRename("docs/old", "docs/new")
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
	storage := &core.Storage{Root: root}
	lf := newLinkFixer(storage, []string{".md"})
	mustWrite(t, filepath.Join(root, "ref.md"), "link (/docs/gone) end\n")

	if _, err := lf.fixAfterDelete("docs/gone"); err != nil {
		t.Fatal(err)
	}
	got := mustRead(t, filepath.Join(root, "ref.md"))
	want := "link (" + deletedSentinel + ") end\n"
	if got != want {
		t.Errorf("delete rewrite: got=%q want=%q", got, want)
	}
}

func TestLinkFixBoundaryNoPartialWord(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root}
	lf := newLinkFixer(storage, []string{".md"})
	// "/foobar" must NOT match the link "/foo" because the boundary check fails.
	mustWrite(t, filepath.Join(root, "ref.md"), "/foobar and /foo\n")

	report, err := lf.fixAfterRename("foo", "baz")
	if err != nil {
		t.Fatal(err)
	}
	got := mustRead(t, filepath.Join(root, "ref.md"))
	if got != "/foobar and /baz\n" {
		t.Errorf("boundary handling: got=%q", got)
	}
	if len(report.FileChanges) != 1 {
		t.Errorf("expected one change, got %d", len(report.FileChanges))
	}
}

func TestSearch(t *testing.T) {
	root := t.TempDir()
	storage := &core.Storage{Root: root}
	lf := newLinkFixer(storage, []string{".md"})
	svc := newFileService(storage, lf)

	mustWrite(t, filepath.Join(root, "a.md"), "Hello World\nsecond line\n")
	mustWrite(t, filepath.Join(root, "b.md"), "no match here\n")

	res, _, err := svc.search("", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].File != "a.md" || len(res[0].Matches) != 1 || res[0].Matches[0].Line != 1 {
		t.Fatalf("case-insensitive search mismatch: %+v", res)
	}

	// The exact-case form is a quoted phrase, and "hello" is not how the file spells it.
	res, _, err = svc.search("", `"hello"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Errorf(`the phrase "hello" should not match 'Hello': %+v`, res)
	}
}

func TestMigrationLedgerRoundTrip(t *testing.T) {
	state := t.TempDir()
	ledger, err := loadLedger(state)
	if err != nil {
		t.Fatal(err)
	}
	if ledger.schemaVersion != 0 {
		t.Fatalf("fresh ledger version = %d, want 0", ledger.schemaVersion)
	}
	script := migrationScript{version: 3, name: "demo", fileName: "V003__demo.js", checksum: "sha256:abc"}
	if err := ledger.record(script, 42); err != nil {
		t.Fatal(err)
	}

	reloaded, err := loadLedger(state)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.schemaVersion != 3 {
		t.Fatalf("reloaded version = %d, want 3", reloaded.schemaVersion)
	}
	if e, ok := reloaded.findApplied(3); !ok || e.Checksum != "sha256:abc" || e.DurationMs != 42 {
		t.Fatalf("reloaded entry mismatch: %+v ok=%v", e, ok)
	}
	// The ledger lives with the rest of the service's state, not in the store it describes.
	if _, err := os.Stat(filepath.Join(state, "files-migrations.json")); err != nil {
		t.Errorf("ledger file missing: %v", err)
	}
}

func TestMigrationRunEndToEnd(t *testing.T) {
	node, err := execLookNode()
	if err != nil {
		t.Skip("node not available; skipping migration e2e")
	}
	dataRoot := t.TempDir()
	migDir := t.TempDir()
	// A migration that writes a marker file into the data root.
	script := "const fs=require('fs');fs.writeFileSync(process.argv[2]+'/migrated.txt','ok');"
	mustWrite(t, filepath.Join(migDir, "V001__marker.js"), script)

	cfg := &Config{
		Config:              &core.Config{RootPath: dataRoot, StatePath: t.TempDir(), NodeBinary: node},
		MigrationsPath:      migDir,
		MigrationsEnabled:   true,
		MigrationsFailOnErr: true,
		MigrationsTimeout:   60_000_000_000, // 60s
	}
	if err := RunMigrations(cfg); err != nil {
		t.Fatalf("runMigrations failed: %v", err)
	}
	if b := mustRead(t, filepath.Join(dataRoot, "migrated.txt")); b != "ok" {
		t.Errorf("migration did not run; marker=%q", b)
	}
	// Re-running must be a no-op (already at version 1).
	if err := RunMigrations(cfg); err != nil {
		t.Fatalf("second runMigrations failed: %v", err)
	}
}

// A migration resolves the store's declarations from the data root alone: `.kiao-files` sits there
// under a fixed name, and nested ones are found by walking down from it. The old
// KIAO_MIGRATION_IGNORE_FILE existed only because the state directory is configurable, and a script
// that still read it would silently honour nothing.
func TestMigrationRunPassesTheDataRootAndNoIgnoreFile(t *testing.T) {
	node, err := execLookNode()
	if err != nil {
		t.Skip("node not available; skipping migration e2e")
	}
	dataRoot := t.TempDir()
	migDir := t.TempDir()
	state := t.TempDir()
	script := "const fs=require('fs');" +
		"fs.writeFileSync(process.argv[2]+'/seen.txt'," +
		"process.env.KIAO_DATA_ROOT+'|'+(process.env.KIAO_MIGRATION_IGNORE_FILE||'unset'));"
	mustWrite(t, filepath.Join(migDir, "V001__data-root.js"), script)

	cfg := &Config{Config: &core.Config{RootPath: dataRoot, StatePath: state, NodeBinary: node}, MigrationsPath: migDir, MigrationsEnabled: true, MigrationsFailOnErr: true, MigrationsTimeout: 60 * time.Second}
	if err := RunMigrations(cfg); err != nil {
		t.Fatalf("runMigrations failed: %v", err)
	}
	if got, want := mustRead(t, filepath.Join(dataRoot, "seen.txt")), dataRoot+"|unset"; got != want {
		t.Errorf("migration environment = %q, want %q", got, want)
	}
}

// helpers

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

func execLookNode() (string, error) {
	for _, c := range []string{"node", "nodejs"} {
		if p, err := lookPath(c); err == nil {
			return p, nil
		}
	}
	return "", os.ErrNotExist
}

func lookPath(cmd string) (string, error) {
	paths := strings.Split(os.Getenv("PATH"), string(os.PathListSeparator))
	for _, dir := range paths {
		full := filepath.Join(dir, cmd)
		if isExecutable(full) {
			return full, nil
		}
	}
	return "", os.ErrNotExist
}
