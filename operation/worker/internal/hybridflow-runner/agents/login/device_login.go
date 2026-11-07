package login

import (
	"bytes"
	"context"
	"fmt"
	pkgProcess "kiao/worker/internal/core/process"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"os"
	"os/exec"
	"sync"
	"time"
)

// deviceLoginService owns the parked CLI process shared by Muse and Codex sign-in.
// Each CLI supplies its command, page parser and result-message cleaner.
type DeviceLoginService struct {
	LoginCmd     func(context.Context) *exec.Cmd
	FindPage     func(string) (DeviceLoginPage, bool)
	CleanMessage func(string) string
	// Serializes process publication with replacement and cancellation.
	startMu sync.Mutex
	Mu      sync.Mutex
	Session *DeviceLoginSession
}

// deviceLoginSession is one parked sign-in process: the output drained from it, and the
// channels the handlers wait on. stdin needs no holding — the CLI waits on its own server poll,
// not on its input — so there is no pipe to keep open across the requests.
type DeviceLoginSession struct {
	process *pkgProcess.SupervisedAgentProcess
	cancel  context.CancelFunc

	pageFound chan DeviceLoginPage // buffered(1): the page and code, as soon as both are seen
	Done      chan struct{}        // closed once the process has exited and its output is drained

	mu           sync.Mutex
	output       bytes.Buffer
	exitCode     int
	findPage     func(string) (DeviceLoginPage, bool)
	cleanMessage func(string) string
}

// deviceLoginPage is what the user acts on: the page to open, and the code to confirm matches.
type DeviceLoginPage struct {
	Url      string
	UserCode string
}

// startDevice spawns the CLI and returns the page to open and the code to confirm.
func (svc *DeviceLoginService) StartDevice() (string, string, error) {
	session, err := svc.spawnDevice()
	if err != nil {
		return "", "", err
	}
	select {
	case page := <-session.pageFound:
		return page.Url, page.UserCode, nil
	case <-session.Done:
		// A fast approval can exit in the same tick the page was read.
		select {
		case page := <-session.pageFound:
			return page.Url, page.UserCode, nil
		default:
		}
		svc.discardDevice(session)
		return "", "", fmt.Errorf("the CLI exited before printing a sign-in page: %s", session.message())
	case <-time.After(deviceURLTimeout):
		svc.discardDevice(session)
		return "", "", fmt.Errorf("the CLI printed no sign-in page within %s", deviceURLTimeout)
	}
}

// deviceStatus reports the wait: pending while the CLI is still parked, and once it has exited
// whether the approval landed. Reading a finished wait consumes it, so a second Start never
// inherits the first one's answer. A non-zero exit is a refused or expired approval, not a service
// failure, so it comes back as done-and-failed rather than an error.
func (svc *DeviceLoginService) DeviceStatus() (pending, ok bool, message string, err error) {
	svc.Mu.Lock()
	session := svc.Session
	svc.Mu.Unlock()
	if session == nil {
		return false, false, "", ErrNoLoginInFlight
	}
	select {
	case <-session.Done:
		defer svc.discardDevice(session)
		if exit := session.exit(); exit == 0 {
			return false, true, protocol.OrDefault(session.message(), "Signed in."), nil
		} else {
			return false, false, protocol.OrDefault(session.message(),
				fmt.Sprintf("sign-in failed (exit %d)", exit)), nil
		}
	default:
		return true, false, "", nil
	}
}

// cancelDevice kills a device flow in progress, reporting whether there was one.
func (svc *DeviceLoginService) CancelDevice() bool {
	svc.startMu.Lock()
	defer svc.startMu.Unlock()
	return svc.cancelDeviceCurrent()
}

// shutdownDevice kills a parked device flow, so none survives the service (systemd SIGTERM).
func (svc *DeviceLoginService) ShutdownDevice() {
	if svc.CancelDevice() {
		agentapi.LogAgentLogin.Info("device sign-in cancelled by shutdown")
	}
}

func (svc *DeviceLoginService) spawnDevice() (*DeviceLoginSession, error) {
	svc.startMu.Lock()
	defer svc.startMu.Unlock()
	// An earlier unfinished flow is replaced rather than queued behind: its code is dead once the
	// user starts over.
	if svc.cancelDeviceCurrent() {
		agentapi.LogAgentLogin.Info("replacing an unfinished device sign-in")
	}

	ctx, cancel := context.WithTimeout(context.Background(), deviceSessionTTL)
	cmd := svc.LoginCmd(ctx)

	pr, pw, err := os.Pipe()
	if err != nil {
		cancel()
		return nil, err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	process, err := pkgProcess.StartSupervisedAgent(cmd)
	if err != nil {
		cancel()
		pw.Close()
		pr.Close()
		return nil, fmt.Errorf("could not start device sign-in: %w", err)
	}
	pw.Close() // the parent drops its write end; the child keeps its dup

	session := &DeviceLoginSession{
		process:      process,
		cancel:       cancel,
		pageFound:    make(chan DeviceLoginPage, 1),
		findPage:     svc.FindPage,
		cleanMessage: svc.CleanMessage,
		Done:         make(chan struct{}),
	}
	go session.readOutput(pr)
	go func() {
		select {
		case <-ctx.Done():
			process.Stop()
		case <-session.Done:
			cancel()
		}
	}()

	svc.Mu.Lock()
	svc.Session = session
	svc.Mu.Unlock()
	agentapi.LogAgentLogin.Info("device sign-in started", "pid", process.Pid)
	return session, nil
}

// discardDevice releases a session's context — killing the process if it is still running — and
// clears it from the registry, but only while it is still the current one, so a slow handler
// cannot evict the session a later request has since started.
func (svc *DeviceLoginService) discardDevice(session *DeviceLoginSession) {
	session.cancel()
	svc.Mu.Lock()
	if svc.Session == session {
		svc.Session = nil
	}
	svc.Mu.Unlock()
}

// cancelDeviceCurrent kills whatever device flow is in flight, reporting whether there was one.
func (svc *DeviceLoginService) cancelDeviceCurrent() bool {
	svc.Mu.Lock()
	session := svc.Session
	svc.Session = nil
	svc.Mu.Unlock()
	if session == nil {
		return false
	}
	session.cancel()
	return true
}

// readOutput drains the CLI's merged stdout/stderr until the process exits, publishing the page
// and code as soon as both appear on complete lines. Draining matters after that too: a full pipe
// would block the child mid-flow.
func (s *DeviceLoginSession) readOutput(pr *os.File) {
	defer pr.Close()
	buf := make([]byte, 4096)
	published := false
	for {
		n, err := pr.Read(buf)
		if n > 0 {
			s.mu.Lock()
			s.output.Write(buf[:n])
			text := s.output.String()
			s.mu.Unlock()
			if !published {
				if page, ok := s.findPage(text); ok {
					published = true
					s.pageFound <- page
				}
			}
		}
		if err != nil {
			break
		}
	}

	<-s.process.Done
	s.mu.Lock()
	s.exitCode = s.process.ExitCode
	if s.process.Err != nil {
		s.exitCode = -1
	}
	s.mu.Unlock()
	close(s.Done)
}

func (s *DeviceLoginSession) exit() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

// message returns what the CLI wrote after the wait began, cleaned up for display: the wait's
// answer, without the page-and-code banner that preceded it.
func (s *DeviceLoginSession) message() string {
	s.mu.Lock()
	raw := s.output.String()
	s.mu.Unlock()
	return s.cleanMessage(raw)
}
