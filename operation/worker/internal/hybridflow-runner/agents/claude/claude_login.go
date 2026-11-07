package claude

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/login"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ClaudeLoginService drives `claude auth login` on this host on behalf of a browser client, so the
// server-side CLI can be signed in from Dashboard instead of from a shell on the machine.
//
// The CLI's OAuth flow needs no TTY: it prints an authorize URL on stdout and then blocks reading
// the pasted code from stdin, and its redirect URI merely *displays* that code for the user to copy
// rather than calling back. That reduces the whole flow to two round trips — start (spawn, return
// the URL) and code (write it to the held stdin, report the outcome) — with one parked process in
// between. At most one login is in flight; starting another replaces it, because the authorize code
// of an abandoned attempt is useless anyway.
//
// The feature is gated by KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED (default on). Completing this
// flow binds the host's CLI to whichever account authorises it. Setting the flag to false removes
// the login endpoints while leaving authentication status readable.
type ClaudeLoginService struct {
	Enabled bool

	// loginCmd builds the sign-in command and authStatus runs the status one. They are fields so a
	// test can stand in for a CLI it cannot drive: a real sign-in needs a browser and a human.
	LoginCmd   func(ctx context.Context) *exec.Cmd
	AuthStatus func(ctx context.Context) ([]byte, error)
	// credentials reads the OAuth session the CLI stores, which is what `claude auth status` is
	// checked against — see status. Nil disables the cross-check rather than failing it.
	Credentials func() (ClaudeCredentials, error)

	Mu      sync.Mutex
	Session *ClaudeLoginSession
}

// claudeLoginSession is one parked `claude auth login` process: its stdin (kept open across the two
// requests, which is the whole reason a session exists), the output drained from it, and the
// channels the handlers wait on.
type ClaudeLoginSession struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	cancel context.CancelFunc

	urlFound chan string   // buffered(1): the authorize URL, as soon as it is seen
	Done     chan struct{} // closed once the process has exited and its output is drained

	mu       sync.Mutex
	output   bytes.Buffer
	exitCode int
}

// loginURLTimeout bounds how long the CLI may take to print the authorize URL.
const loginURLTimeout = 30 * time.Second

// loginCodeTimeout bounds the token exchange once the code has been submitted.
const loginCodeTimeout = 60 * time.Second

// loginSessionTTL kills a login nobody finished. Anthropic expires the authorize code on its
// own side regardless; this is what stops an abandoned process from parking on stdin forever.
const loginSessionTTL = 10 * time.Minute

// authStatusTimeout bounds `claude auth status`.
const authStatusTimeout = 20 * time.Second

// maxLoginCodeLength rejects an implausibly long paste before it reaches the CLI.
const MaxLoginCodeLength = 512

// pastePromptMarker is the CLI's stdin prompt. It carries no newline, so whether it lands
// before or after the mark taken at submit time is a matter of flush timing, not meaning.
const pastePromptMarker = "Paste code here"

// authorizeURLRe matches the URL the CLI prints ("If the browser didn't open, visit: https://…").
// It is only ever applied to complete lines, so a read that splits the URL cannot yield a truncated
// match.
var authorizeURLRe = regexp.MustCompile(`https://\S*oauth/authorize\?\S+`)

func newClaudeLoginService(cfg *runnerconfig.Config) *ClaudeLoginService {
	return &ClaudeLoginService{
		Enabled:     cfg.ClaudeLoginEnabled,
		LoginCmd:    claudeLoginCommand,
		AuthStatus:  claudeAuthStatus,
		Credentials: func() (ClaudeCredentials, error) { return readClaudeCredentials(cfg.ClaudeCredentialsPath) },
	}
}

// claudeLoginCommand builds the sign-in command. The host is headless, so the CLI's "open a
// browser" attempt is neutralised: it must not block on a helper with no display to draw on. The
// URL is printed either way, and it is what the flow returns.
func claudeLoginCommand(ctx context.Context) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "claude", "auth", "login", "--claudeai")
	cmd.Env = append(os.Environ(), "BROWSER=/bin/true", "DISPLAY=")
	return cmd
}

// claudeAuthStatus runs `claude auth status --json` and returns its stdout.
func claudeAuthStatus(ctx context.Context) ([]byte, error) {
	return exec.CommandContext(ctx, "claude", "auth", "status", "--json").Output()
}

