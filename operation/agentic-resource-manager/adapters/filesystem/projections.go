package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

func managedSkillProjections(project string) (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(project, "apm.lock.yaml"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var lock struct {
		Dependencies []struct {
			Hashes map[string]string `yaml:"deployed_file_hashes"`
		} `yaml:"dependencies"`
	}
	if err = yaml.Unmarshal(data, &lock); err != nil {
		return nil, err
	}
	projections := map[string]string{}
	for _, dependency := range lock.Dependencies {
		for name, expected := range dependency.Hashes {
			if strings.HasPrefix(name, ".agents/skills/") || strings.HasPrefix(name, ".claude/skills/") {
				if filepath.ToSlash(filepath.Clean(name)) != name || strings.ContainsAny(name, "\r\n") {
					return nil, entities.Invalidf("invalid skill projection path in apm.lock.yaml")
				}
				projections[name] = expected
			}
		}
	}
	return projections, nil
}

// APM recreates local skill projections after their committed hashes are verified.
func clearManagedSkillProjections(project string) error {
	projections, err := managedSkillProjections(project)
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(projections))
	for name, expected := range projections {
		path, err := resourceFile(project, name)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		hash := sha256.Sum256(content)
		if expected != "sha256:"+hex.EncodeToString(hash[:]) {
			return entities.Conflictf("generated skill %s was edited; preserve its changes before restoring the projection", name)
		}
		paths = append(paths, path)
	}
	for _, path := range paths {
		if err = os.Remove(path); err != nil {
			return err
		}
	}
	return nil
}

// A clean checkout lets APM establish ownership when it installs these files.
func (s *Store) keepSkillProjectionsLocal(ctx context.Context, project string) error {
	projections, err := managedSkillProjections(project)
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(projections))
	for name := range projections {
		if _, err := resourceFile(project, name); err != nil {
			return err
		}
		paths = append(paths, name)
	}
	slices.Sort(paths)
	if err = writeSkillProjectionIgnores(project, paths); err != nil {
		return err
	}
	for chunk := range slices.Chunk(paths, 256) {
		args := append([]string{"--literal-pathspecs", "rm", "--cached", "--ignore-unmatch", "--"}, chunk...)
		if _, err = s.git(ctx, project, args...); err != nil {
			return err
		}
	}
	return nil
}

func writeSkillProjectionIgnores(project string, paths []string) error {
	const header = "# Kiao APM skill projection paths\n"
	const footer = "# End Kiao APM skill projection paths\n"
	path, err := resourceFile(project, ".gitignore")
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	existing := string(data)
	updated := existing
	if prefix, rest, found := strings.Cut(existing, header); found {
		_, remaining, found := strings.Cut(rest, footer)
		if !found {
			return entities.Invalidf("incomplete APM skill projection paths in .gitignore")
		}
		updated = prefix + remaining
	}
	if len(paths) > 0 {
		if updated != "" && !strings.HasSuffix(updated, "\n") {
			updated += "\n"
		}
		var block strings.Builder
		block.WriteString(header)
		escape := strings.NewReplacer(" ", "\\ ", "[", "\\[", "*", "\\*", "?", "\\?")
		for _, name := range paths {
			block.WriteString("/" + escape.Replace(name) + "\n")
		}
		block.WriteString(footer)
		updated += block.String()
	}
	if updated == existing {
		return nil
	}
	return atomicWrite(path, []byte(updated))
}

func (s *Store) restoreResourceDependencies(ctx context.Context, dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "SKILL.md")); err == nil {
		data, err := os.ReadFile(filepath.Join(dir, "apm.yml"))
		if err != nil {
			return err
		}
		var manifest struct {
			Dependencies struct {
				APM []any `yaml:"apm"`
				MCP []any `yaml:"mcp"`
			} `yaml:"dependencies"`
		}
		if err = yaml.Unmarshal(data, &manifest); err != nil {
			return err
		}
		if len(manifest.Dependencies.APM) == 0 && len(manifest.Dependencies.MCP) == 0 {
			_, err = s.compiler.Run(ctx, dir, "deps", "list")
			return err
		}
	}
	_, err := s.compiler.Run(ctx, dir, "install", "--trust-transitive-mcp")
	return err
}
