package hybridflowrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"net/http"
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
// The feature is gated by KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED (default off). Completing this
// flow binds the host's CLI to whichever account authorises it, so the endpoints stay absent from
// deployments that do not want that reachable over HTTP.
type ClaudeLoginService struct {
	enabled bool

	// loginCmd builds the sign-in command and authStatus runs the status one. They are fields so a
	// test can stand in for a CLI it cannot drive: a real sign-in needs a browser and a human.
	loginCmd   func(ctx context.Context) *exec.Cmd
	authStatus func(ctx context.Context) ([]byte, error)
	// credentials reads the OAuth session the CLI stores, which is what `claude auth status` is
	// checked against — see status. Nil disables the cross-check rather than failing it.
	credentials func() (claudeCredentials, error)

	mu      sync.Mutex
	session *claudeLoginSession
}

// claudeLoginSession is one parked `claude auth login` process: its stdin (kept open across the two
// requests, which is the whole reason a session exists), the output drained from it, and the
// channels the handlers wait on.
type claudeLoginSession struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	cancel context.CancelFunc

	urlFound chan string   // buffered(1): the authorize URL, as soon as it is seen
	done     chan struct{} // closed once the process has exited and its output is drained

	mu       sync.Mutex
	output   bytes.Buffer
	exitCode int
}

const (
	// loginURLTimeout bounds how long the CLI may take to print the authorize URL.
	loginURLTimeout = 30 * time.Second
	// loginCodeTimeout bounds the token exchange once the code has been submitted.
	loginCodeTimeout = 60 * time.Second
	// loginSessionTTL kills a login nobody finished. Anthropic expires the authorize code on its
	// own side regardless; this is what stops an abandoned process from parking on stdin forever.
	loginSessionTTL = 10 * time.Minute
	// authStatusTimeout bounds `claude auth status`.
	authStatusTimeout = 20 * time.Second
	// maxLoginCodeLength rejects an implausibly long paste before it reaches the CLI.
	maxLoginCodeLength = 512
	// maxLoginMessage caps the CLI output relayed to the client as a step's message.
	maxLoginMessage = 2000
	// pastePromptMarker is the CLI's stdin prompt. It carries no newline, so whether it lands
	// before or after the mark taken at submit time is a matter of flush timing, not meaning.
	pastePromptMarker = "Paste code here"
)

// errNoLoginInFlight reports a code (or cancel) arriving with no started login to feed it to —
// typically a stale browser tab, or a service restart between the two steps.
var errNoLoginInFlight = errors.New("no sign-in is in progress; start one first")

// authorizeURLRe matches the URL the CLI prints ("If the browser didn't open, visit: https://…").
// It is only ever applied to complete lines, so a read that splits the URL cannot yield a truncated
// match.
var authorizeURLRe = regexp.MustCompile(`https://\S*oauth/authorize\?\S+`)

