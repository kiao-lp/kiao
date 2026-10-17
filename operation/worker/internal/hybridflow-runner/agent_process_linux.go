package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const agentSupervisorCommand = "--kiao-agent-process-supervisor-v1"

// supervisedAgentProcess owns a turn's local descendants, including tools that
// start a new session/process group. Its supervisor is a separate Linux subreaper,
// so orphaned grandchildren are adopted here rather than by PID 1. Closing the
// lifeline cancels it; a worker crash closes the same pipe in the kernel.
type supervisedAgentProcess struct {
	cmd      *exec.Cmd
	pid      int // the real CLI launcher, retained in the turn trace
	lifeline *os.File
	status   *json.Decoder
	statusR  *os.File
	done     chan struct{}
	exitCode int
	err      error
	stopOnce sync.Once
}

type agentProcessStatus struct {
	PID      int    `json:"pid,omitempty"`
	Error    string `json:"error,omitempty"`
	ExitCode int    `json:"exitCode"`
}

// startSupervisedAgent starts the supplied command's specification. The caller
// owns its stdin/stdout/stderr files; no exec.Cmd pipe copier can delay reaping.
func startSupervisedAgent(target *exec.Cmd) (*supervisedAgentProcess, error) {
	if target.Err != nil {
		return nil, target.Err
	}
	lifeR, lifeW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer lifeR.Close()
	statusR, statusW, err := os.Pipe()
	if err != nil {
		lifeW.Close()
		return nil, err
	}
	defer statusW.Close()
	// /proc/self/exe keeps using this worker even if its on-disk binary was replaced.
	args := append([]string{agentSupervisorCommand, target.Path}, target.Args[1:]...)
	cmd := exec.Command("/proc/self/exe", args...)
	cmd.Dir, cmd.Env = target.Dir, target.Env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = target.Stdin, target.Stdout, target.Stderr
	cmd.ExtraFiles = []*os.File{lifeR, statusW} // supervisor-only fds 3 and 4
	// A launcher stopping the worker's process group must leave this reaper alive
	// long enough to observe the closed lifeline and clean up the agent.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		lifeW.Close()
		statusR.Close()
		return nil, err
	}
	lifeR.Close()
	statusW.Close()
	process := &supervisedAgentProcess{cmd: cmd, lifeline: lifeW,
		status: json.NewDecoder(statusR), statusR: statusR, done: make(chan struct{})}
	var started agentProcessStatus
	// Only bound the local startup handshake, never the duration of an agent turn.
	_ = statusR.SetReadDeadline(time.Now().Add(10 * time.Second))
	err = process.status.Decode(&started)
	_ = statusR.SetReadDeadline(time.Time{})
	if err != nil || started.Error != "" || started.PID <= 0 {
		process.stop()
		// Even a failed startup acknowledgement may follow a successful launch.
		// Let the supervisor clean up through its lifeline; killing it could orphan
		// descendants before the caller releases this failed turn's reservation.
		_ = cmd.Wait()
		statusR.Close()
		if started.Error != "" {
			return nil, errors.New(started.Error)
		}
		if err == nil {
			err = errors.New("missing launcher PID")
		}
		return nil, fmt.Errorf("agent supervisor startup: %w", err)
	}
	process.pid = started.PID
	go process.wait()
	return process, nil
}

func (p *supervisedAgentProcess) stop() {
	p.stopOnce.Do(func() { _ = p.lifeline.Close() })
}

func (p *supervisedAgentProcess) wait() {
	defer close(p.done)
	defer p.statusR.Close()
	defer p.stop()
	err := p.cmd.Wait()
	var ended agentProcessStatus
	if decodeErr := p.status.Decode(&ended); err != nil || decodeErr != nil {
		p.exitCode = -1
		p.err = fmt.Errorf("agent supervisor ended without cleanup confirmation: %w", errors.Join(err, decodeErr))
		return
	}
	p.exitCode = ended.ExitCode
	if ended.Error != "" {
		p.err = errors.New(ended.Error)
	}
}

