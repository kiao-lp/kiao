package apm

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"syscall"
	"time"

	"kiao/agentic-resource-manager/core/entities"
)

type Compiler struct {
	Binary   string
	GitSeeds []string
}

func (c Compiler) Run(ctx context.Context, directory string, args ...string) ([]byte, error) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	step := "APM"
	if len(args) > 0 {
		step += " " + args[0]
	}
	binary := c.Binary
	if binary == "" {
		binary = "apm"
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = directory
	cmd.Env = append(os.Environ(), "NO_COLOR=1", "PYTHONUNBUFFERED=1")
	if len(args) > 0 && args[0] == "install" {
		cmd.Args = append(cmd.Args, "--verbose")
	}
	// Git subprocesses can keep the output pipe open after APM is killed.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.WaitDelay = time.Second
	if len(c.GitSeeds) > 0 && slices.Contains(args, "--frozen") {
		env, err := c.frozenGitEnvironment(ctx, directory)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, apmTimeout(step, started, "The deadline expired while checking the bundled Git dependencies.")
		}
		if err != nil {
			return nil, &entities.OperationError{Message: "APM could not read the bundled Git dependency catalogue.", Cause: err}
		}
		cmd.Env = append(cmd.Env, env...)
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, apmTimeout(step, started, apmProgress(string(output)))
		}
		return nil, &entities.OperationError{Message: apmFailure(step, string(output), err), Cause: err}
	}
	return output, nil
}

func apmTimeout(step string, started time.Time, detail string) error {
	return &entities.OperationError{
		Message: fmt.Sprintf("%s timed out after %s. %s", step, time.Since(started).Round(time.Millisecond), detail),
		Cause:   context.DeadlineExceeded,
	}
}

const repositoryID = `[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+`

var (
	missingLocalDependency = regexp.MustCompile(`Local package path does not exist: ((?:\./|\.\./)[A-Za-z0-9._/-]{1,120})\.\s`)
	manifestLine           = regexp.MustCompile(`/apm\.yml["'], line ([0-9]{1,9})`)
	resolvingDependency    = regexp.MustCompile(`^\[>\] Resolving (` + repositoryID + `)\.\.\.$`)
	completedPhase         = regexp.MustCompile(`^Phase: ([a-z_]{1,30}) -> `)
	failedDependency       = regexp.MustCompile(`(?i)(?:Failed to download dependency|Failed to resolve transitive dep|No matching tag for(?: transitive dep)?) (` + repositoryID + `)(?::| \()`)
	deniedGitTransport     = regexp.MustCompile(`transport '(file|https?|ssh)' not allowed`)
)

// Report only recognized progress and repository identifiers from APM output.
// Command diagnostics can include credentials.
func apmProgress(output string) string {
	last := "The deadline expired before a dependency or phase could be identified."
	for line := range strings.SplitSeq(output, "\n") {
		line = strings.TrimSpace(line)
		if match := resolvingDependency.FindStringSubmatch(line); match != nil && len(match[1]) <= 160 {
			last = fmt.Sprintf("APM last reported resolving dependency %q.", match[1])
		} else if match := completedPhase.FindStringSubmatch(line); match != nil {
			phase := strings.ReplaceAll(match[1], "_", " ")
			last = fmt.Sprintf("The last completed APM phase was %q.", phase)
		} else if line == "[>] Installing dependencies from apm.yml..." {
			last = "APM last reported starting dependency installation from apm.yml."
		}
	}
	return last
}