func newClaudeLoginService(cfg *Config) *ClaudeLoginService {
	return &ClaudeLoginService{
		enabled:     cfg.ClaudeLoginEnabled,
		loginCmd:    claudeLoginCommand,
		authStatus:  claudeAuthStatus,
		credentials: func() (claudeCredentials, error) { return readClaudeCredentials(cfg.ClaudeCredentialsPath) },
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

// ── the two steps ─────────────────────────────────────────────────────────────

// start spawns the CLI and returns the authorize URL for the user to open.
func (svc *ClaudeLoginService) start() (string, error) {
	session, err := svc.spawn()
	if err != nil {
		return "", err
	}
	select {
	case url := <-session.urlFound:
		return url, nil
	case <-session.done:
		svc.discard(session)
		return "", fmt.Errorf("the CLI exited before printing a sign-in URL: %s", session.messageSince(0))
	case <-time.After(loginURLTimeout):
		svc.discard(session)
		return "", fmt.Errorf("the CLI printed no sign-in URL within %s", loginURLTimeout)
	}
}

// submitCode hands the pasted code to the parked CLI and reports how the exchange went. A non-zero
// exit is a refused code, not a service failure, so it comes back as ok=false rather than an error.
func (svc *ClaudeLoginService) submitCode(code string) (bool, string, error) {
	svc.mu.Lock()
	session := svc.session
	svc.mu.Unlock()
	if session == nil {
		return false, "", errNoLoginInFlight
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
	case <-session.done:
	case <-time.After(loginCodeTimeout):
		return false, "", fmt.Errorf("the CLI did not finish the exchange within %s", loginCodeTimeout)
	}

	exitCode, message := session.exit(), session.messageSince(mark)
	if exitCode == 0 {
		return true, orDefault(message, "Signed in."), nil
	}
	return false, orDefault(message, fmt.Sprintf("sign-in failed (exit %d)", exitCode)), nil
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
func (svc *ClaudeLoginService) status() (AgentAuthStatusDto, error) {
	ctx, cancel := context.WithTimeout(context.Background(), authStatusTimeout)
	defer cancel()

	out, err := svc.authStatus(ctx)

	// A logged-out CLI exits 1 while still printing a well-formed status, so the exit code is not
	// the signal here — a parsable payload is. The exit error only matters when nothing parses.
	var dto AgentAuthStatusDto
	if jsonErr := json.Unmarshal(bytes.TrimSpace(out), &dto); jsonErr != nil {
		if err != nil {
			return dto, fmt.Errorf("`claude auth status` failed: %w", err)
		}
		return dto, fmt.Errorf("`claude auth status` returned unparsable output: %w", jsonErr)
	}
	dto.LoginEnabled = svc.enabled
	if dto.LoggedIn && svc.credentials != nil {
		if creds, credErr := svc.credentials(); credErr == nil && !creds.renewable(time.Now()) {
			logLogin.Info("CLI reports a session it can no longer renew; reporting signed out",
				"component", "claude-login", "refreshTokenExpiresAt", creds.RefreshTokenExpiresAt)
			dto.LoggedIn = false
		}
	}
	return dto, nil
}

// shutdown kills a parked login process, so none survives the service (systemd SIGTERM).
func (svc *ClaudeLoginService) shutdown() {
	if svc.cancelCurrent() {
		logLogin.Info("sign-in cancelled by shutdown")
	}
}

// ── process plumbing ──────────────────────────────────────────────────────────

func (svc *ClaudeLoginService) spawn() (*claudeLoginSession, error) {
	// An earlier unfinished login is replaced rather than queued behind: its code can no longer be
	// used once the user starts over.
	if svc.cancelCurrent() {
		logLogin.Info("replacing an unfinished sign-in")
	}

	ctx, cancel := context.WithTimeout(context.Background(), loginSessionTTL)
	cmd := svc.loginCmd(ctx)

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

	session := &claudeLoginSession{
		cmd:      cmd,
		stdin:    stdin,
		cancel:   cancel,
		urlFound: make(chan string, 1),
		done:     make(chan struct{}),
	}
	go session.readOutput(pr)

	svc.mu.Lock()
	svc.session = session
	svc.mu.Unlock()
	logLogin.Info("sign-in started", "pid", cmd.Process.Pid)
	return session, nil
}

// discard releases a session's context — killing the process if it is still running — and clears it
// from the registry, but only while it is still the current one, so a slow handler cannot evict the
// session a later request has since started.
func (svc *ClaudeLoginService) discard(session *claudeLoginSession) {
	session.cancel()
	svc.mu.Lock()
	if svc.session == session {
		svc.session = nil
	}
	svc.mu.Unlock()
}

// cancelCurrent kills whatever login is in flight, reporting whether there was one.
func (svc *ClaudeLoginService) cancelCurrent() bool {
	svc.mu.Lock()
	session := svc.session
	svc.session = nil
	svc.mu.Unlock()
	if session == nil {
		return false
	}
	session.cancel()
	return true
}

// readOutput drains the CLI's merged stdout/stderr until the process exits, publishing the
// authorize URL as soon as one appears on a complete line. Draining matters after that too: a full
// pipe would block the child mid-flow.
func (s *claudeLoginSession) readOutput(pr *os.File) {
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
				if url := findAuthorizeURL(text); url != "" {
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
	close(s.done)
}

func (s *claudeLoginSession) outputLen() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.output.Len()
}

func (s *claudeLoginSession) exit() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

// messageSince returns the output written from `mark` onwards, cleaned up for display.
func (s *claudeLoginSession) messageSince(mark int) string {
	s.mu.Lock()
	raw := s.output.String()
	s.mu.Unlock()
	if mark > len(raw) {
		mark = len(raw)
	}
	return cleanLoginMessage(raw[mark:])
}

// findAuthorizeURL returns the authorize URL if the text holds one on a completed line. Restricting
// the search to what precedes the last newline is what guarantees a match is whole: the CLI prints
// the URL followed by a newline, so a partial read cannot produce a truncated one.
func findAuthorizeURL(text string) string {
	end := strings.LastIndexByte(text, '\n')
	if end < 0 {
		return ""
	}
	return authorizeURLRe.FindString(text[:end])
}

// cleanLoginMessage turns captured CLI output into something worth showing: the stdin prompt is
// dropped, and the result is trimmed and capped.
func cleanLoginMessage(s string) string {
	if i := strings.Index(s, pastePromptMarker); i >= 0 {
		if j := strings.IndexByte(s[i:], '>'); j >= 0 {
			s = s[i+j+1:]
		} else {
			s = s[:i]
		}
	}
	s = strings.TrimSpace(s)
	if len(s) > maxLoginMessage {
		s = s[:maxLoginMessage] + "…"
	}
	return s
}

// ── handlers ──────────────────────────────────────────────────────────────────

// HandleAuthStatus serves GET /hybridflow-runner/auth/status while Claude is enabled.
// Disabling browser sign-in alone still allows status checks.
func (s *Service) HandleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if s.login == nil || !s.agents.isEnabled(agentClaude) {
		http.NotFound(w, r)
		return
	}
	status, err := s.login.AuthStatus()
	if err != nil {
		core.LogCtx(r).Warn("auth status unavailable", "component", "claude-login", "error", err)
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusServiceUnavailable, Msg: "cannot read Claude auth status"})
		return
	}
	core.WriteJSON(w, http.StatusOK, status)
}

