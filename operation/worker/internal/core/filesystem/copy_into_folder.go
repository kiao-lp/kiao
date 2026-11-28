package filesystem

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// CopyIntoFolder copies store entries under their original names. Hidden entries
// are included. Existing directories are merged and regular files are replaced.
func (s *Storage) CopyIntoFolder(ctx context.Context, folder string, sources []string) error {
	root, err := os.OpenRoot(s.Root)
	if err != nil {
		return err
	}
	defer root.Close()

	target := filepath.Clean(NormaliseVirtual(folder))
	gitDir := filepath.Join(physicalPath(s.Root), GitDirName)
	resolve := func(rel string) (string, error) {
		abs, err := s.Resolve(rel)
		if err != nil {
			return "", err
		}
		abs = physicalPath(abs)
		if containsPath(gitDir, abs) {
			return "", fmt.Errorf("the store's Git directory is protected: %s", rel)
		}
		return abs, nil
	}
	if _, err := resolve(target); err != nil {
		return err
	}
	type entryCopy struct {
		from, to            string
		source, destination string
	}
	entries := make([]entryCopy, 0, len(sources))
	names := make(map[string]bool, len(sources))
	for _, link := range sources {
		from := filepath.Clean(NormaliseVirtual(link))
		if from == "." {
			return fmt.Errorf("the DCMS root cannot be copied into a workflow folder")
		}
		source, err := resolve(from)
		if err != nil {
			return err
		}
		info, err := root.Lstat(from)
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("%q is not a regular file or directory", link)
		}
		name := filepath.Base(from)
		if names[name] {
			return fmt.Errorf("more than one workflow file is named %q", name)
		}
		names[name] = true
		to := filepath.Join(target, name)
		if from == to {
			continue
		}
		destination, err := resolve(to)
		if err != nil {
			return err
		}
		entries = append(entries, entryCopy{from: from, to: to, source: source, destination: destination})
	}
	for _, entry := range entries {
		for _, other := range entries {
			if containsPath(other.source, entry.destination) || containsPath(entry.destination, other.source) {
				return fmt.Errorf("the workflow copy to %q overlaps source %q", entry.to, other.from)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := root.MkdirAll(target, 0o755); err != nil {
		return err
	}
	for _, entry := range entries {
		if err := s.copyRootTree(ctx, root, entry.from, entry.to); err != nil {
			return fmt.Errorf("copy %q into %q: %w", entry.from, target, err)
		}
	}
	return nil
}

func (s *Storage) copyRootTree(ctx context.Context, root *os.Root, from, to string) error {
	return fs.WalkDir(root.FS(), filepath.ToSlash(from), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if !entry.IsDir() && !entry.Type().IsRegular() {
			return nil
		}
		if _, err := s.Resolve(path); err != nil {
			if errors.Is(err, ErrStatePath) && path != filepath.ToSlash(from) {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			return err
		}
		relative, err := filepath.Rel(from, filepath.FromSlash(path))
		if err != nil {
			return err
		}
		dst := filepath.Join(to, relative)
		if _, err := s.Resolve(dst); err != nil {
			return err
		}
		existing, err := root.Lstat(dst)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		if existing != nil && existing.Mode().Type() != entry.Type() {
			return fmt.Errorf("the existing entry %q has a different type", dst)
		}
		if entry.IsDir() {
			return root.MkdirAll(dst, 0o755)
		}
		return copyRootFile(ctx, root, path, dst)
	})
}

func copyRootFile(ctx context.Context, root *os.Root, from, to string) error {
	in, err := root.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%q is no longer a regular file", from)
	}
	// A retry can reuse completed copies. A failed copy leaves the previous file intact.
	tmp := filepath.Join(filepath.Dir(to), ".kiao-copy-"+rand.Text())
	out, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	_, copyErr := io.Copy(out, in)
	if err := errors.Join(copyErr, out.Close(), ctx.Err()); err != nil {
		return err
	}
	return root.Rename(tmp, to)
}
