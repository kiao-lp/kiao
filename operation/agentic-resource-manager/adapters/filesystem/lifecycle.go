package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
)

func cloneName(remote string) (string, error) {
	if strings.HasPrefix(remote, "-") || strings.ContainsAny(remote, "\x00\r\n") {
		return "", entities.Invalidf("invalid Git repository URL")
	}
	name := remote
	if parsed, err := url.Parse(remote); err == nil && (parsed.Host != "" || parsed.Scheme == "file") && parsed.Path != "" {
		name = parsed.Path
	} else if host, path, ok := strings.Cut(remote, ":"); ok && !strings.ContainsAny(host, "/\\") && !filepath.IsAbs(remote) {
		name = path
	}
	name = strings.TrimSuffix(filepath.Base(strings.TrimRight(name, "/")), ".git")
	if !validRepositoryName(name) {
		return "", entities.Invalidf("invalid Git repository name")
	}
	return name, nil
}

func (s *Store) ImportAgent(ctx context.Context, remote string, newDraft func(project string) (*entities.Agent, error)) (*entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.AgentRoot == "" {
		return nil, entities.Invalidf("no agent directory configured")
	}
	name, err := cloneName(remote)
	if err != nil {
		return nil, err
	}
	root, err := filepath.Abs(s.AgentRoot)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	destination := filepath.Join(root, name)
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return nil, entities.Conflictf("repository %s already exists", name)
	}
	staging, err := os.MkdirTemp(root, ".clone-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	if _, err = s.git(ctx, root, "clone", "--origin", "origin", "--", remote, staging); err != nil {
		return nil, err
	}
	if err = s.checkoutAgentBranch(ctx, staging); err != nil {
		return nil, err
	}
	_, err = os.Lstat(filepath.Join(staging, configurationFile))
	initialize := os.IsNotExist(err)
	var agent *entities.Agent
	if initialize {
		if newDraft == nil {
			return nil, entities.Invalidf("the Git repository must contain a managed agent to reinstall it")
		}
		agent, err = newDraft(name)
	} else {
		agent, err = s.read(ctx, staging, "", "")
		if err != nil {
			return nil, entities.Invalidf("invalid agent package: %s", err)
		}
	}
	if err != nil {
		return nil, err
	}
	existing, err := s.list(ctx)
	if err != nil {
		return nil, err
	}
	for _, one := range existing {
		if one.ID == agent.ID || strings.EqualFold(one.Name, agent.Name) {
			return nil, entities.Conflictf("agent %s is already installed", one.Name)
		}
	}
	if initialize {
		err = s.initializeRemoteAgent(ctx, staging, name, agent)
	} else {
		err = s.restoreImportedAgent(ctx, staging, agent)
	}
	if err != nil {
		return nil, err
	}
	if err = os.Rename(staging, destination); err != nil {
		return nil, err
	}
	_, agent, err = s.find(ctx, agent.ID)
	return agent, err
}

func (s *Store) checkoutAgentBranch(ctx context.Context, dir string) error {
	if _, err := s.git(ctx, dir, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"); err == nil {
		return nil
	}
	output, err := s.git(ctx, dir, "for-each-ref", "--format=%(refname)", "refs/remotes/origin")
	if err != nil {
		return err
	}
	branches := strings.Fields(string(output))
	switch len(branches) {
	case 0:
		return nil
	case 1:
		_, err = s.git(ctx, dir, "switch", "--track", branches[0])
		return err
	default:
		return entities.Conflictf("set the Git repository's default branch before adding it")
	}
}

func (s *Store) restoreImportedAgent(ctx context.Context, dir string, agent *entities.Agent) error {
	if agent.DraftError != "" {
		return entities.Invalidf("invalid agent package: %s", agent.DraftError)
	}
	if err := clearManagedSkillProjections(dir); err != nil {
		return err
	}
	args := []string{"install", "--trust-transitive-mcp"}
	if _, err := os.Stat(filepath.Join(dir, "apm.lock.yaml")); err == nil {
		args = append(args, "--frozen")
	}
	if _, err := s.compiler.Run(ctx, dir, args...); err != nil {
		return err
	}
	return s.compileAgent(ctx, dir, agent)
}

