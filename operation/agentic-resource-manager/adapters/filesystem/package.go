package filesystem

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

type localResource struct {
	Name   string `json:"name"`
	Commit string `json:"commit"`
}
type localLock struct {
	Resources []localResource `json:"resources"`
}

func localAPMDependencyPath(dependency any) string {
	switch value := dependency.(type) {
	case string:
		if strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") || strings.HasPrefix(value, "~/") || filepath.IsAbs(value) {
			return value
		}
	case map[string]any:
		if value["git"] == nil {
			path, _ := value["path"].(string)
			return path
		}
	}
	return ""
}

func outsideProject(relative string) bool {
	return relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// managedLocalSource finds the source clone of an external or captured resource.
func (s *Store) managedLocalSource(project, directory string) (string, string, error) {
	relative, err := filepath.Rel(project, directory)
	if err != nil {
		return "", "", err
	}
	name := filepath.Base(directory)
	external := outsideProject(relative)
	if !external && relative != filepath.Join(".apm", "resources", name) {
		return "", "", nil
	}
	known, err := s.resource(name)
	if !external && errors.Is(err, entities.ErrNotFound) {
		return name, "", nil
	}
	if err != nil {
		return "", "", err
	}
	known, err = filepath.Abs(known)
	if err != nil {
		return "", "", err
	}
	if external && directory != known {
		return "", "", entities.Invalidf("dependency %s must name a configured resource repository", relative)
	}
	return name, known, nil
}

func (s *Store) lockLocalDependencies(ctx context.Context, project string) error {
	project, err := filepath.Abs(project)
	if err != nil {
		return err
	}
	lock := localLock{Resources: []localResource{}}
	if data, e := os.ReadFile(filepath.Join(project, "kiao.lock.json")); e == nil {
		if err = json.Unmarshal(data, &lock); err != nil {
			return err
		}
	}
	seen := map[string]bool{}
	used := map[string]bool{}
	var visit func(string, string) error
	visit = func(absolute, original string) error {
		if seen[absolute] {
			return nil
		}
		seen[absolute] = true
		manifestPath := filepath.Join(absolute, "apm.yml")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			return err
		}
		var manifest map[string]any
		if err = yaml.Unmarshal(data, &manifest); err != nil {
			return err
		}
		dependencies, _ := manifest["dependencies"].(map[string]any)
		apm, _ := dependencies["apm"].([]any)
		changed := false
		for i, dep := range apm {
			relative := localAPMDependencyPath(dep)
			if relative == "" {
				continue
			}
			object, _ := dep.(map[string]any)
			if filepath.IsAbs(relative) || strings.HasPrefix(relative, "~/") {
				return entities.Invalidf("local APM dependencies must use relative paths")
			}
			directory := filepath.Clean(filepath.Join(absolute, relative))
			// Dependencies in a captured resource may point to a sibling of its source clone.
			if original != absolute && outsideProject(filepath.Clean(relative)) {
				directory = filepath.Clean(filepath.Join(original, relative))
			}
			name, known, err := s.managedLocalSource(project, directory)
			if err != nil {
				return err
			}
			if known != "" {
				remote, err := s.dependencyRemote(ctx, known)
				if err != nil {
					return err
				}
				if remote != "" {
					delete(object, "path")
					if object == nil {
						object = map[string]any{}
					}
					object["git"] = remote
					apm[i] = object
					changed = true
					continue
				}
			}
			inProject, err := filepath.Rel(project, directory)
			if err != nil {
				return err
			}
			if !outsideProject(inProject) {
				if resourcePath, ok := strings.CutPrefix(filepath.ToSlash(inProject), ".apm/resources/"); ok {
					name, _, _ := strings.Cut(resourcePath, "/")
					used[name] = true
				}
				if !strings.HasPrefix(relative, "./") && !strings.HasPrefix(relative, "../") && object != nil {
					object["path"] = "./" + relative
					apm[i] = object
					changed = true
				}
				if err = visit(directory, directory); err != nil {
					return err
				}
				continue
			}
			vendor := filepath.Join(project, ".apm", "resources", name)
			if !seen[vendor] {
				revision, err := s.captureLocalDependency(ctx, directory, vendor, name)
				if err != nil {
					return err
				}
				for i := range lock.Resources {
					if lock.Resources[i].Name == name {
						lock.Resources[i].Commit = revision
						revision = ""
						break
					}
				}
				if revision != "" {
					lock.Resources = append(lock.Resources, localResource{Name: name, Commit: revision})
				}
			}
			used[name] = true
			if object == nil {
				object = map[string]any{}
			}
			target, err := relativeDependencyPath(absolute, vendor)
			if err != nil {
				return err
			}
			object["path"] = target
			apm[i] = object
			changed = true
			if err = visit(vendor, directory); err != nil {
				return err
			}
		}
		if changed {
			dependencies["apm"] = apm
			manifest["dependencies"] = dependencies
			data, err = yaml.Marshal(manifest)
			if err != nil {
				return err
			}
			if err = atomicWrite(manifestPath, data); err != nil {
				return err
			}
		}
		return nil
	}
	if err = visit(project, project); err != nil {
		return err
	}
	resources := []localResource{}
	for _, resource := range lock.Resources {
		if !validRepositoryName(resource.Name) {
			return entities.Invalidf("invalid resource name in kiao.lock.json")
		}
		if used[resource.Name] {
			resources = append(resources, resource)
		} else if err = os.RemoveAll(filepath.Join(project, ".apm", "resources", resource.Name)); err != nil {
			return err
		}
	}
	lock.Resources = resources
	sort.Slice(lock.Resources, func(i, j int) bool { return lock.Resources[i].Name < lock.Resources[j].Name })
	data, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(project, "kiao.lock.json"), append(data, '\n'))
}

