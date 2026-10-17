package core

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Service state is separate from browsable Storage paths and may live outside the data root.

const (
	// StateDirName defaults to a per-store directory, hidden from the file API and ignored by git.
	StateDirName = ".kiao-config"

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

// EnsureStateDir runs before registry access and seeds a .gitignore only inside the data root.
func EnsureStateDir(cfg *Config) error {
	if strings.TrimSpace(cfg.StatePath) == "" {
		return ErrEmptyStatePath
	}
	// Preserve existing directory permissions, including operator-created state directories.
	if err := os.MkdirAll(cfg.StatePath, stateDirPerm); err != nil {
		return fmt.Errorf("failed to create the state directory %s: %w", cfg.StatePath, err)
	}
	if !insideDataRoot(cfg.RootPath, cfg.StatePath) {
		return nil
	}
	gitignore := filepath.Join(cfg.StatePath, StateGitignoreFile)
	written, err := seedStateFile(gitignore, stateGitignoreBody)
	if err != nil {
		// Nonfatal: failure to acquire the process lock will report an unwritable state directory.
		LogMain.Warn("cannot hide the state directory from git; its contents may reach the Source "+
			"Control panel", "path", cfg.StatePath, "error", err)
		return nil
	}
	if written {
		LogMain.Info("state directory hidden from git", "path", cfg.StatePath)
	}
	return nil
}

// Equality is excluded: writing "*" to the root .gitignore would hide all content.
// This is a lexical check; symlinks may affect whether the .gitignore is seeded.
func insideDataRoot(root, dir string) bool {
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

// RelativeStateDir returns the state path in file-API form (root-relative, forward slashes)
// so Storage can deny access. Returns "" when state is outside the data root.
func RelativeStateDir(root, state string) string {
	if !insideDataRoot(root, state) {
		return ""
	}
	// insideDataRoot already checked both absolute paths.
	absRoot, _ := filepath.Abs(root)
	absState, _ := filepath.Abs(state)
	rel, err := filepath.Rel(absRoot, absState)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}