func (s *Store) compileAgent(ctx context.Context, dir string, agent *entities.Agent) error {
	target := "codex"
	if len(agent.Harnesses) != 0 {
		target = "codex,claude"
	}
	_, err := s.compiler.Run(ctx, dir, "compile", "--target", target)
	return err
}

func (s *Store) deletionStatus(ctx context.Context, dir string) (*entities.DeletionStatus, error) {
	status := &entities.DeletionStatus{}
	changes, err := s.git(ctx, dir, "status", "--porcelain=v1", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	status.Dirty = len(changes) > 0
	refs, err := s.git(ctx, dir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags")
	if err != nil {
		return nil, err
	}
	remoteName, remote, err := s.remote(ctx, dir)
	status.NoRemote = remoteName == "" && err == nil
	if err != nil {
		status.RemoteUnavailable, status.Unpushed = true, true
	}
	if !status.NoRemote && !status.RemoteUnavailable {
		if _, err = s.git(ctx, dir, "fetch", "--quiet", "--no-tags", "--no-prune", remoteName); err != nil {
			status.RemoteUnavailable, status.Unpushed = true, true
		}
	}
	var advertised []byte
	if !status.NoRemote && !status.RemoteUnavailable {
		advertised, err = s.git(ctx, dir, "ls-remote", "--heads", "--tags", remoteName)
		if err != nil {
			status.RemoteUnavailable, status.Unpushed = true, true
		} else {
			remoteRefs := map[string]string{}
			for _, line := range strings.Split(string(advertised), "\n") {
				parts := strings.Fields(line)
				if len(parts) == 2 {
					remoteRefs[parts[1]] = parts[0]
				}
			}
			for _, line := range strings.Split(string(refs), "\n") {
				parts := strings.Fields(line)
				if len(parts) != 2 {
					continue
				}
				hash := remoteRefs[parts[0]]
				if hash == parts[1] {
					continue
				}
				if hash == "" || strings.HasPrefix(parts[0], "refs/tags/") {
					status.Unpushed = true
					break
				}
				if _, err = s.git(ctx, dir, "merge-base", "--is-ancestor", parts[1], hash); err != nil {
					status.Unpushed = true
					break
				}
			}
			if head, e := s.git(ctx, dir, "rev-parse", "HEAD"); e == nil {
				found := false
				for _, hash := range remoteRefs {
					if _, e = s.git(ctx, dir, "merge-base", "--is-ancestor", strings.TrimSpace(string(head)), hash); e == nil {
						found = true
						break
					}
				}
				if !found {
					status.Unpushed = true
				}
			}
		}
	}
	// Include file contents so an edit after the confirmation invalidates it.
	diff, err := s.git(ctx, dir, "diff", "HEAD", "--binary")
	if err != nil {
		diff, _ = s.git(ctx, dir, "diff", "--binary")
	}
	untracked, err := s.git(ctx, dir, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	digest := sha256.New()
	fmt.Fprintf(digest, "%s\x00%s\x00%s\x00%s\x00%s\x00", dir, remote, refs, advertised, changes)
	digest.Write(diff)
	staged, _ := s.git(ctx, dir, "diff", "--cached", "--binary")
	digest.Write(staged)
	head, _ := s.git(ctx, dir, "rev-parse", "HEAD")
	digest.Write(head)
	branch, _ := s.git(ctx, dir, "symbolic-ref", "-q", "HEAD")
	digest.Write(branch)
	for _, name := range strings.Split(string(untracked), "\x00") {
		if name == "" {
			continue
		}
		file, err := resourceFile(dir, name)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(digest, "%s\x00", name)
		digest.Write(data)
	}
	flags, _ := json.Marshal(status)
	digest.Write(flags)
	status.Confirmation = hex.EncodeToString(digest.Sum(nil))
	return status, nil
}

func (s *Store) DeletionStatus(ctx context.Context, id string) (*entities.DeletionStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.deletionStatus(ctx, dir)
}
