package core

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// GitDirName is the work-tree directory Storage keeps out of every listing, and that every
// automatic pass is excluded from whatever a store's declaration says: in production the storage
// root IS the git work tree, and a pass that rewrote objects inside it would corrupt the history
// the store's only backup lives in.
const GitDirName = ".git"

// StagingDirName is the store folder an upload lands in before anybody has said what to keep — one
// subdirectory per upload, removed as soon as the review that follows it is answered.
//
// It is kept out of every listing like the state directory, because a folder of files nobody has
// accepted yet must not read as content. Unlike the state directory it stays *reachable* by path,
// and that is the whole point: the ordinary upload, index, move and delete endpoints are what work
// on it, so staging costs no second implementation of any of them. What keeps the automatic passes
// out of it is its leading dot, which the seeded `.kiao-files` declaration excludes from all three.
const StagingDirName = ".kiao-uploads"

// FileEntry is the internal representation of a filesystem entry (kiao.worker.File).
// Path is relative to the storage root, using forward slashes.
type FileEntry struct {
	Path          string
	IsDirectory   bool
	Size          int64
	LastModified  int64 // epoch millis
	ChildrenCount *int  // nil for files
}

// Storage is the OS filesystem driver (kiao.worker.OsFileSystemStorageDriver). All paths
// passed in are relative to Root; every operation resolves and bounds-checks them first.
type Storage struct {
	Root string

	// StateDir is the service's own state directory, relative to Root — ".kiao-config" in the
	// default layout — or "" when a deployment keeps its state outside the root, where the file API
	// cannot reach it anyway. It is machinery and not content: the ledger decides which migrations
	// still run and a transcript is a verbatim copy of what was typed into a prompt, so no client
	// browses, reads, renames or deletes it just because it now lives in the tree.
	StateDir string
}

// Resolve bounds-checks a root-relative path against the storage root, and refuses one that lands
// in the state directory.
func (s *Storage) Resolve(rel string) (string, error) {
	abs, err := ResolvePath(s.Root, rel)
	if err != nil {
		return "", err
	}
	if s.IsStatePath(abs) {
		return "", fmt.Errorf("%w: %s", ErrStatePath, rel)
	}
	return abs, nil
}

// IsStatePath reports whether an already-resolved path is the state directory or anything under it.
// The comparison is made root-relative rather than absolute because Root itself may be a relative
// path, in which case every resolved path is relative too.
func (s *Storage) IsStatePath(abs string) bool {
	if s.StateDir == "" {
		return false
	}
	rel, err := filepath.Rel(filepath.Clean(s.Root), abs)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	return rel == s.StateDir || strings.HasPrefix(rel, s.StateDir+"/")
}

// IsStagingRoot reports whether an already-resolved path is the staging directory itself. Only the
// directory, never what is under it: a listing of the store root must not show it, while a listing
// *of* a staging area — the review dialog's own — has to work like any other.
//
// The comparison is made root-relative, like IsStatePath, because Root itself may be a relative
// path, in which case every resolved path is relative too.
func (s *Storage) IsStagingRoot(abs string) bool {
	rel, err := filepath.Rel(filepath.Clean(s.Root), abs)
	if err != nil {
		return false
	}
	return filepath.ToSlash(rel) == StagingDirName
}

// IsGitDir reports whether an already-resolved path is a repository's git directory. It is matched
// on the name at any depth, not only at the root, because a store may hold several unrelated work
// trees — see the declaration in kiaofiles.go, which excludes the same name from every automatic
// pass for the same reason: the history is the store's only backup, and a browser that lists it
// offers to zip 1.2 GB of objects and to delete the lot.
func (s *Storage) IsGitDir(abs string) bool {
	return filepath.Base(abs) == GitDirName
}

// SaveFile writes the stream to rel, creating parent directories, and returns the absolute path.
//
// The document is replaced rather than truncated and refilled: the stream lands in a temp file
// beside it and is renamed over it, so anything that reads the file while the SPA is saving it —
// another Claude turn, the search indexer, `git status` — gets the whole old version or the whole
// new one. This is the save path for every document in the store, and the truncate-then-copy it
// replaces left a window on every one of them where a crash, a kill or a full disk froze the file
// half-written. There is nothing to restore it from but git history.
//
// The mode of a document that is already there is kept, because a truncating write kept it and
// nothing about saving new content is a decision to widen who can read it.
func (s *Storage) SaveFile(rel string, r io.Reader) (string, error) {
	abs, err := s.Resolve(rel)
	if err != nil {
		return "", err
	}
	if parent := filepath.Dir(abs); parent != "" {
		if err := os.MkdirAll(parent, 0o755); err != nil {
			return "", err
		}
	}
	if err := WriteStreamAtomic(abs, r, ExistingFileMode(abs, 0o644)); err != nil {
		return "", err
	}
	return abs, nil
}

