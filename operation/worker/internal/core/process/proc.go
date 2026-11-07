package process

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ProcResult is the outcome of an external command (kiao.worker.ProcessRunner.ProcResult).
type ProcResult struct {
	Exit   int
	Stdout string
	Stderr string
}

func (r ProcResult) OK() bool { return r.Exit == 0 }

// Combined returns the trimmed stdout and stderr joined with a newline, for display in the UI.
func (r ProcResult) Combined() string {
	s := strings.TrimSpace(r.Stdout)
	e := strings.TrimSpace(r.Stderr)
	switch {
	case s == "":
		return e
	case e == "":
		return s
	default:
		return s + "\n" + e
	}
}

// RunProc executes command (argv, never via a shell) in workDir with a timeout, capturing
// stdout and stderr separately and merging extraEnv onto the inherited environment.
func RunProc(command []string, workDir string, timeout time.Duration, extraEnv map[string]string) ProcResult {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Dir = workDir
	if len(extraEnv) > 0 {
		env := cmd.Environ()
		for k, v := range extraEnv {
			env = append(env, k+"="+v)
		}
		cmd.Env = env
	}

	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	err := cmd.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return ProcResult{Exit: -1, Stdout: out.String(),
			Stderr: fmt.Sprintf("process timed out after %ds", int(timeout.Seconds()))}
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return ProcResult{Exit: exitErr.ExitCode(), Stdout: out.String(), Stderr: errBuf.String()}
		}
		return ProcResult{Exit: -1, Stdout: out.String(),
			Stderr: "failed to start process: " + err.Error()}
	}
	return ProcResult{Exit: 0, Stdout: out.String(), Stderr: errBuf.String()}
}
