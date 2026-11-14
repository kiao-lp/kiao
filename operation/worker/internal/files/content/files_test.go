package content

import (
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/filesystem"
	fileconfig "kiao/worker/internal/files/configuration"
	"kiao/worker/internal/files/migrations"
	"kiao/worker/internal/files/refactor"
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
		got, err := filesystem.ResolvePath(root, c.sub)
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

func TestLinkFixBoundaryNoPartialWord(t *testing.T) {
	root := t.TempDir()
	storage := &filesystem.Storage{Root: root}
	lf := refactor.NewLinkFixer(storage, []string{".md"})
	// "/foobar" must NOT match the link "/foo" because the boundary check fails.
	mustWrite(t, filepath.Join(root, "ref.md"), "/foobar and /foo\n")

	report, err := lf.FixAfterRename("foo", "baz")
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
	storage := &filesystem.Storage{Root: root}
	lf := refactor.NewLinkFixer(storage, []string{".md"})
	svc := NewFileService(storage, lf)

	mustWrite(t, filepath.Join(root, "a.md"), "Hello World\nsecond line\n")
	mustWrite(t, filepath.Join(root, "b.md"), "no match here\n")

	res, _, err := svc.Search("", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].File != "a.md" || len(res[0].Matches) != 1 || res[0].Matches[0].Line != 1 {
		t.Fatalf("case-insensitive search mismatch: %+v", res)
	}

	// The exact-case form is a quoted phrase, and "hello" is not how the file spells it.
	res, _, err = svc.Search("", `"hello"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Errorf(`the phrase "hello" should not match 'Hello': %+v`, res)
	}
}

func TestMigrationRunEndToEnd(t *testing.T) {
	node, err := execLookNode()
	if err != nil {
		t.Skip("node not available; skipping migration e2e")
	}
	dataRoot := t.TempDir()
	migDir := newMigrationSource(t, "base", 0)
	// A migration that writes a marker file into the data root.
	script := "const fs=require('fs');fs.writeFileSync(process.argv[2]+'/migrated.txt','ok');"
	mustWrite(t, filepath.Join(migDir, "V001__marker.js"), script)

	cfg := &fileconfig.Config{
		Config:              &coreconfig.Config{RootPath: dataRoot, StatePath: t.TempDir(), NodeBinary: node},
		MigrationsPath:      migDir,
		MigrationsEnabled:   true,
		MigrationsFailOnErr: true,
		MigrationsTimeout:   60_000_000_000, // 60s
	}
	if err := migrations.RunMigrations(cfg); err != nil {
		t.Fatalf("runMigrations failed: %v", err)
	}
	if b := mustRead(t, filepath.Join(dataRoot, "migrated.txt")); b != "ok" {
		t.Errorf("migration did not run; marker=%q", b)
	}
	// Re-running must be a no-op (already at version 1).
	if err := migrations.RunMigrations(cfg); err != nil {
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
	migDir := newMigrationSource(t, "base", 0)
	state := t.TempDir()
	script := "const fs=require('fs');" +
		"fs.writeFileSync(process.argv[2]+'/seen.txt'," +
		"process.env.KIAO_DATA_ROOT+'|'+(process.env.KIAO_MIGRATION_IGNORE_FILE||'unset'));"
	mustWrite(t, filepath.Join(migDir, "V001__data-root.js"), script)

	cfg := &fileconfig.Config{Config: &coreconfig.Config{RootPath: dataRoot, StatePath: state, NodeBinary: node}, MigrationsPath: migDir, MigrationsEnabled: true, MigrationsFailOnErr: true, MigrationsTimeout: 60 * time.Second}
	if err := migrations.RunMigrations(cfg); err != nil {
		t.Fatalf("runMigrations failed: %v", err)
	}
	if got, want := mustRead(t, filepath.Join(dataRoot, "seen.txt")), dataRoot+"|unset"; got != want {
		t.Errorf("migration environment = %q, want %q", got, want)
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
		if migrations.IsExecutable(full) {
			return full, nil
		}
	}
	return "", os.ErrNotExist
}
