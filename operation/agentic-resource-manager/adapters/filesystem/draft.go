package filesystem

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

func (s *Store) DraftAgentPackage(ctx context.Context, id string) (*entities.DraftAgentPackage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, agent, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	if agent.DraftError != "" {
		return nil, entities.Invalidf("invalid APM draft: %s", agent.DraftError)
	}
	project, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	staging, err := os.MkdirTemp("", "kiao-agent-draft-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	source := filepath.Join(staging, "source")
	manifest, err := s.draftManifest(ctx, project, source)
	if err != nil {
		return nil, err
	}
	if err = os.Mkdir(source, 0700); err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(source, manifestFile), manifest, 0600); err != nil {
		return nil, err
	}
	deployment := filepath.Join(staging, "deployment")
	if err = os.Mkdir(deployment, 0700); err != nil {
		return nil, err
	}
	if _, err = s.compiler.Run(ctx, source, "install", "--trust-transitive-mcp", "--root", deployment); err != nil {
		return nil, entities.Invalidf("could not install the draft's APM dependencies: %s", err)
	}
	lock, err := installedAPMLock(deployment)
	if err != nil {
		return nil, err
	}
	version := agent.Publish("", time.Time{})
	version.DraftID = rand.Text()
	version.Repository = agent.Repository
	digest := sha256.Sum256(lock)
	version.LockDigest = hex.EncodeToString(digest[:])
	bundle, err := collectDeployment(staging, &entities.AgentPackage{
		Format: entities.AgentPackageFormat, Project: "deployment", DraftID: version.DraftID,
	})
	if err != nil {
		return nil, err
	}
	return &entities.DraftAgentPackage{Agent: version, Package: *bundle}, nil
}

func (s *Store) draftManifest(ctx context.Context, project, stage string) ([]byte, error) {
	document, dependencies, err := readDependencyManifest(project)
	if err != nil {
		return nil, err
	}
	_, enabled, err := s.dependencyOverrides(ctx, project)
	if err != nil {
		return nil, err
	}
	overrides, err := s.activeDependencyOverrides(ctx, project, dependencies, enabled)
	if err != nil {
		return nil, err
	}
	for i, node := range dependencies.Content {
		var directory string
		if name := overrides[node]; name != "" {
			directory, err = s.resource(name)
			if err != nil {
				return nil, err
			}
		} else {
			var dep any
			if err = node.Decode(&dep); err != nil {
				return nil, err
			}
			relative := localAPMDependencyPath(dep)
			if relative == "" {
				continue
			}
			if filepath.IsAbs(relative) || strings.HasPrefix(relative, "~/") {
				return nil, entities.Invalidf("local APM dependencies must use relative paths")
			}
			directory = filepath.Join(project, relative)
			_, source, err := s.managedLocalSource(project, directory)
			if err != nil {
				return nil, err
			}
			if source != "" {
				remote, err := s.dependencyRemote(ctx, source)
				if err != nil {
					return nil, err
				}
				if remote != "" {
					dependencies.Content[i] = dependencyWithSource(node, "git", remote)
					continue
				}
				directory = source
			}
		}
		relative, err := relativeDependencyPath(stage, directory)
		if err != nil {
			return nil, err
		}
		dependencies.Content[i] = dependencyWithSource(node, "path", relative)
	}
	return yaml.Marshal(document)
}