// HandleLoginStart serves POST /hybridflow-runner/auth/login/start.
func (s *Service) HandleLoginStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	url, err := s.login.LoginStart()
	if err != nil {
		core.LogCtx(r).Warn("sign-in start failed", "component", "claude-login", "error", err)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	core.LogCtx(r).Info("sign-in URL issued", "component", "claude-login", "user", core.IdentityFromRequest(r).User)
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, URL: url})
}

// HandleLoginCode serves POST /hybridflow-runner/auth/login/code.
//
// The code is a one-time credential: it is never logged, and it is checked for a newline before
// reaching the CLI, since stdin is line-oriented and extra lines would be extra answers to whatever
// the CLI asks next.
func (s *Service) HandleLoginCode(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" || len(code) > maxLoginCodeLength || strings.ContainsAny(code, "\r\n") {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid code"})
		return
	}

	ok, message, err := s.login.LoginCode(code)
	if err != nil {
		if errors.Is(err, errNoLoginInFlight) {
			core.WriteError(w, r, &core.HTTPError{Status: http.StatusConflict, Msg: err.Error()})
			return
		}
		core.LogCtx(r).Warn("sign-in exchange failed", "component", "claude-login", "error", err)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	logLogin.Info("sign-in finished", "ok", ok, "user", core.IdentityFromRequest(r).User)
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: ok, Message: message})
}

// HandleLoginCancel serves POST /hybridflow-runner/auth/login/cancel.
func (s *Service) HandleLoginCancel(w http.ResponseWriter, r *http.Request) {
	if !s.requireLoginEnabled(w, r) {
		return
	}
	if s.login.LoginCancel() {
		core.LogCtx(r).Info("sign-in cancelled", "component", "claude-login", "user", core.IdentityFromRequest(r).User)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, Message: "Sign-in cancelled."})
		return
	}
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, Message: "No sign-in was in progress."})
}

// requireLoginEnabled answers 404 when signing in over HTTP is switched off, so a deployment that
// disables it is indistinguishable from one that never had the endpoints.
func (s *Service) requireLoginEnabled(w http.ResponseWriter, r *http.Request) bool {
	if s.login != nil && s.agents.isEnabled(agentClaude) && s.login.LoginEnabled() {
		return true
	}
	core.LogCtx(r).Warn("sign-in endpoint refused: disabled by configuration", "component", "claude-login")
	core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "Claude sign-in is not enabled on this service"})
	return false
}
