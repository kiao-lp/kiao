package filesystem

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"

	"kiao/agentic-resource-manager/core/entities"
)

func installedAPMLock(dir string) ([]byte, error) {
	path := filepath.Join(dir, "apm.lock.yaml")
	lock, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// APM omits the lock for a successful install with no dependencies.
		lock = []byte("lockfile_version: '1'\ndependencies: []\n")
		err = atomicWrite(path, lock)
	}
	return lock, err
}

func (s *Store) buildDeployment(ctx context.Context, repository, commit string) (*entities.AgentPackage, error) {
	staging, err := os.MkdirTemp("", "kiao-agent-deployment-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	source := filepath.Join(staging, "source")
	archive, err := s.git(ctx, repository, "archive", "--format=tar", commit)
	if err != nil {
		return nil, err
	}
	if err = extractResource(source, archive); err != nil {
		return nil, err
	}
	lock, err := os.ReadFile(filepath.Join(source, "apm.lock.yaml"))
	if os.IsNotExist(err) {
		return nil, entities.Invalidf("This publication is missing apm.lock.yaml. Publish a new version with its APM lockfile.")
	}
	if err != nil {
		return nil, err
	}
	if err = clearManagedSkillProjections(source); err != nil {
		return nil, err
	}
	deployment := filepath.Join(staging, "deployment")
	if err = os.MkdirAll(deployment, 0700); err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(deployment, "apm.lock.yaml"), lock, 0600); err != nil {
		return nil, err
	}
	if _, err = s.compiler.Run(ctx, source, "install", "--frozen", "--trust-transitive-mcp", "--root", deployment); err != nil {
		return nil, err
	}
	// Deliver the publication's lock even if APM normalizes its deployment copy.
	if err = os.WriteFile(filepath.Join(deployment, "apm.lock.yaml"), lock, 0600); err != nil {
		return nil, err
	}
	bundle := &entities.AgentPackage{Format: entities.AgentPackageFormat, Project: "deployment", Commit: commit}
	return collectDeployment(staging, bundle)
}

func collectDeployment(staging string, bundle *entities.AgentPackage) (*entities.AgentPackage, error) {
	bundle.Files = map[string][]byte{}
	var total int64
	err := filepath.WalkDir(filepath.Join(staging, bundle.Project), func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == ".git" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return entities.Invalidf("deployment contains a non-regular file: %s", file)
		}
		if info.Size() > 8<<20 || total+info.Size() > 64<<20 {
			return entities.Invalidf("agent package exceeds its delivery limit")
		}
		content, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(staging, file)
		if err != nil {
			return err
		}
		total += int64(len(content))
		bundle.Files[filepath.ToSlash(relative)] = content
		return nil
	})
	return bundle, err
}