func (s *Store) captureLocalDependency(ctx context.Context, source, destination, name string) (string, error) {
	status, err := s.git(ctx, source, "status", "--porcelain")
	if err != nil {
		return "", err
	}
	if len(status) > 0 {
		return "", entities.Conflictf("resource %s has uncommitted changes", name)
	}
	commit, err := s.git(ctx, source, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	revision := strings.TrimSpace(string(commit))
	archive, err := s.git(ctx, source, "archive", "--format=tar", revision)
	if err != nil {
		return "", err
	}
	if err = os.RemoveAll(destination); err != nil {
		return "", err
	}
	return revision, extractResource(destination, archive)
}

func extractResource(destination string, data []byte) error {
	reader := tar.NewReader(bytes.NewReader(data))
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if header.Typeflag == tar.TypeXGlobalHeader || header.Typeflag == tar.TypeXHeader {
			continue
		}
		name := path.Clean(header.Name)
		if name == ".." || strings.HasPrefix(name, "../") || path.IsAbs(name) {
			return entities.Invalidf("resource archive leaves project")
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if header.Typeflag == tar.TypeDir {
			if err = os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if header.Typeflag != tar.TypeReg || header.Size < 0 || header.Size > 8<<20 {
			return entities.Invalidf("invalid resource archive entry")
		}
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		content, err := io.ReadAll(reader)
		if err != nil {
			return err
		}
		if err = atomicWrite(target, content); err != nil {
			return err
		}
	}
}

var commitID = regexp.MustCompile(`^[0-9a-f]{40}$`)

func (s *Store) AgentPackage(ctx context.Context, id, commit string) (*entities.AgentPackage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !commitID.MatchString(commit) {
		return nil, entities.Invalidf("a full Git commit is required")
	}
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	versions, err := s.versions(ctx, dir, id)
	if err != nil {
		return nil, err
	}
	published := false
	for _, v := range versions {
		if v.Commit == commit {
			published = true
		}
	}
	if !published {
		return nil, entities.NotFoundf("agent publication %s", commit)
	}
	cacheKey := entities.AgentPackageFormat + ":" + id + ":" + commit
	if s.cache != nil {
		if data, e := s.cache.Read(cacheKey); e == nil {
			var bundle entities.AgentPackage
			if e = json.Unmarshal(data, &bundle); e == nil && bundle.Format == entities.AgentPackageFormat && bundle.Commit == commit && bundle.Project == "deployment" {
				return &bundle, nil
			}
		}
	}

	bundle, err := s.buildDeployment(ctx, dir, commit)
	if err != nil {
		return nil, err
	}
	if s.cache != nil {
		content, e := json.Marshal(bundle)
		if e != nil {
			return nil, e
		}
		if e = s.cache.Write(cacheKey, content); e != nil {
			return nil, e
		}
	}

	return bundle, nil
}