// start spawns the CLI and returns the authorize URL for the user to open.
func (svc *ClaudeLoginService) Start() (string, error) {
	session, err := svc.spawn()
	if err != nil {
		return "", err
	}
	select {
	case url := <-session.urlFound:
		return url, nil
	case <-session.Done:
		svc.discard(session)
		return "", fmt.Errorf("the CLI exited before printing a sign-in URL: %s", session.messageSince(0))
	case <-time.After(loginURLTimeout):
		svc.discard(session)
		return "", fmt.Errorf("the CLI printed no sign-in URL within %s", loginURLTimeout)
	}
}

// submitCode hands the pasted code to the parked CLI and reports how the exchange went. A non-zero
// exit is a refused code, not a service failure, so it comes back as ok=false rather than an error.
func (svc *ClaudeLoginService) SubmitCode(code string) (bool, string, error) {
	svc.Mu.Lock()
	session := svc.Session
	svc.Mu.Unlock()
	if session == nil {
		return false, "", login.ErrNoLoginInFlight
	}
	defer svc.discard(session)

	// Mark the output first: what the CLI writes after this point is its answer to the code, which
	// is the only part worth relaying — everything before it is the URL banner and the prompt.
	mark := session.outputLen()
	if _, err := io.WriteString(session.stdin, code+"\n"); err != nil {
		return false, "", fmt.Errorf("could not hand the code to the CLI: %w", err)
	}
	_ = session.stdin.Close()

	select {
	case <-session.Done:
	case <-time.After(loginCodeTimeout):
		return false, "", fmt.Errorf("the CLI did not finish the exchange within %s", loginCodeTimeout)
	}

	exitCode, message := session.exit(), session.messageSince(mark)
	if exitCode == 0 {
		return true, protocol.OrDefault(message, "Signed in."), nil
	}
	return false, protocol.OrDefault(message, fmt.Sprintf("sign-in failed (exit %d)", exitCode)), nil
}

// cancel kills a login in progress, reporting whether there was one.
func (svc *ClaudeLoginService) cancel() bool {
	return svc.cancelCurrent()
}

// status answers whether a turn started now could authenticate — which is a stronger question than
// the one `claude auth status` answers, and the difference is why this is not a passthrough.
//
// **`claude auth status` reports on the credentials file, not on the session.** It says
// `loggedIn: true` for as long as a credential blob is there, whatever state the tokens in it are
// in. Once the refresh token lapses — overnight, with nothing running to notice — every turn comes
// back `Please run /login` while the status endpoint keeps saying the host is signed in, so the
// panel's sign-in banner never appears and reloading the page does not bring it: the reload asks
// the same question and is told the same thing. So the CLI's answer is cross-checked against the
// file it answered from, and a session nothing unattended can renew is reported as signed out.
//
// The check only ever takes `loggedIn` away. A host the CLI calls signed out is signed out, and
// credentials that cannot be read at all leave its answer standing — a sign-out invented from a
// missing file would be the same bug pointing the other way.
func (svc *ClaudeLoginService) Status() (agentapi.AgentAuthStatusDto, error) {
	ctx, cancel := context.WithTimeout(context.Background(), authStatusTimeout)
	defer cancel()

	out, err := svc.AuthStatus(ctx)

	// A logged-out CLI exits 1 while still printing a well-formed status, so the exit code is not
	// the signal here — a parsable payload is. The exit error only matters when nothing parses.
	var dto agentapi.AgentAuthStatusDto
	if jsonErr := json.Unmarshal(bytes.TrimSpace(out), &dto); jsonErr != nil {
		if err != nil {
			return dto, fmt.Errorf("`claude auth status` failed: %w", err)
		}
		return dto, fmt.Errorf("`claude auth status` returned unparsable output: %w", jsonErr)
	}
	dto.LoginEnabled = svc.Enabled
	if dto.LoggedIn && svc.Credentials != nil {
		if creds, credErr := svc.Credentials(); credErr == nil && !creds.renewable(time.Now()) {
			agentapi.LogLogin.Info("CLI reports a session it can no longer renew; reporting signed out",
				"component", "claude-login", "refreshTokenExpiresAt", creds.RefreshTokenExpiresAt)
			dto.LoggedIn = false
		}
	}
	return dto, nil
}

