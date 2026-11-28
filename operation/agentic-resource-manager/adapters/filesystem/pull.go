package filesystem

import (
	"context"
	"strconv"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
)

// upstream resolves the remote branch the working tree fast-forwards from.
func (s *Store) upstream(ctx context.Context, dir, remote string) (string, error) {
	if output, err := s.git(ctx, dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil {
		return strings.TrimSpace(string(output)), nil
	}
	branch, err := s.git(ctx, dir, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return "", entities.Conflictf("The agent repository has no checked-out branch to pull into.")
	}
	name := strings.TrimSpace(string(branch))
	candidate := "refs/remotes/" + remote + "/" + name
	if _, err := s.git(ctx, dir, "rev-parse", "--verify", "--quiet", candidate); err != nil {
		return "", entities.Conflictf("Branch %q has no upstream branch on the remote. Set one in the repository before pulling.", name)
	}
	return candidate, nil
}

// fetchBehind fetches the remote and counts its commits missing from the working tree.
func (s *Store) fetchBehind(ctx context.Context, dir, remote string) (string, int, error) {
	if _, err := s.git(ctx, dir, "fetch", "--quiet", "--no-prune", remote); err != nil {
		return "", 0, err
	}
	upstream, err := s.upstream(ctx, dir, remote)
	if err != nil {
		return "", 0, err
	}
	output, err := s.git(ctx, dir, "rev-list", "--count", "HEAD.."+upstream)
	if err != nil {
		return "", 0, err
	}
	behind, err := strconv.Atoi(strings.TrimSpace(string(output)))
	if err != nil {
		return "", 0, &entities.OperationError{Message: "Git could not count the remote's commits.", Cause: err}
	}
	return upstream, behind, nil
}

// Remote reports what the agent's Git remote holds beyond its working tree.
func (s *Store) Remote(ctx context.Context, id string) (*entities.AgentRemote, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	remote, _, err := s.remote(ctx, dir)
	if err != nil {
		return &entities.AgentRemote{Problem: err.Error()}, nil
	}
	if remote == "" {
		return &entities.AgentRemote{}, nil
	}
	_, behind, err := s.fetchBehind(ctx, dir, remote)
	if err != nil {
		return &entities.AgentRemote{HasRemote: true, Problem: err.Error()}, nil
	}
	return &entities.AgentRemote{HasRemote: true, Behind: behind}, nil
}

// PullAgent fast-forwards the working tree to its remote branch.
func (s *Store) PullAgent(ctx context.Context, id string) (*entities.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, _, err := s.find(ctx, id)
	if err != nil {
		return nil, err
	}
	remote, _, err := s.remote(ctx, dir)
	if err != nil {
		return nil, err
	}
	if remote == "" {
		return nil, entities.Invalidf("the agent repository has no Git remote to pull from")
	}
	upstream, behind, err := s.fetchBehind(ctx, dir, remote)
	if err != nil {
		return nil, err
	}
	if behind == 0 {
		return nil, entities.Conflictf("The remote has no changes to pull.")
	}
	if _, err = s.git(ctx, dir, "merge", "--ff-only", upstream); err != nil {
		return nil, err
	}
	_, pulled, err := s.find(ctx, id)
	if err != nil {
		return nil, entities.Conflictf("The pulled commit no longer describes agent %s.", id)
	}
	return pulled, nil
}
