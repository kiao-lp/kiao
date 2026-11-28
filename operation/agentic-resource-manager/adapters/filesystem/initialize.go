package filesystem

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
)

const (
	manifestFile         = "apm.yml"
	definitionsDirectory = ".apm/agents"
	definitionSuffix     = ".agent.md"
	initialDraftVersion  = "0.0.0"
)

var outsideSlug = regexp.MustCompile(`[^a-z0-9]+`)

func agentSlug(name, id string) string {
	slug := strings.Trim(outsideSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = id
	}
	if !strings.HasPrefix(slug, "agent-") {
		slug = "agent-" + slug
	}
	return slug
}

func agentDefinitions(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var matches []string
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), definitionSuffix) {
			matches = append(matches, entry.Name())
		}
	}
	return matches, nil
}

func initializeAgentFiles(dir, slug string, agent *entities.Agent) ([]string, error) {
	manifestPath := filepath.Join(dir, manifestFile)
	if _, err := os.Lstat(manifestPath); err == nil {
		return nil, entities.Conflictf("repository already contains %s", manifestFile)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	agentsDir, err := resourceFile(dir, definitionsDirectory)
	if err != nil {
		return nil, err
	}
	definitions, err := agentDefinitions(agentsDir)
	if err != nil {
		return nil, err
	}
	if len(definitions) > 0 {
		return nil, entities.Conflictf("repository already contains an APM agent definition in %s", definitionsDirectory)
	}

	manifest := map[string]any{
		"name": slug, "version": initialDraftVersion, "description": agent.Name, "targets": []string{"codex", "claude"},
		"dependencies": map[string]any{"apm": []any{}},
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err = atomicWrite(manifestPath, append(data, '\n')); err != nil {
		return nil, err
	}
	definition := definitionsDirectory + "/" + slug + definitionSuffix
	if err = write(dir, definition, agent); err != nil {
		return nil, err
	}
	paths := []string{manifestFile, configurationFile, definition}
	ignorePath := filepath.Join(dir, ".gitignore")
	if _, err = os.Lstat(ignorePath); errors.Is(err, os.ErrNotExist) {
		if err = atomicWrite(ignorePath, []byte("apm_modules/\nnode_modules/\n")); err != nil {
			return nil, err
		}
		paths = append(paths, ".gitignore")
	} else if err != nil {
		return nil, err
	}
	return paths, nil
}

func (s *Store) initializeRemoteAgent(ctx context.Context, dir, project string, agent *entities.Agent) error {
	paths, err := initializeAgentFiles(dir, agentSlug(project, agent.ID), agent)
	if err != nil {
		return err
	}
	if _, err = s.git(ctx, dir, append([]string{"add", "--force", "--"}, paths...)...); err != nil {
		return err
	}
	if _, err = s.git(ctx, dir, "-c", "user.name=KIAO", "-c", "user.email=kiao@localhost", "commit", "-m", "feat: initialize APM agent"); err != nil {
		return err
	}
	if _, err = s.git(ctx, dir, "push", "--set-upstream", "origin", "HEAD"); err != nil {
		return &entities.OperationError{Message: err.Error(), Cause: errors.Join(entities.ErrConflict, err)}
	}
	return nil
}
