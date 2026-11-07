package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStorageSaveFileCreatesParents(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}

	abs, err := s.SaveFile("a/b/c.md", strings.NewReader("hello\n"))
	if err != nil {
		t.Fatalf("saveFile: %v", err)
	}
	if abs != filepath.Join(root, "a", "b", "c.md") {
		t.Errorf("saveFile returned abs = %q", abs)
	}
	if got := mustRead(t, abs); got != "hello\n" {
		t.Errorf("saved content = %q", got)
	}
}

func TestStorageSaveFileRejectsTraversal(t *testing.T) {
	s := &Storage{Root: t.TempDir()}
	if _, err := s.SaveFile("../escape.md", strings.NewReader("x")); err == nil {
		t.Errorf("saveFile with traversal: expected error")
	}
}

func TestStorageDeleteFile(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}

	// deleteIfExists semantics: missing file is not an error.
	if err := s.DeleteFile("ghost.md"); err != nil {
		t.Errorf("deleteFile(missing): unexpected error %v", err)
	}

	// Existing file is removed.
	mustWrite(t, filepath.Join(root, "f.md"), "x\n")
	if err := s.DeleteFile("f.md"); err != nil {
		t.Fatalf("deleteFile: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "f.md")); !os.IsNotExist(err) {
		t.Errorf("file should be gone")
	}

	// Empty directory can be removed.
	if err := os.Mkdir(filepath.Join(root, "emptydir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteFile("emptydir"); err != nil {
		t.Errorf("deleteFile(empty dir): unexpected error %v", err)
	}

	// A non-empty directory goes with everything under it, however deep. Refusing one used to
	// surface as an unclassified ENOTEMPTY — a 500 — and forced callers to empty a folder by hand.
	mustWrite(t, filepath.Join(root, "full", "child.md"), "x\n")
	mustWrite(t, filepath.Join(root, "full", "nested", "deep.md"), "x\n")
	if err := s.DeleteFile("full"); err != nil {
		t.Fatalf("deleteFile(non-empty dir): %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "full")); !os.IsNotExist(err) {
		t.Errorf("directory should be gone")
	}
}

// The one path a recursive delete must never accept: every spelling of the storage root, which
// would otherwise take the whole store.
func TestStorageDeleteFileRefusesTheRoot(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}
	mustWrite(t, filepath.Join(root, "keep.md"), "x\n")

	for _, rel := range []string{"", "/", ".", "sub/.."} {
		if err := s.DeleteFile(rel); !errors.Is(err, ErrDeleteRoot) {
			t.Errorf("deleteFile(%q) = %v, want errDeleteRoot", rel, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "keep.md")); err != nil {
		t.Errorf("the store must be untouched: %v", err)
	}
}

func TestStorageListFiles(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}

	// Missing directory -> empty slice, no error.
	entries, err := s.ListFiles("does-not-exist")
	if err != nil || len(entries) != 0 {
		t.Errorf("listFiles(missing) = %+v, err=%v; want empty,nil", entries, err)
	}

	mustWrite(t, filepath.Join(root, "file.md"), "hello\n")
	if err := os.Mkdir(filepath.Join(root, "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "child", "nested.md"), "x\n")

	entries, err = s.ListFiles("")
	if err != nil {
		t.Fatalf("listFiles: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("listFiles depth-1 count = %d, want 2 (file.md, child)", len(entries))
	}
	byPath := map[string]FileEntry{}
	for _, e := range entries {
		byPath[e.Path] = e
	}
	f := byPath["file.md"]
	if f.IsDirectory || f.Size != int64(len("hello\n")) || f.ChildrenCount != nil {
		t.Errorf("file.md entry mismatch: %+v", f)
	}
	d := byPath["child"]
	if !d.IsDirectory || d.ChildrenCount == nil || *d.ChildrenCount != 1 {
		t.Errorf("child dir entry mismatch: %+v (childrenCount)", d)
	}
}

func TestStorageGetFileInfo(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}

	// Missing path -> ok=false, no error.
	if _, ok, err := s.GetFileInfo("missing.md"); ok || err != nil {
		t.Errorf("getFileInfo(missing): ok=%v err=%v, want false,nil", ok, err)
	}

	mustWrite(t, filepath.Join(root, "f.md"), "content\n")
	e, ok, err := s.GetFileInfo("f.md")
	if err != nil || !ok {
		t.Fatalf("getFileInfo(file): ok=%v err=%v", ok, err)
	}
	if e.IsDirectory || e.Path != "f.md" || e.Size != int64(len("content\n")) {
		t.Errorf("file info mismatch: %+v", e)
	}

	if err := os.Mkdir(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	de, ok, err := s.GetFileInfo("dir")
	if err != nil || !ok || !de.IsDirectory || de.ChildrenCount == nil {
		t.Errorf("dir info mismatch: %+v ok=%v err=%v", de, ok, err)
	}
}

func TestStorageCreateFolderAndRename(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}

	if err := s.CreateFolder("a/b/c"); err != nil {
		t.Fatalf("createFolder: %v", err)
	}
	if info, err := os.Stat(filepath.Join(root, "a", "b", "c")); err != nil || !info.IsDir() {
		t.Errorf("createFolder did not create nested dir: err=%v", err)
	}

	mustWrite(t, filepath.Join(root, "old.md"), "x\n")
	if err := s.RenameFile("old.md", "renamed.md"); err != nil {
		t.Fatalf("renameFile: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "old.md")); !os.IsNotExist(err) {
		t.Errorf("old path should be gone")
	}
	if _, err := os.Stat(filepath.Join(root, "renamed.md")); err != nil {
		t.Errorf("new path should exist: %v", err)
	}
}

// The state directory now sits in the data root, so the file API has to behave as though it were
// not there: it holds the migration ledger and transcripts of verbatim prompt text, none of which is
// content a client browses.
func TestStorageHidesTheStateDirectoryFromListings(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root, StateDir: ".kiao-config"}
	mustWrite(t, filepath.Join(root, ".kiao-config", "files-migrations.json"), "{}\n")
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello\n")

	entries, err := s.ListFiles("")
	if err != nil {
		t.Fatalf("listFiles: %v", err)
	}
	if len(entries) != 1 || entries[0].Path != "welcome.md" {
		t.Errorf("listFiles = %+v, want only welcome.md", entries)
	}

	// And the root must not advertise a child that a listing of it does not return.
	e, ok, err := s.GetFileInfo("")
	if err != nil || !ok {
		t.Fatalf("getFileInfo(root): ok=%v err=%v", ok, err)
	}
	if e.ChildrenCount == nil || *e.ChildrenCount != 1 {
		t.Errorf("root childrenCount = %v, want 1", e.ChildrenCount)
	}
}

// Hiding it from listings is not enough: a client that types the path must not be able to read,
// overwrite, rename or delete the state either. Every operation goes through Resolve, so this is
// the one place the refusal has to hold.
func TestStorageRefusesEveryPathInTheStateDirectory(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root, StateDir: ".kiao-config"}
	mustWrite(t, filepath.Join(root, ".kiao-config", "files-migrations.json"), "{}\n")
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello\n")

	for _, rel := range []string{".kiao-config", ".kiao-config/files-migrations.json", "/.kiao-config/conversations", "x/../.kiao-config"} {
		if _, err := s.Resolve(rel); !errors.Is(err, ErrStatePath) {
			t.Errorf("resolve(%q) = %v, want errStatePath", rel, err)
		}
	}
	if err := s.DeleteFile(".kiao-config/files-migrations.json"); !errors.Is(err, ErrStatePath) {
		t.Errorf("deleteFile = %v, want errStatePath", err)
	}
	if _, err := s.SaveFile(".kiao-config/files-migrations.json", strings.NewReader(`{"schemaVersion":99}`)); !errors.Is(err, ErrStatePath) {
		t.Errorf("saveFile = %v, want errStatePath", err)
	}
	if err := s.RenameFile("welcome.md", ".kiao-config/welcome.md"); !errors.Is(err, ErrStatePath) {
		t.Errorf("renameFile into the state directory = %v, want errStatePath", err)
	}
	if got := mustRead(t, filepath.Join(root, ".kiao-config", "files-migrations.json")); got != "{}\n" {
		t.Errorf("the migration ledger was written through the file API: %q", got)
	}
}

// A name that merely starts like the state directory is ordinary content — the prefix test is on
// path segments, not on characters.
func TestStorageResolvesNeighboursOfTheStateDirectory(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root, StateDir: ".kiao-config"}

	for _, rel := range []string{".kiao-configuration.md", "notes/.kiao-config.md"} {
		if _, err := s.Resolve(rel); err != nil {
			t.Errorf("resolve(%q) = %v, want the path accepted as content", rel, err)
		}
	}
}

// State configured outside the root leaves nothing to hide, and a store whose own tree happens to
// hold a .kiao-config must then stay browsable.
func TestStorageHidesNothingWhenStateLivesOutsideTheRoot(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}
	mustWrite(t, filepath.Join(root, ".kiao-config", "note.md"), "x\n")

	if _, err := s.Resolve(".kiao-config/note.md"); err != nil {
		t.Errorf("resolve = %v, want the path accepted", err)
	}
	entries, err := s.ListFiles("")
	if err != nil || len(entries) != 1 {
		t.Errorf("listFiles = %+v (err=%v), want the directory listed", entries, err)
	}
}

