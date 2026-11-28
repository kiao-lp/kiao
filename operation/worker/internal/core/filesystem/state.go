package filesystem

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/config"
	"kiao/worker/internal/core/logging"
	"os"
	"path/filepath"
	"strings"
)

const (

	// StateLockFile is flocked for the process lifetime: concurrent whole-document registry
	// replacements would otherwise lose updates.
	StateLockFile = "state.lock"

	// Keep prompt transcripts out of git; the generated .gitignore ignores itself too.
	StateGitignoreFile = ".gitignore"
	stateGitignoreBody = "*\n"

	// Transcripts contain prompts and agent-read content; keep state private to the service user.
	stateDirPerm = 0o700
)

// ErrEmptyStatePath prevents state writes from resolving to the working directory.
var ErrEmptyStatePath = errors.New("the state path is empty")

// WriteFileAtomic replaces path atomically; concurrent readers see a whole document.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	return WriteStreamAtomic(path, bytes.NewReader(data), perm)
}

// WriteStreamAtomic fsyncs a sibling temp file before renaming it; atomic rename requires
// the same filesystem. A crash may leave an orphan temp file. The directory is not fsynced,
// so a power loss may lose the last write.
func WriteStreamAtomic(path string, r io.Reader, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create a temp file next to %s: %w", path, err)
	}
	tmp := f.Name()

	// Remove the temp file on failure; no background cleanup collects it.
	fail := func(err error) error {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", path, err)
	}
	if _, err := io.Copy(f, r); err != nil {
		return fail(err)
	}
	if err := f.Sync(); err != nil {
		return fail(err)
	}
	// Chmod the open file to avoid umask restrictions and name-reuse races.
	if err := f.Chmod(perm); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", path, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("failed to replace %s: %w", path, err)
	}
	return nil
}

// ExistingFileMode preserves content permissions across atomic replacement; otherwise
// a save could widen a private file to the default mode.
func ExistingFileMode(path string, fallback os.FileMode) os.FileMode {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return fallback
	}
	return info.Mode().Perm()
}

// Seed only missing files; preserve operator edits across restarts.
func seedStateFile(path, body string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	if err := WriteFileAtomic(path, []byte(body), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// EnsureStateDir runs before registry access and seeds a .gitignore only inside the DCMS root.
func EnsureStateDir(dcmsRoot, statePath string) error {
	if strings.TrimSpace(statePath) == "" {
		return ErrEmptyStatePath
	}
	// Preserve existing directory permissions, including operator-created state directories.
	if err := os.MkdirAll(statePath, stateDirPerm); err != nil {
		return fmt.Errorf("failed to create the state directory %s: %w", statePath, err)
	}
	if !insideDCMSRoot(physicalPath(dcmsRoot), physicalPath(statePath)) {
		return nil
	}
	gitignore := filepath.Join(statePath, StateGitignoreFile)
	written, err := seedStateFile(gitignore, stateGitignoreBody)
	if err != nil {
		// Nonfatal: failure to acquire the process lock will report an unwritable state directory.
		logging.LogMain.Warn("cannot hide the state directory from git; its contents may reach the Source "+
			"Control panel", "path", statePath, "error", err)
		return nil
	}
	if written {
		logging.LogMain.Info("state directory hidden from git", "path", statePath)
	}
	return nil
}

// Equality is excluded so the root .gitignore remains available for store content.
func insideDCMSRoot(root, dir string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	return absDir != absRoot && strings.HasPrefix(absDir, absRoot+string(filepath.Separator))
}

// RelativeStateDir returns the state path relative to the DCMS root, using forward slashes.
func RelativeStateDir(root, state string) string {
	if !insideDCMSRoot(root, state) {
		return ""
	}
	// insideDCMSRoot already checked both absolute paths.
	absRoot, _ := filepath.Abs(root)
	absState, _ := filepath.Abs(state)
	rel, err := filepath.Rel(absRoot, absState)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}

func NewStorage(root, state string) *Storage {
	storage := &Storage{Root: root}
	if state == "" {
		return storage
	}
	realRoot, realState := physicalPath(root), physicalPath(state)
	// A state path shared with the store still reserves the package cache.
	if containsPath(realState, realRoot) {
		state = filepath.Join(state, config.AgentPackagesDirName)
		realState = filepath.Join(realState, config.AgentPackagesDirName)
	}
	storage.StateDir = RelativeStateDir(root, state)
	storage.physicalStateDir = RelativeStateDir(realRoot, realState)
	storage.physicalStatePath = realState
	return storage
}

func containsPath(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	return err == nil && filepath.IsLocal(rel)
}

// Resolve the existing prefix so a new file under a symlink still has a physical destination.
func physicalPath(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	for prefix := abs; ; prefix = filepath.Dir(prefix) {
		if resolved, err := filepath.EvalSymlinks(prefix); err == nil {
			suffix, _ := filepath.Rel(prefix, abs)
			return filepath.Join(resolved, suffix)
		}
		if prefix == filepath.Dir(prefix) {
			return abs
		}
	}
}