// DeleteFile removes rel: a file, or a directory with everything under it. Removing something that
// is not there is not an error — the caller asked for it gone, and it is.
//
// It deletes a *non-empty* directory too. Refusing one used to surface as an unclassified
// ENOTEMPTY, i.e. a 500 that read like a server fault, and left every client emptying a folder file
// by file before it could remove the folder.
//
// The storage root is the one path this refuses: an empty path, "/" or "." all Resolve to it, and a
// recursive delete there would take the whole store.
func (s *Storage) DeleteFile(rel string) error {
	abs, err := s.Resolve(rel)
	if err != nil {
		return err
	}
	if filepath.Clean(abs) == filepath.Clean(s.Root) {
		return ErrDeleteRoot
	}
	return os.RemoveAll(abs)
}

// ListFiles returns the direct children of relDir (depth 1). Entries that are neither regular
// files nor directories are skipped. Returns an empty slice when relDir does not exist.
func (s *Storage) ListFiles(relDir string) ([]FileEntry, error) {
	abs, err := s.Resolve(relDir)
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Stat(abs); statErr != nil {
		if os.IsNotExist(statErr) {
			return []FileEntry{}, nil
		}
		return nil, statErr
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		child := filepath.Join(abs, e.Name())
		if s.IsStatePath(child) {
			continue // the service's own state, which sits in the root but is not part of it
		}
		if s.IsGitDir(child) {
			continue // the repository, which the store is versioned in but does not contain
		}
		if s.IsStagingRoot(child) {
			continue // uploads nobody has accepted yet; the review dialog is what shows them
		}
		info, err := os.Stat(child)
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() && !info.IsDir() {
			continue
		}
		out = append(out, s.MapToFile(child, info))
	}
	return out, nil
}

// relative turns an absolute path back into the root-relative, slash-separated one the API speaks.
func (s *Storage) relative(abs string) string {
	rel, err := filepath.Rel(s.Root, abs)
	if err != nil {
		return abs
	}
	return filepath.ToSlash(rel)
}

// GetFileInfo returns the entry for rel, or ok=false when it does not exist.
func (s *Storage) GetFileInfo(rel string) (FileEntry, bool, error) {
	abs, err := s.Resolve(rel)
	if err != nil {
		return FileEntry{}, false, err
	}
	info, statErr := os.Stat(abs)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return FileEntry{}, false, nil
		}
		return FileEntry{}, false, statErr
	}
	return s.MapToFile(abs, info), true, nil
}

func (s *Storage) CreateFolder(rel string) error {
	abs, err := s.Resolve(rel)
	if err != nil {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

func (s *Storage) RenameFile(rel, newRel string) error {
	src, err := s.Resolve(rel)
	if err != nil {
		return err
	}
	dst, err := s.Resolve(newRel)
	if err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// Exists reports whether rel points at anything on disk. Cheaper than GetFileInfo, which reads a
// directory to count its children; this is only ever asked "is the name taken?".
func (s *Storage) Exists(rel string) (bool, error) {
	abs, err := s.Resolve(rel)
	if err != nil {
		return false, err
	}
	if _, statErr := os.Lstat(abs); statErr != nil {
		if os.IsNotExist(statErr) {
			return false, nil
		}
		return false, statErr
	}
	return true, nil
}

// CopyPath copies rel onto newRel, recursing into directories. Both ends are bounds-checked
// against the root before a single byte moves; missing parent directories are created.
func (s *Storage) CopyPath(rel, newRel string) error {
	src, err := s.Resolve(rel)
	if err != nil {
		return err
	}
	dst, err := s.Resolve(newRel)
	if err != nil {
		return err
	}
	return CopyTree(src, dst)
}

// CopyTree copies one absolute path onto another. Entries that are neither regular files nor
// directories (symlinks, devices) are skipped, matching what ListFiles exposes in the first place.
func CopyTree(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case info.IsDir():
		if err := os.MkdirAll(dst, 0o755); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			childInfo, err := e.Info()
			if err != nil {
				continue
			}
			if !childInfo.Mode().IsRegular() && !childInfo.IsDir() {
				continue
			}
			if err := CopyTree(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
		return nil
	case info.Mode().IsRegular():
		return CopyRegularFile(src, dst)
	default:
		return nil
	}
}

// CopyRegularFile copies file contents, creating the destination's parent directory.
func CopyRegularFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// MapToFile builds a FileEntry from a stat result, mirroring OsFileSystemStorageDriver.MapToFile.
func (s *Storage) MapToFile(abs string, info os.FileInfo) FileEntry {
	rel, err := filepath.Rel(s.Root, abs)
	if err != nil {
		rel = abs
	}
	rel = filepath.ToSlash(rel)

	e := FileEntry{
		Path:         rel,
		IsDirectory:  info.IsDir(),
		LastModified: info.ModTime().UnixMilli(),
	}
	if info.IsDir() {
		if children, err := os.ReadDir(abs); err == nil {
			// Counted rather than measured, so the root does not advertise one child more than a
			// listing of it returns: the state directory is skipped by both.
			n := 0
			for _, c := range children {
				if s.IsStatePath(filepath.Join(abs, c.Name())) {
					continue
				}
				n++
			}
			e.ChildrenCount = &n
		}
	} else {
		e.Size = info.Size()
	}
	return e
}

// SortEntriesByName gives directory listings a stable, name-sorted order.
func SortEntriesByName(entries []FileEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Path) < strings.ToLower(entries[j].Path)
	})
}