// The store root is the git work tree in production, so .git sits directly in it. It is not
// content: a listing that showed it would offer to zip a gigabyte of objects and to delete the
// only backup the store has. The name is matched at any depth, because a store may hold several
// unrelated work trees.
func TestStorageHidesGitDirectoriesFromListings(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root, StateDir: ".kiao-config"}
	mustWrite(t, filepath.Join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
	mustWrite(t, filepath.Join(root, "source-code", ".git", "HEAD"), "ref: refs/heads/main\n")
	mustWrite(t, filepath.Join(root, "source-code", "README.md"), "r\n")
	mustWrite(t, filepath.Join(root, "welcome.md"), "hello\n")

	entries, err := s.ListFiles("")
	if err != nil {
		t.Fatalf("listFiles: %v", err)
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Path] = true
	}
	if len(names) != 2 || !names["source-code"] || !names["welcome.md"] {
		t.Errorf("listFiles(root) = %v, want source-code and welcome.md only", names)
	}

	nested, err := s.ListFiles("source-code")
	if err != nil {
		t.Fatalf("listFiles(source-code): %v", err)
	}
	if len(nested) != 1 || nested[0].Path != "source-code/README.md" {
		t.Errorf("listFiles(source-code) = %+v, want only README.md", nested)
	}
}

