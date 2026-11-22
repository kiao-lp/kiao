package filesystem

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kiao/agentic-resource-manager/core/entities"
	"kiao/agentic-resource-manager/core/ports"
)

var _ ports.AgenticResources = (*Store)(nil)

func (s *Store) resourceRoots() []string {
	roots := []string{s.AgentRoot}
	if s.DependencyRoot != "" && s.DependencyRoot != s.AgentRoot {
		roots = append(roots, s.DependencyRoot)
	}
	return roots
}

func (s *Store) resource(name string) (string, error) {
	if !validRepositoryName(name) {
		return "", entities.Invalidf("invalid agentic resource name")
	}
	var found string
	for _, root := range s.resourceRoots() {
		dir := filepath.Join(root, name)
		info, err := os.Lstat(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", entities.Invalidf("resource must be a directory")
		}
		if found != "" {
			return "", entities.Conflictf("resource %q is present in several roots", name)
		}
		found = dir
	}
	if found == "" {
		return "", entities.NotFoundf("resource %s", name)
	}
	return found, nil
}

func ignoredResourcePath(path string) bool {
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		switch part {
		case ".git", "node_modules", "apm_modules", "dist":
			return true
		}
	}
	return false
}

func resourceFile(root, path string) (string, error) {
	if path == "" || filepath.IsAbs(path) || strings.Contains(path, "\\") || ignoredResourcePath(path) {
		return "", entities.Invalidf("invalid resource file path")
	}
	clean := filepath.Clean(path)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", entities.Invalidf("file leaves resource")
	}
	current := root
	for _, part := range strings.Split(clean, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", entities.Invalidf("resource files cannot traverse symlinks")
		}
	}
	return filepath.Join(root, clean), nil
}

func (s *Store) ListResources(ctx context.Context) ([]entities.AgenticResource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []entities.AgenticResource{}
	known := map[string]bool{}
	for _, root := range s.resourceRoots() {
		entries, err := os.ReadDir(root)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			name := entry.Name()
			if !entry.IsDir() || !validRepositoryName(name) {
				continue
			}
			if known[name] {
				return nil, entities.Conflictf("resource %q is present in several roots", name)
			}
			known[name] = true
			dir := filepath.Join(root, name)
			kind, _, _ := strings.Cut(name, "-")
			if _, err := os.Stat(filepath.Join(dir, configurationFile)); err == nil {
				kind = "agent"
			}
			if kind != "agent" && kind != "skill" && kind != "mcp" {
				continue
			}
			r := entities.AgenticResource{Name: name, Kind: kind, Files: []string{}}
			if _, remote, err := s.remote(ctx, dir); err == nil {
				r.Repository = remote
			}
			if commit, err := s.git(ctx, dir, "rev-parse", "HEAD"); err == nil {
				r.Commit = strings.TrimSpace(string(commit))
			}
			if manifest, err := readReleaseManifest(dir); err == nil {
				tags, err := s.releaseTags(ctx, dir)
				if err != nil {
					return nil, err
				}
				r.Version = manifest.base(tags).String()
			}
			status, err := s.git(ctx, dir, "status", "--porcelain")
			if err != nil {
				return nil, err
			}
			r.Dirty = len(status) > 0
			err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				relative, _ := filepath.Rel(dir, path)
				if relative == "." {
					return nil
				}
				if ignoredResourcePath(relative) {
					if d.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
				if d.Type()&os.ModeSymlink != 0 {
					return fmt.Errorf("resource %s contains a symlink: %s", name, relative)
				}
				if !d.IsDir() {
					r.Files = append(r.Files, filepath.ToSlash(relative))
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *Store) ReadResourceFile(ctx context.Context, name, path string) (*entities.ResourceFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.resource(name)
	if err != nil {
		return nil, err
	}
	file, err := resourceFile(dir, path)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		return nil, entities.NotFoundf("resource file %s", path)
	}
	if err != nil {
		return nil, err
	}
	result := (entities.ResourceFile{Path: path, Content: string(data)}).Versioned()
	return &result, nil
}

func (s *Store) WriteResourceFile(ctx context.Context, name string, file entities.ResourceFile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.resource(name)
	if err != nil {
		return err
	}
	path, err := resourceFile(dir, file.Path)
	if err != nil {
		return err
	}
	if isAgentDirectory(dir) && path == filepath.Join(dir, configurationFile) {
		return entities.Invalidf("agent identity metadata is managed by the agent editor")
	}
	if len(file.Content) > 4<<20 {
		return entities.Invalidf("resource file exceeds 4 MiB")
	}
	if file.Revision != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		current := (entities.ResourceFile{Content: string(data)}).Versioned()
		if current.Revision != file.Revision {
			return entities.Conflictf("resource file changed; reload before editing it")
		}
	}
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	if err = atomicWrite(path, []byte(file.Content)); err != nil {
		return err
	}
	if isAgentDirectory(dir) {
		metadataPath := filepath.Join(dir, configurationFile)
		data, err := os.ReadFile(metadataPath)
		if err != nil {
			return err
		}
		var metadata agentMetadata
		if err = json.Unmarshal(data, &metadata); err != nil {
			return err
		}
		metadata.Revision++
		metadata.UpdatedAt = time.Now().UTC()
		data, err = json.MarshalIndent(metadata, "", "  ")
		if err != nil {
			return err
		}
		return atomicWrite(metadataPath, append(data, '\n'))
	}
	return nil
}

func (s *Store) ResourceOperation(ctx context.Context, name, operation, message, confirmation string, bump entities.ReleaseBump) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.resource(name)
	if err != nil {
		return err
	}
	switch operation {
	case "install":
		if err = clearManagedSkillProjections(dir); err != nil {
			return err
		}
		err = s.restoreResourceDependencies(ctx, dir)
	case "pull":
		_, err = s.git(ctx, dir, "pull", "--ff-only")
	case "push":
		remote, remoteURL, e := s.remote(ctx, dir)
		if e != nil {
			return e
		}
		if remote == "" {
			return entities.Invalidf("repository has no remote")
		}
		if isAgentDirectory(dir) {
			if err = s.checkAgentGitPush(ctx, dir, remoteURL, confirmation); err != nil {
				return err
			}
		}
		_, err = s.git(ctx, dir, "push", "--follow-tags", remote, "HEAD")
		if err == nil {
			_, err = s.git(ctx, dir, "push", remote, "--tags")
		}
	case "publish":
		if isAgentDirectory(dir) {
			return entities.Invalidf("publish the agent through its editor")
		}
		manifest, err := readReleaseManifest(dir)
		if err != nil {
			return err
		}
		tags, err := s.releaseTags(ctx, dir)
		if err != nil {
			return err
		}
		version, err := manifest.base(tags).Bump(bump)
		if err != nil {
			return err
		}
		return s.commitRelease(ctx, dir, manifest, version, message, func() error {
			if err := clearManagedSkillProjections(dir); err != nil {
				return err
			}
			if err := s.restoreResourceDependencies(ctx, dir); err != nil {
				return err
			}
			return s.keepSkillProjectionsLocal(ctx, dir)
		})
	default:
		return entities.Invalidf("unknown resource operation")
	}
	return err
}

func isAgentDirectory(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, configurationFile))
	return err == nil
}