// shutdown kills a parked login process, so none survives the service (systemd SIGTERM).
func (svc *ClaudeLoginService) Shutdown() {
	if svc.cancelCurrent() {
		agentapi.LogLogin.Info("sign-in cancelled by shutdown")
	}
}

func (svc *ClaudeLoginService) spawn() (*ClaudeLoginSession, error) {
	// An earlier unfinished login is replaced rather than queued behind: its code can no longer be
	// used once the user starts over.
	if svc.cancelCurrent() {
		agentapi.LogLogin.Info("replacing an unfinished sign-in")
	}

	ctx, cancel := context.WithTimeout(context.Background(), loginSessionTTL)
	cmd := svc.LoginCmd(ctx)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	pr, pw, err := os.Pipe()
	if err != nil {
		cancel()
		_ = stdin.Close()
		return nil, err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		cancel()
		pw.Close()
		pr.Close()
		_ = stdin.Close()
		return nil, fmt.Errorf("could not start `claude auth login`: %w", err)
	}
	pw.Close() // the parent drops its write end; the child keeps its dup

	session := &ClaudeLoginSession{
		cmd:      cmd,
		stdin:    stdin,
		cancel:   cancel,
		urlFound: make(chan string, 1),
		Done:     make(chan struct{}),
	}
	go session.readOutput(pr)

	svc.Mu.Lock()
	svc.Session = session
	svc.Mu.Unlock()
	agentapi.LogLogin.Info("sign-in started", "pid", cmd.Process.Pid)
	return session, nil
}

// discard releases a session's context — killing the process if it is still running — and clears it
// from the registry, but only while it is still the current one, so a slow handler cannot evict the
// session a later request has since started.
func (svc *ClaudeLoginService) discard(session *ClaudeLoginSession) {
	session.cancel()
	svc.Mu.Lock()
	if svc.Session == session {
		svc.Session = nil
	}
	svc.Mu.Unlock()
}

// cancelCurrent kills whatever login is in flight, reporting whether there was one.
func (svc *ClaudeLoginService) cancelCurrent() bool {
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

// readOutput drains the CLI's merged stdout/stderr until the process exits, publishing the
// authorize URL as soon as one appears on a complete line. Draining matters after that too: a full
// pipe would block the child mid-flow.
func (s *ClaudeLoginSession) readOutput(pr *os.File) {
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
				if url := FindAuthorizeURL(text); url != "" {
					published = true
					s.urlFound <- url
				}
			}
		}
		if err != nil {
			break
		}
	}

	exitCode := 0
	if err := s.cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	s.mu.Lock()
	s.exitCode = exitCode
	s.mu.Unlock()
	close(s.Done)
}

func (s *ClaudeLoginSession) outputLen() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.output.Len()
}

func (s *ClaudeLoginSession) exit() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

// messageSince returns the output written from `mark` onwards, cleaned up for display.
func (s *ClaudeLoginSession) messageSince(mark int) string {
	s.mu.Lock()
	raw := s.output.String()
	s.mu.Unlock()
	if mark > len(raw) {
		mark = len(raw)
	}
	return CleanLoginMessage(raw[mark:])
}

// findAuthorizeURL returns the authorize URL if the text holds one on a completed line. Restricting
// the search to what precedes the last newline is what guarantees a match is whole: the CLI prints
// the URL followed by a newline, so a partial read cannot produce a truncated one.
func FindAuthorizeURL(text string) string {
	end := strings.LastIndexByte(text, '\n')
	if end < 0 {
		return ""
	}
	return authorizeURLRe.FindString(text[:end])
}

// cleanLoginMessage turns captured CLI output into something worth showing: the stdin prompt is
// dropped, and the result is trimmed and capped.
func CleanLoginMessage(s string) string {
	if i := strings.Index(s, pastePromptMarker); i >= 0 {
		if j := strings.IndexByte(s[i:], '>'); j >= 0 {
			s = s[i+j+1:]
		} else {
			s = s[:i]
		}
	}
	s = strings.TrimSpace(s)
	if len(s) > login.MaxLoginMessage {
		s = s[:login.MaxLoginMessage] + "…"
	}
	return s
}
