package core

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The state directory defaults into the data root, so a store carries the ledger, the registries
// and the config documents that describe it — and a machine serving two stores keeps two sets.
func TestStatePathDefaultsInsideTheDataRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("KIAO_WORKER_ROOT_PATH", root)
	t.Setenv("KIAO_WORKER_STATE_PATH", "")

	got := LoadConfig().StatePath
	if want := filepath.Join(root, ".kiao-config"); got != want {
		t.Errorf("StatePath = %q, want %q", got, want)
	}
}

// A relative data root is legal — storage resolves it against the working directory — but the state
// path derived from it must not be, or every registry write would follow the working directory.
func TestStatePathIsAbsoluteEvenForARelativeRoot(t *testing.T) {
	got := defaultStatePath(".")

	if !filepath.IsAbs(got) {
		t.Errorf("defaultStatePath(%q) = %q, want an absolute path", ".", got)
	}
	cfg := &Config{RootPath: ".", StatePath: got, AuthMode: "debug"}
	if problems := cfg.Validate(); len(problems) != 0 {
		t.Errorf("Validate() = %v, want no complaint about the derived state path", problems)
	}
}

// A state path configured by hand is only ever used verbatim, and a relative one would land the
// registries at the working directory — "/" for a systemd unit — so it is refused at startup.
func TestStatePathRejectsARelativeConfiguredValue(t *testing.T) {
	cfg := &Config{RootPath: t.TempDir(), StatePath: ".kiao-config", AuthMode: "debug"}

	problems := cfg.Validate()
	if len(problems) != 1 || !strings.Contains(problems[0], "KIAO_WORKER_STATE_PATH") {
		t.Errorf("Validate() = %v, want one complaint about the state path", problems)
	}
}

// The env var is what a deployment uses to keep state out of the git work tree, so it must win over
// the root-derived default.
func TestStatePathEnvOverridesTheDefault(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_STATE_PATH", "/var/lib/kiao-state")

	if got := LoadConfig().StatePath; got != "/var/lib/kiao-state" {
		t.Errorf("StatePath = %q, want the configured path", got)
	}
}

// State inside the data root must be ignored by git: the root is a work tree whose contents the
// user commits, and a transcript is a verbatim copy of what was typed into the prompt.
func TestEnsureStateDirIgnoresStateInsideTheDataRoot(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}

	if err := EnsureStateDir(cfg); err != nil {
		t.Fatalf("EnsureStateDir() = %v", err)
	}
	body, err := mustGitignore(t, cfg.StatePath)
	if err != nil {
		t.Fatalf("no .gitignore in the state directory: %v", err)
	}
	if body != "*" {
		t.Errorf(".gitignore = %q, want %q", body, "*")
	}
}

// Outside the root there is nothing to hide from: a deployment that keeps state elsewhere is not a
// git work tree's business, and writing an ignore file into somebody else's directory is not this
// service's place.
func TestEnsureStateDirWritesNoGitignoreOutsideTheDataRoot(t *testing.T) {
	cfg := &Config{RootPath: t.TempDir(), StatePath: filepath.Join(t.TempDir(), "state")}

	if err := EnsureStateDir(cfg); err != nil {
		t.Fatalf("EnsureStateDir() = %v", err)
	}
	if !IsDir(cfg.StatePath) {
		t.Fatalf("state directory %q was not created", cfg.StatePath)
	}
	if _, err := os.Stat(filepath.Join(cfg.StatePath, ".gitignore")); !os.IsNotExist(err) {
		t.Errorf("wrote a .gitignore outside the data root (stat error = %v)", err)
	}
}

// The state directory being the data root itself is the one case a .gitignore of "*" would be
// catastrophic: it would hide the entire content store from git.
func TestEnsureStateDirNeverIgnoresTheDataRootItself(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{RootPath: root, StatePath: root}

	if err := EnsureStateDir(cfg); err != nil {
		t.Fatalf("EnsureStateDir() = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".gitignore")); !os.IsNotExist(err) {
		t.Errorf("ignored the whole content store (stat error = %v)", err)
	}
}

// An operator who edited the generated file is deciding about their own repository; a restart must
// not overrule them.
func TestEnsureStateDirKeepsAnExistingGitignore(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}
	if err := os.MkdirAll(cfg.StatePath, 0o700); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, filepath.Join(cfg.StatePath, ".gitignore"), []byte("*\n!migrations.json\n"))

	if err := EnsureStateDir(cfg); err != nil {
		t.Fatalf("EnsureStateDir() = %v", err)
	}
	body, err := mustGitignore(t, cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "!migrations.json") {
		t.Errorf(".gitignore = %q, want the operator's edit kept", body)
	}
}

// The .gitignore is a courtesy to `git status`; the registries beside it are what the directory
// exists for. A state directory this service cannot write to still fails startup one line later, at
// the process lock — and the operator wants to read that, not a message about a .gitignore.
func TestEnsureStateDirSurvivesAnUnwritableGitignore(t *testing.T) {
	root := t.TempDir()
	cfg := &Config{RootPath: root, StatePath: filepath.Join(root, ".kiao-config")}
	if err := os.MkdirAll(cfg.StatePath, 0o700); err != nil {
		t.Fatal(err)
	}
	// Restored before the temp directory is removed, which needs the write bit back.
	t.Cleanup(func() { os.Chmod(cfg.StatePath, 0o700) })
	if err := os.Chmod(cfg.StatePath, 0o500); err != nil {
		t.Fatal(err)
	}

	if err := EnsureStateDir(cfg); err != nil {
		t.Errorf("EnsureStateDir() = %v, want a startup that survives a cosmetic write", err)
	}
}

