package hybridflowrunner

import (
	"fmt"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
)

// The conversation's CLI working directory is fixed at creation and re-resolved each turn
// in case it was renamed, deleted or replaced. It is a scope, not a sandbox: Read and Bash
// can reach anything the service user can; permission mode and human approval bound access.
type claudeFolder struct {
	virtual string // normalised root-relative path, "" for the store root
	abs     string // absolute, symlinks resolved — this is what becomes the CLI's cwd
}

// Resolve symlinks and re-check containment: core.ResolvePath's lexical check alone
// would allow a store symlink to put the CLI's working directory outside the root.
func resolveClaudeFolder(root, folder string) (claudeFolder, error) {
	virtual := core.NormaliseVirtual(folder)
	abs, err := core.ResolvePath(root, virtual)
	if err != nil {
		return claudeFolder{}, err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return claudeFolder{}, fmt.Errorf("%w: %s", os.ErrNotExist, virtual)
	}
	resolvedRoot, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil {
		return claudeFolder{}, err
	}
	if resolved != resolvedRoot && !strings.HasPrefix(resolved, resolvedRoot+string(filepath.Separator)) {
		return claudeFolder{}, core.ErrOutsideRoot
	}
	if !core.IsDir(resolved) {
		return claudeFolder{}, fmt.Errorf("%w: %s", core.ErrNotDirectory, virtual)
	}
	return claudeFolder{virtual: virtual, abs: resolved}, nil
}

func folderLabel(virtual string) string {
	if virtual == "" {
		return "the store root"
	}
	return virtual
}
