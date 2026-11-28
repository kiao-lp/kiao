package gitcli

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"

	"kiao/agentic-resource-manager/core/entities"
)

type Controller struct{}

func (Controller) Run(ctx context.Context, directory string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = directory
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, &entities.OperationError{Message: gitFailure(ctx, gitAction(args), string(output), err), Cause: err}
	}
	return output, nil
}

func gitAction(args []string) string {
	for len(args) >= 2 && args[0] == "-c" {
		args = args[2:]
	}
	if len(args) == 0 {
		return "command"
	}
	return args[0]
}

func gitFailure(ctx context.Context, action, output string, err error) string {
	step := "Git " + action
	diagnostic := strings.ToLower(output)
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return step + " timed out. Try again."
	case errors.Is(err, exec.ErrNotFound):
		return "Git is unavailable. Install Git on the resource manager's machine."
	case strings.Contains(diagnostic, "authentication failed"), strings.Contains(diagnostic, "permission denied (publickey"),
		strings.Contains(diagnostic, "could not read username"), strings.Contains(diagnostic, "could not read password"),
		strings.Contains(diagnostic, "access denied"), strings.Contains(diagnostic, "write access to repository not granted"),
		strings.Contains(diagnostic, "returned error: 401"), strings.Contains(diagnostic, "returned error: 403"):
		return step + " was denied. Check the resource manager's Git credentials and repository permissions."
	case strings.Contains(diagnostic, "host key verification failed"):
		return step + " could not verify the Git server's SSH host key. Check the resource manager's SSH configuration."
	case strings.Contains(diagnostic, "ssl certificate problem"), strings.Contains(diagnostic, "certificate verification failed"):
		return step + " could not verify the Git server's certificate. Check the resource manager's certificate trust."
	case strings.Contains(diagnostic, "could not resolve host"), strings.Contains(diagnostic, "could not resolve hostname"),
		strings.Contains(diagnostic, "failed to connect"), strings.Contains(diagnostic, "connection refused"),
		strings.Contains(diagnostic, "connection timed out"), strings.Contains(diagnostic, "network is unreachable"):
		return step + " could not reach the Git server. Check the hostname and the resource manager's network connection."
	case action == "clone" && strings.Contains(diagnostic, "fatal: repository ") && strings.Contains(diagnostic, "' does not exist"):
		return "Git could not find the repository. Check that the path exists on the resource manager's machine."
	case strings.Contains(diagnostic, "repository not found"), strings.Contains(diagnostic, "does not appear to be a git repository"),
		strings.Contains(diagnostic, "returned error: 404"), strings.Contains(diagnostic, "could not read from remote repository"),
		strings.Contains(diagnostic, "fatal: repository ") && strings.Contains(diagnostic, "' not found"):
		return step + " could not access the repository. Check its URL or path and the resource manager's Git access."
	case strings.Contains(diagnostic, "not a git repository"):
		return step + " needs a Git working tree. Check the resource's repository."
	case strings.Contains(diagnostic, "non-fast-forward"), strings.Contains(diagnostic, "not possible to fast-forward"),
		strings.Contains(diagnostic, "(fetch first)"):
		return step + " requires reconciling the local and remote commits before retrying."
	case strings.Contains(diagnostic, "would be overwritten"):
		return step + " would overwrite local changes. Commit or stash them before retrying."
	case strings.Contains(diagnostic, "couldn't find remote ref"), strings.Contains(diagnostic, "no such ref was fetched"):
		return step + " could not find the configured branch on the remote. Check the branch name."
	case strings.Contains(diagnostic, "no tracking information"), strings.Contains(diagnostic, "has no upstream branch"):
		return step + " requires an upstream branch. Set it in the resource's repository."
	case strings.Contains(diagnostic, "[remote rejected]"), strings.Contains(diagnostic, "protected branch"):
		return "The Git server rejected the push. Check its branch rules and write permissions."
	case strings.Contains(diagnostic, "no space left on device"):
		return step + " ran out of storage. Free space on the resource manager's machine."
	case strings.Contains(diagnostic, "permission denied"), strings.Contains(diagnostic, "read-only file system"), errors.Is(err, os.ErrPermission):
		return step + " could not access a file. Check filesystem permissions for the repository."
	case action == "clone":
		return "Git could not clone the repository. Check the URL or path and the resource manager's Git access."
	case action == "push" || action == "pull" || action == "fetch":
		return step + " failed. Check the remote configuration and Git access on the resource manager's machine."
	default:
		return step + " failed. Check the resource's Git working tree."
	}
}
