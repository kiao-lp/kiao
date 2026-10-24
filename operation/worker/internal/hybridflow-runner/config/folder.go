package config

import (
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"os"
	"path/filepath"
	"strings"
)

// The conversation's CLI working directory is fixed at creation and re-resolved each turn
// in case it was renamed, deleted or replaced. It is a scope, not a sandbox: Read and Bash
// can reach anything the service user can; permission mode and human approval bound access.
type WorkingFolder struct {
	Virtual string // normalised root-relative path, "" for the store root
	Abs     string // absolute, symlinks resolved — this is what becomes the CLI's cwd
}

// Resolve symlinks and re-check containment: filesystem.ResolvePath's lexical check alone
// would allow a store symlink to put the CLI's working directory outside the root.
func ResolveFolder(root, folder string) (WorkingFolder, error) {
	virtual := filesystem.NormaliseVirtual(folder)
	abs, err := filesystem.ResolvePath(root, virtual)
	if err != nil {
		return WorkingFolder{}, err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return WorkingFolder{}, fmt.Errorf("%w: %s", os.ErrNotExist, virtual)
	}
	resolvedRoot, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil {
		return WorkingFolder{}, err
	}
	if resolved != resolvedRoot && !strings.HasPrefix(resolved, resolvedRoot+string(filepath.Separator)) {
		return WorkingFolder{}, filesystem.ErrOutsideRoot
	}
	if !filesystem.IsDir(resolved) {
		return WorkingFolder{}, fmt.Errorf("%w: %s", filesystem.ErrNotDirectory, virtual)
	}
	return WorkingFolder{Virtual: virtual, Abs: resolved}, nil
}

func folderLabel(virtual string) string {
	if virtual == "" {
		return "the store root"
	}
	return virtual
}
