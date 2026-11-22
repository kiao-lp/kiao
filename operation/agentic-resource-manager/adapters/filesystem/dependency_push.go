package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

func (s *Store) checkDraftPublication(ctx context.Context, dir, remote, tag, confirmation string) error {
	_, enabled, err := s.dependencyOverrides(ctx, dir)
	if err != nil {
		return err
	}
	if len(enabled) > 0 {
		_, dependencies, err := readDependencyManifest(dir)
		if err != nil {
			return err
		}
		overrides, err := s.activeDependencyOverrides(ctx, dir, dependencies, enabled)
		if err != nil {
			return err
		}
		if len(overrides) > 0 {
			names := make([]string, 0, len(overrides))
			for _, name := range overrides {
				names = append(names, name)
			}
			slices.Sort(names)
			return entities.Conflictf("turn off Local for %s before publishing", strings.Join(slices.Compact(names), ", "))
		}
	}
	if remote == "" {
		return nil
	}
	project, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	names := map[string]bool{}
	var visit func(string, string, []byte) error
	visit = func(owner, resourceRoot string, data []byte) error {
		seen[owner] = true
		dependencies, err := apmDependencies(data)
		if err != nil {
			return err
		}
		for _, dep := range dependencies {
			relative := localAPMDependencyPath(dep)
			if relative == "" {
				continue
			}
			if filepath.IsAbs(relative) || strings.HasPrefix(relative, "~/") {
				return entities.Invalidf("local APM dependencies must use relative paths")
			}
			directory := filepath.Join(owner, relative)
			if seen[directory] {
				continue
			}
			root := resourceRoot
			within, err := filepath.Rel(resourceRoot, directory)
			if err != nil {
				return err
			}
			if outsideProject(within) || resourceRoot == project {
				name, source, err := s.managedLocalSource(project, directory)
				if err != nil {
					return err
				}
				if source != "" {
					git, err := s.dependencyRemote(ctx, source)
					if err != nil {
						return err
					}
					if git != "" {
						continue
					}
				}
				if name != "" {
					names[name] = true
					root = directory
				}
			}
			child, err := os.ReadFile(filepath.Join(directory, manifestFile))
			if err != nil {
				return err
			}
			if err = visit(directory, root, child); err != nil {
				return err
			}
		}
		return nil
	}
	data, err := os.ReadFile(filepath.Join(dir, manifestFile))
	if err != nil {
		return err
	}
	if err = visit(project, project, data); err != nil {
		return err
	}
	return confirmDependencyPush(names, confirmation, "publish", project, remote, tag, string(data))
}

func (s *Store) checkAgentGitPush(ctx context.Context, dir, remote, confirmation string) error {
	ref, err := s.git(ctx, dir, "rev-parse", "HEAD")
	if err != nil {
		return err
	}
	data, err := s.git(ctx, dir, "show", "HEAD:"+manifestFile)
	if err != nil {
		return err
	}
	apm, err := apmDependencies(data)
	if err != nil {
		return err
	}
	names := map[string]bool{}
	for _, dep := range apm {
		if local := localAPMDependencyPath(dep); local != "" {
			name := filepath.Base(local)
			if outsideProject(filepath.Clean(local)) || filepath.Clean(local) == filepath.Join(".apm", "resources", name) {
				names[name] = true
			}
		}
	}
	if data, e := s.git(ctx, dir, "show", "HEAD:kiao.lock.json"); e == nil {
		var lock localLock
		if err = json.Unmarshal(data, &lock); err != nil {
			return err
		}
		for _, dep := range lock.Resources {
			names[dep.Name] = true
		}
	}
	return confirmDependencyPush(names, confirmation, "push", dir, remote, string(ref))
}

func apmDependencies(data []byte) ([]any, error) {
	var manifest struct {
		Dependencies struct {
			APM []any
		}
	}
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, entities.Invalidf("invalid %s: %s", manifestFile, err)
	}
	return manifest.Dependencies.APM, nil
}

func confirmDependencyPush(names map[string]bool, confirmation string, state ...string) error {
	if len(names) == 0 {
		return nil
	}
	dependencies := make([]string, 0, len(names))
	for name := range names {
		dependencies = append(dependencies, name)
	}
	slices.Sort(dependencies)
	hash := sha256.Sum256([]byte(strings.Join(append(state, dependencies...), "\x00")))
	token := hex.EncodeToString(hash[:])
	if confirmation != token {
		return &entities.PushConfirmation{Dependencies: dependencies, Token: token}
	}
	return nil
}
