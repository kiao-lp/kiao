package filesystem

import (
	"kiao/worker/internal/core/errors"
	"os"
	pkgPath "path"
	"path/filepath"
	"strings"
)

// ErrOutsideRoot is returned when a resolved path escapes the storage root.
var ErrOutsideRoot = faults.Invalid("subpath is outside the root path")

// ResolvePath joins subpath onto root and verifies the result stays within root, replicating
// kiao.worker.PathResolver. A leading slash on subpath is stripped; an empty subpath
// resolves to the root itself. Parent-directory traversal that escapes root is rejected.
func ResolvePath(root, subpath string) (string, error) {
	cleanRoot := filepath.Clean(root)

	s := filepath.ToSlash(subpath)
	if strings.HasPrefix(s, "/") {
		s = s[1:]
	}
	if s == "" {
		return cleanRoot, nil
	}

	resolved := filepath.Clean(filepath.Join(cleanRoot, s))
	if resolved != cleanRoot && !strings.HasPrefix(resolved, cleanRoot+string(filepath.Separator)) {
		return "", ErrOutsideRoot
	}
	return resolved, nil
}

// NormaliseVirtual reduces a virtual path to the plain root-relative form path comparisons need:
// forward slashes, no leading or trailing slash, no "." or ".." segments.
func NormaliseVirtual(p string) string {
	s := strings.Trim(filepath.ToSlash(p), "/")
	if s == "" || s == "." {
		return ""
	}
	s = pkgPath.Clean(s)
	if s == "." {
		return ""
	}
	return s
}

// IsDir reports whether p is an existing directory.
func IsDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