// Storage refuses paths by root-relative name, so the state directory has to be handed to it the
// same way — whatever mixture of absolute and relative the two configured paths are spelled in.
func TestRelativeStateDirNamesTheDirectoryTheWayTheFileAPIDoes(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		name  string
		root  string
		state string
		want  string
	}{
		{"the default layout", root, filepath.Join(root, ".kiao-config"), ".kiao-config"},
		{"nested deeper", root, filepath.Join(root, "var", "state"), "var/state"},
		{"a trailing separator on the root", root + string(filepath.Separator), filepath.Join(root, ".kiao-config"), ".kiao-config"},
		{"outside the root", root, t.TempDir(), ""},
		// The root itself is never "inside" it: hiding it would empty the file browser.
		{"the root itself", root, root, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RelativeStateDir(c.root, c.state); got != c.want {
				t.Errorf("RelativeStateDir(%q, %q) = %q, want %q", c.root, c.state, got, c.want)
			}
		})
	}
}

// An empty state path would put every registry in the process's working directory, which under
// systemd is "/". It is rejected rather than created.
func TestEnsureStateDirRejectsAnEmptyPath(t *testing.T) {
	if err := EnsureStateDir(&Config{RootPath: t.TempDir()}); err == nil {
		t.Error("EnsureStateDir() = nil, want an error for an empty state path")
	}
}

// The write must land whole, under the requested mode, with no temp file surviving it — nothing
// ever cleans those up, and a registry directory is read by listing it.
func TestWriteFileAtomicLeavesNoTempFileAndKeepsTheMode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "registry.json")

	if err := WriteFileAtomic(path, []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatalf("WriteFileAtomic() = %v", err)
	}
	if got := string(mustReadBytes(t, path)); got != `{"version":1}` {
		t.Errorf("content = %q, want the written document", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %o, want 600", perm)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("directory holds %d entries, want only the written file", len(entries))
	}
}

// Replacing is the normal case: every registry is rewritten in place at a turn boundary.
func TestWriteFileAtomicReplacesAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "registry.json")
	mustWriteBytes(t, path, []byte("stale"))

	if err := WriteFileAtomic(path, []byte("fresh"), 0o600); err != nil {
		t.Fatalf("WriteFileAtomic() = %v", err)
	}
	if got := string(mustReadBytes(t, path)); got != "fresh" {
		t.Errorf("content = %q, want %q", got, "fresh")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %o, want 600 — the new mode must win over the replaced file's", perm)
	}
}

// A failed write must not leave its temp file behind either.
func TestWriteFileAtomicFailsCleanlyWithoutADirectory(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "absent")

	if err := WriteFileAtomic(filepath.Join(missing, "registry.json"), []byte("x"), 0o600); err == nil {
		t.Fatal("WriteFileAtomic() = nil, want an error when the directory is missing")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("failed write left %d entries behind", len(entries))
	}
}

// mustGitignore reads the generated ignore file, trimmed, so a test asserts on its pattern rather
// than on trailing whitespace.
func mustGitignore(t *testing.T, stateDir string) (string, error) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(stateDir, ".gitignore"))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// brokenReader hands over one chunk and then fails, standing in for the disk filling up or a client
// hanging up halfway through an upload — the moment the old truncate-then-copy left a document
// frozen at whatever had made it to disk.
type brokenReader struct {
	head string
	sent bool
}

func (r *brokenReader) Read(p []byte) (int, error) {
	if r.sent {
		return 0, errors.New("the stream broke")
	}
	r.sent = true
	return copy(p, r.head), nil
}

// The point of the whole exercise: a write that dies partway leaves the previous document whole.
func TestWriteStreamAtomicLeavesTheOldFileIntactWhenTheStreamFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "board.json")
	mustWriteBytes(t, path, []byte(`{"columns":[]}`))

	err := WriteStreamAtomic(path, &brokenReader{head: `{"colu`}, 0o644)
	if err == nil {
		t.Fatal("WriteStreamAtomic() = nil, want the reader's error")
	}
	if got := string(mustReadBytes(t, path)); got != `{"columns":[]}` {
		t.Errorf("content = %q, want the previous document untouched", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("directory holds %d entries, want only the document — the temp file must go with the error", len(entries))
	}
}

// The streaming form is the same replace as the buffered one, so it owes the same result.
func TestWriteStreamAtomicReplacesAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.md")
	mustWriteBytes(t, path, []byte("a much longer stale document\n"))

	if err := WriteStreamAtomic(path, strings.NewReader("fresh\n"), 0o600); err != nil {
		t.Fatalf("WriteStreamAtomic() = %v", err)
	}
	if got := string(mustReadBytes(t, path)); got != "fresh\n" {
		t.Errorf("content = %q, want %q — nothing of the replaced file may survive", got, "fresh\n")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %o, want 600", perm)
	}
}

// A replacing write takes the mode of the temp file it renames, so callers that rewrite content
// someone else created read the mode back off the target first.
func TestExistingFileMode(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "private.md")
	mustWriteBytes(t, file, []byte("x"))
	if err := os.Chmod(file, 0o600); err != nil {
		t.Fatal(err)
	}

	if got := ExistingFileMode(file, 0o644); got != 0o600 {
		t.Errorf("ExistingFileMode(existing) = %o, want 600", got)
	}
	if got := ExistingFileMode(filepath.Join(dir, "absent.md"), 0o644); got != 0o644 {
		t.Errorf("ExistingFileMode(missing) = %o, want the fallback 644", got)
	}
	// A directory has a mode too, and it is not one to give a file: 0755 on a document would make
	// every saved file executable.
	if got := ExistingFileMode(dir, 0o644); got != 0o644 {
		t.Errorf("ExistingFileMode(directory) = %o, want the fallback 644", got)
	}
}