// A name that merely starts like the git directory is ordinary content.
func TestStorageListsNeighboursOfTheGitDirectory(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root, StateDir: ".kiao-config"}
	mustWrite(t, filepath.Join(root, ".gitignore"), "*.mp3\n")
	mustWrite(t, filepath.Join(root, ".github", "workflows", "ci.yml"), "on: push\n")

	entries, err := s.ListFiles("")
	if err != nil {
		t.Fatalf("listFiles: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("listFiles = %+v, want .gitignore and .github", entries)
	}
}

// Every document in the store is saved through here, and the only backup is git history: a save
// that dies partway must leave the previous version readable rather than a truncated file.
func TestStorageSaveFileKeepsThePreviousDocumentWhenTheStreamFails(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}
	abs := filepath.Join(root, "units", "abc", "cadre.mlunit.json")
	mustWriteBytes(t, abs, []byte(`{"blocks":[]}`))

	if _, err := s.SaveFile("units/abc/cadre.mlunit.json", &brokenReader{head: `{"bloc`}); err == nil {
		t.Fatal("saveFile() = nil, want the stream's error")
	}
	if got := string(mustReadBytes(t, abs)); got != `{"blocks":[]}` {
		t.Errorf("content = %q, want the previous document whole", got)
	}
	entries, err := os.ReadDir(filepath.Dir(abs))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("folder holds %d entries, want only the document — a failed save must not litter the store", len(entries))
	}
}

// A save replaces the file, and a replace takes the mode of what it renames. A document the
// operator restricted must not be widened by the next edit through the SPA.
func TestStorageSaveFileKeepsAnExistingDocumentsMode(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}
	abs := filepath.Join(root, "private.md")
	mustWriteBytes(t, abs, []byte("old"))
	if err := os.Chmod(abs, 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := s.SaveFile("private.md", strings.NewReader("new")); err != nil {
		t.Fatalf("saveFile: %v", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %o, want the 600 the document already had", perm)
	}
	if got := mustRead(t, abs); got != "new" {
		t.Errorf("content = %q, want the saved body", got)
	}
}

// Saving over a folder was an error before the write became a replace, and a rename must not turn
// it into one that succeeds by removing the folder.
func TestStorageSaveFileRefusesADirectory(t *testing.T) {
	root := t.TempDir()
	s := &Storage{Root: root}
	mustMkdir(t, root, "units")

	if _, err := s.SaveFile("units", strings.NewReader("x")); err == nil {
		t.Fatal("saveFile(directory) = nil, want an error")
	}
	if info, err := os.Stat(filepath.Join(root, "units")); err != nil || !info.IsDir() {
		t.Errorf("the folder is gone: stat = %v, %v", info, err)
	}
}