func apmFailure(step, output string, err error) string {
	diagnostic := strings.Join(strings.Fields(strings.ToLower(output)), " ")
	dependency := "a dependency"
	if match := failedDependency.FindStringSubmatch(output); match != nil && len(match[1]) <= 160 {
		dependency = fmt.Sprintf("dependency %q", match[1])
	}
	switch {
	case errors.Is(err, exec.ErrNotFound), errors.Is(err, os.ErrNotExist), errors.Is(err, os.ErrPermission):
		return "APM could not start. Check the APM installation and KIAO_APM_BINARY on the resource manager's machine."
	case strings.Contains(diagnostic, "no apm.yml found"):
		return "APM could not find apm.yml. Add it to the root of the resource repository."
	case strings.Contains(diagnostic, "failed to parse apm.yml"), strings.Contains(diagnostic, "invalid yaml format"):
		if location := manifestLine.FindStringSubmatch(output); location != nil {
			return fmt.Sprintf("APM could not read apm.yml. Check the YAML near line %s.", location[1])
		}
		return "APM could not read apm.yml. Check its YAML syntax and dependency declarations."
	case strings.Contains(diagnostic, "apm.lock.yaml is out of sync"), strings.Contains(diagnostic, "--frozen requires apm.lock.yaml"),
		strings.Contains(diagnostic, "--frozen could not read apm.lock.yaml"), strings.Contains(diagnostic, "--frozen cannot read the lockfile"),
		strings.Contains(diagnostic, "replacement rules differ from apm.lock.yaml"):
		return "APM could not use apm.lock.yaml. Regenerate it from apm.yml and commit the updated lockfile."
	case strings.Contains(diagnostic, "local package path does not exist"):
		if path := missingLocalDependency.FindStringSubmatch(output); path != nil {
			return fmt.Sprintf("APM could not find the local dependency %q. Restore it or correct its path in apm.yml.", path[1])
		}
		return "APM could not find a local dependency. Check the paths in apm.yml on the resource manager's machine."
	case strings.Contains(diagnostic, "authentication failed"), strings.Contains(diagnostic, "authorization failed"),
		strings.Contains(diagnostic, "permission denied (publickey"), strings.Contains(diagnostic, "could not read username"),
		strings.Contains(diagnostic, "returned error: 401"), strings.Contains(diagnostic, "returned error: 403"):
		return "APM could not authenticate to " + dependency + ". Check the resource manager's Git access to the repository or the bundled copy of its locked commit."
	case strings.Contains(diagnostic, "host key verification failed"):
		return "Git could not verify the SSH server for " + dependency + ". Check the resource manager's SSH host configuration."
	case strings.Contains(diagnostic, "ssl certificate problem"), strings.Contains(diagnostic, "certificate verification failed"):
		return "Git could not verify the TLS certificate for " + dependency + ". Check the resource manager's certificate trust."
	case deniedGitTransport.MatchString(diagnostic):
		transport := deniedGitTransport.FindStringSubmatch(diagnostic)[1]
		return fmt.Sprintf("Git disallowed the %s transport for %s. Check the resource manager's Git transport configuration.", transport, dependency)
	case strings.Contains(diagnostic, "could not resolve host"):
		return "Git could not resolve the hostname for " + dependency + ". Check DNS from the resource manager."
	case strings.Contains(diagnostic, "failed to connect"),
		strings.Contains(diagnostic, "could not connect to"), strings.Contains(diagnostic, "connection refused"),
		strings.Contains(diagnostic, "connection timed out"), strings.Contains(diagnostic, "network is unreachable"):
		return "APM could not reach " + dependency + ". Check its URL and the resource manager's network connection."
	case strings.Contains(diagnostic, "repository not found"), strings.Contains(diagnostic, "returned error: 404"):
		return "Git could not access the repository for " + dependency + ". Check its URL and the resource manager's Git access."
	case strings.Contains(diagnostic, "no matching tag for"):
		return "APM could not find a Git tag matching the version of " + dependency + ". Check the version constraints in apm.yml."
	case strings.Contains(diagnostic, "couldn't find remote ref"), strings.Contains(diagnostic, "not our ref"):
		return "Git could not find the requested revision for " + dependency + ". Check the reference in apm.yml or apm.lock.yaml."
	case strings.Contains(diagnostic, "failed to download dependency"), strings.Contains(diagnostic, "failed to resolve transitive dep"):
		return "APM could not fetch " + dependency + ". Check the dependency's Git URL, reference and access permissions."
	case strings.Contains(diagnostic, "no space left on device"):
		return step + " ran out of storage. Free space on the resource manager's machine."
	case strings.Contains(diagnostic, "permission denied"), strings.Contains(diagnostic, "read-only file system"):
		return step + " could not access a file. Check the permissions of the resource and APM cache directories."
	case step == "APM compile":
		return "APM could not compile the agent. Check apm.yml and the sources under .apm."
	default:
		return step + " failed. Check the dependency paths, Git references and targets in apm.yml."
	}
}