// RunAgentProcessSupervisor handles the worker's private subprocess mode. Call
// before reading server configuration (also from TestMain for self-exec tests).
func RunAgentProcessSupervisor() bool {
	if len(os.Args) < 2 || os.Args[1] != agentSupervisorCommand {
		return false
	}
	os.Exit(runAgentProcessSupervisor(os.Args[2:]))
	return true
}

func runAgentProcessSupervisor(args []string) int {
	lifeline := os.NewFile(3, "agent-lifeline")
	status := os.NewFile(4, "agent-status")
	defer lifeline.Close()
	defer status.Close()
	// The agent and its tools must never inherit either end of this control wire.
	syscall.CloseOnExec(3)
	syscall.CloseOnExec(4)
	report := json.NewEncoder(status)
	fail := func(err error) int {
		_ = report.Encode(agentProcessStatus{Error: err.Error(), ExitCode: -1})
		return 1
	}
	if len(args) == 0 {
		return fail(errors.New("missing agent command"))
	}
	// PR_SET_CHILD_SUBREAPER (linux/prctl.h). No privilege or systemd is needed.
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, 36, 1, 0, 0, 0, 0); errno != 0 {
		return fail(fmt.Errorf("cannot supervise agent descendants: %w", errno))
	}
	if _, err := supervisorChildren(); err != nil {
		return fail(err)
	}
	ownerGone := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, lifeline)
		close(ownerGone)
	}()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fail(err)
	}
	// Only the launcher reads the prompt. Keeping our copy open would mask its
	// closed stdin and leave the worker blocked on a large prompt forever.
	_ = os.Stdin.Close()
	_ = report.Encode(agentProcessStatus{PID: cmd.Process.Pid})
	rootDone := make(chan error, 1)
	go func() { rootDone <- cmd.Wait() }()
	var rootErr error
	select {
	case rootErr = <-rootDone:
	case <-ownerGone:
		_ = cmd.Process.Kill()
		rootErr = <-rootDone
	}
	// Launcher exit and cancellation have the same cleanup, independently of any
	// protocol output or pipe held open by a descendant.
	cleanupErr := reapAgentDescendants()
	exitCode := 0
	if rootErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(rootErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	ended := agentProcessStatus{ExitCode: exitCode}
	if cleanupErr != nil {
		ended.Error, ended.ExitCode = cleanupErr.Error(), -1
	}
	_ = report.Encode(ended)
	return 0
}

// Only enumerate this supervisor's children. As each is killed, its surviving
// descendants are adopted here, including setsid/double-fork children. Reap until
// ECHILD, rather than considering the launcher's death proof that its tools ended.
func reapAgentDescendants() error {
	var cleanupErr error
	for {
		pid, err := syscall.Wait4(-1, nil, syscall.WNOHANG, nil)
		if errors.Is(err, syscall.ECHILD) {
			return cleanupErr
		}
		if errors.Is(err, syscall.EINTR) || pid > 0 {
			continue
		}
		var children []int
		if err == nil {
			children, err = supervisorChildren()
		}
		if err != nil {
			// A transient /proc read failure must never release a live agent.
			if cleanupErr == nil {
				fmt.Fprintf(os.Stderr, "agent descendant cleanup: %v\n", err)
			}
			cleanupErr = err
		} else {
			for _, child := range children {
				_ = syscall.Kill(child, syscall.SIGKILL)
			}
		}
		time.Sleep(time.Millisecond)
	}
}

func supervisorChildren() ([]int, error) {
	tasks, err := os.ReadDir("/proc/self/task")
	if err != nil {
		return nil, err
	}
	var children []int
	for _, task := range tasks {
		raw, err := os.ReadFile(filepath.Join("/proc/self/task", task.Name(), "children"))
		if os.IsNotExist(err) || errors.Is(err, syscall.ESRCH) { // a Go runtime thread can disappear
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, field := range strings.Fields(string(raw)) {
			pid, err := strconv.Atoi(field)
			if err != nil {
				return nil, err
			}
			children = append(children, pid)
		}
	}
	return children, nil
}
