package hybridflowrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"kiao/worker/internal/core"
)

// MuseLoginService signs the server-side `muse` CLI in from the browser, so a signed-out host
// does not require a shell on the machine. Two shapes, one gate:
//
//   - the device flow, `muse login`: the CLI prints a page to open and a code to confirm, then
//     waits for the approval — driven here the way Claude's OAuth is, as one parked process
//     between the round trips, with the panel polling for the wait's end;
//   - the API key, `muse auth set --api-key-stdin`: one round trip, the key read off stdin and
//     stored, which is the whole flow.
//
// The feature is gated by KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED (default off). Either shape
// binds the host's CLI to whoever signs in, so the endpoints stay absent from deployments that do
// not want that reachable over HTTP. Neither credential is ever logged.
type MuseLoginService struct {
	enabled bool
	// binary is the CLI to spawn. A field rather than a literal for the reason the Muse agent has
	// one: pointing it at a script standing in for the CLI is what makes the key flow testable
	// without touching the machine's own credentials. Production never changes it.
	binary string
	// loginCmd builds the device-flow command. A field so a test can stand in for a CLI it cannot
	// drive: a real approval needs a browser and a human.
	loginCmd func(ctx context.Context) *exec.Cmd

	mu      sync.Mutex
	session *museDeviceSession
}

// museDeviceSession is one parked `muse login` process: the output drained from it, and the
// channels the handlers wait on. stdin needs no holding — the CLI waits on its own server poll,
// not on its input — so there is no pipe to keep open across the requests.
type museDeviceSession struct {
	cmd    *exec.Cmd
	cancel context.CancelFunc

	pageFound chan museDevicePage // buffered(1): the page and code, as soon as both are seen
	done      chan struct{}       // closed once the process has exited and its output is drained

	mu       sync.Mutex
	output   bytes.Buffer
	exitCode int
}

// museDevicePage is what the user acts on: the page to open, and the code to confirm matches.
type museDevicePage struct {
	url      string
	userCode string
}

const (
	// museAuthSetTimeout bounds `muse auth set`. It is a local file write; the bound is for a
	// machine having a bad minute, not for the command being long.
	museAuthSetTimeout = 30 * time.Second
	// maxAPIKeyLength rejects an implausibly long paste before it reaches the CLI.
	maxAPIKeyLength = 4096
	// deviceURLTimeout bounds how long the CLI may take to print the sign-in page.
	deviceURLTimeout = 30 * time.Second
	// deviceSessionTTL kills a device flow nobody finished. Meta expires the code on its own side
	// regardless; this is what stops an abandoned process from polling forever.
	deviceSessionTTL = 10 * time.Minute
	// deviceWaitingMarker is the line the CLI prints once the page and code are out and the wait
	// begins. What it writes after this point is the wait's answer, which is the only part worth
	// relaying.
	deviceWaitingMarker = "Waiting for approval"
	// deviceCodeMarker introduces the code: the non-empty line after it is what the user confirms.
	deviceCodeMarker = "confirm this code matches"
)

// deviceURLRe matches the sign-in page the CLI prints ("Open this page to sign in:\n
// https://…"). It is only ever applied to complete lines, so a read that splits the URL cannot
// yield a truncated match.
var deviceURLRe = regexp.MustCompile(`https://\S+`)

func newMuseLoginService(cfg *Config) *MuseLoginService {
	svc := &MuseLoginService{enabled: cfg.MuseLoginEnabled, binary: museBinaryName}
	svc.loginCmd = func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, svc.binary, "login")
	}
	return svc
}

// submitKey stores the key with the host CLI. A non-zero exit is a refused key, not a service
// failure, so it comes back as ok=false rather than an error — the CLI's own sentence, which is
// what the panel shows.
func (svc *MuseLoginService) submitKey(key string) (bool, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), museAuthSetTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, svc.binary, "auth", "set", "--api-key-stdin")
	cmd.Stdin = strings.NewReader(key)
	out, err := cmd.CombinedOutput()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return false, orDefault(cleanAPIKeyMessage(out),
				fmt.Sprintf("sign-in failed (exit %d)", exitErr.ExitCode())), nil
		}
		return false, "", fmt.Errorf("could not store the API key: %w", err)
	}
	return true, orDefault(cleanAPIKeyMessage(out), "Signed in."), nil
}

// cleanAPIKeyMessage turns the CLI's output into something worth showing: trimmed and capped. The
// key itself never passes through here — it went in on stdin, and nothing the CLI prints repeats
// it.
func cleanAPIKeyMessage(out []byte) string {
	s := strings.TrimSpace(string(out))
	if len(s) > maxLoginMessage {
		s = s[:maxLoginMessage] + "…"
	}
	return s
}

// ── the device flow ─────────────────────────────────────────────────────────────

// startDevice spawns the CLI and returns the page to open and the code to confirm.
func (svc *MuseLoginService) startDevice() (string, string, error) {
	session, err := svc.spawnDevice()
	if err != nil {
		return "", "", err
	}
	select {
	case page := <-session.pageFound:
		return page.url, page.userCode, nil
	case <-session.done:
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
func (svc *MuseLoginService) deviceStatus() (pending, ok bool, message string, err error) {
	svc.mu.Lock()
	session := svc.session
	svc.mu.Unlock()
	if session == nil {
		return false, false, "", errNoLoginInFlight
	}
	select {
	case <-session.done:
		defer svc.discardDevice(session)
		if exit := session.exit(); exit == 0 {
			return false, true, orDefault(session.message(), "Signed in."), nil
		} else {
			return false, false, orDefault(session.message(),
				fmt.Sprintf("sign-in failed (exit %d)", exit)), nil
		}
	default:
		return true, false, "", nil
	}
}

// cancelDevice kills a device flow in progress, reporting whether there was one.
func (svc *MuseLoginService) cancelDevice() bool {
	return svc.cancelDeviceCurrent()
}

// shutdownDevice kills a parked device flow, so none survives the service (systemd SIGTERM).
func (svc *MuseLoginService) shutdownDevice() {
	if svc.cancelDeviceCurrent() {
		logMuseLogin.Info("device sign-in cancelled by shutdown")
	}
}

// ── device process plumbing ───────────────────────────────────────────────────

func (svc *MuseLoginService) spawnDevice() (*museDeviceSession, error) {
	// An earlier unfinished flow is replaced rather than queued behind: its code is dead once the
	// user starts over.
	if svc.cancelDeviceCurrent() {
		logMuseLogin.Info("replacing an unfinished device sign-in")
	}

	ctx, cancel := context.WithTimeout(context.Background(), deviceSessionTTL)
	cmd := svc.loginCmd(ctx)

	pr, pw, err := os.Pipe()
	if err != nil {
		cancel()
		return nil, err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		cancel()
		pw.Close()
		pr.Close()
		return nil, fmt.Errorf("could not start `muse login`: %w", err)
	}
	pw.Close() // the parent drops its write end; the child keeps its dup

	session := &museDeviceSession{
		cmd:       cmd,
		cancel:    cancel,
		pageFound: make(chan museDevicePage, 1),
		done:      make(chan struct{}),
	}
	go session.readOutput(pr)

	svc.mu.Lock()
	svc.session = session
	svc.mu.Unlock()
	logMuseLogin.Info("device sign-in started", "pid", cmd.Process.Pid)
	return session, nil
}

// discardDevice releases a session's context — killing the process if it is still running — and
// clears it from the registry, but only while it is still the current one, so a slow handler
// cannot evict the session a later request has since started.
func (svc *MuseLoginService) discardDevice(session *museDeviceSession) {
	session.cancel()
	svc.mu.Lock()
	if svc.session == session {
		svc.session = nil
	}
	svc.mu.Unlock()
}

// cancelDeviceCurrent kills whatever device flow is in flight, reporting whether there was one.
func (svc *MuseLoginService) cancelDeviceCurrent() bool {
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

// readOutput drains the CLI's merged stdout/stderr until the process exits, publishing the page
// and code as soon as both appear on complete lines. Draining matters after that too: a full pipe
// would block the child mid-flow.
func (s *museDeviceSession) readOutput(pr *os.File) {
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
				if page, ok := findDevicePage(text); ok {
					published = true
					s.pageFound <- page
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

func (s *museDeviceSession) exit() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}

// message returns what the CLI wrote after the wait began, cleaned up for display: the wait's
// answer, without the page-and-code banner that preceded it.
func (s *museDeviceSession) message() string {
	s.mu.Lock()
	raw := s.output.String()
	s.mu.Unlock()
	if i := strings.Index(raw, deviceWaitingMarker); i >= 0 {
		if j := strings.IndexByte(raw[i:], '\n'); j >= 0 {
			raw = raw[i+j+1:]
		} else {
			raw = ""
		}
	}
	return cleanDeviceMessage(raw)
}

// findDevicePage returns the page and code if the text holds them on completed lines. Restricting
// the search to what precedes the last newline is what guarantees a match is whole: the CLI prints
// the page followed by a newline, so a partial read cannot produce a truncated one.
//
// The code is read two ways, because it is printed twice: it rides the page URL as the `code`
// query — the same code, character for character — and it is printed again under the marker. The
// URL's own is taken first; the marker's is what saves the flow if Meta ever reshapes the URL.
//
// Nothing is published on the URL alone while the code may still be on its way: the page line
// precedes the code lines, so a line-buffered read would otherwise publish a codeless page and
// never revisit it. The waiting line comes after both, so a page seen beside it is a page whose
// code is not coming — published as URL-only, which the dialog draws without the code row.
func findDevicePage(text string) (museDevicePage, bool) {
	end := strings.LastIndexByte(text, '\n')
	if end < 0 {
		return museDevicePage{}, false
	}
	complete := text[:end]
	raw := deviceURLRe.FindString(complete)
	if raw == "" {
		return museDevicePage{}, false
	}
	if code := deviceCodeOf(raw); code != "" {
		return museDevicePage{url: raw, userCode: code}, true
	}
	if code := deviceCodeUnder(complete); code != "" {
		return museDevicePage{url: raw, userCode: code}, true
	}
	if strings.Contains(complete, deviceWaitingMarker) {
		return museDevicePage{url: raw}, true
	}
	return museDevicePage{}, false
}

// deviceCodeOf reads the code the page URL carries as its `code` query.
func deviceCodeOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("code")
}

// deviceCodeUnder reads the code printed under the marker: the first non-empty line after it.
func deviceCodeUnder(complete string) string {
	lines := strings.Split(complete, "\n")
	for i, line := range lines {
		if !strings.Contains(line, deviceCodeMarker) {
			continue
		}
		for _, next := range lines[i+1:] {
			if code := strings.TrimSpace(next); code != "" {
				return code
			}
		}
	}
	return ""
}

// cleanDeviceMessage turns captured CLI output into something worth showing: trimmed and capped.
func cleanDeviceMessage(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLoginMessage {
		s = s[:maxLoginMessage] + "…"
	}
	return s
}

// offersAPIKeyLogin reports whether any agent can be signed in with an API key, which is what
// decides whether POST /hybridflow-runner/auth/{agent}/key is mounted at all. Any and not all: the endpoint
// answers per agent, and one with no such sign-in answers 404 rather than keeping the route off
// the air for the other.
func (s *Service) offersAPIKeyLogin() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.entries {
		if _, ok := entry.agent.(AgentAPIKeyLogin); ok {
			return true
		}
	}
	return false
}

// offersDeviceLogin reports whether any agent signs in as a device flow, which is what decides
// whether the device endpoints are mounted at all — same shape as the key one above.
func (s *Service) offersDeviceLogin() bool {
	if s.agents == nil {
		return false
	}
	for _, entry := range s.agents.entries {
		if _, ok := entry.agent.(AgentDeviceLogin); ok {
			return true
		}
	}
	return false
}

// HandleAPIKeyLogin serves POST /hybridflow-runner/auth/{agent}/key: stores the API key the body carries
// with that agent's host CLI — the sign-in the usage panel drives. It follows the convention the
// Claude flow follows: a key the CLI refused is a 200 with ok:false and a message worth showing,
// not an HTTP error.
//
// A deployment that keeps the endpoint off answers 404, indistinguishable from an agent with no
// such sign-in at all.
func (s *Service) HandleAPIKeyLogin(w http.ResponseWriter, r *http.Request) {
	agent := r.PathValue("agent")
	login := s.agents.apiKeyLoginFor(agent)
	if login == nil || !login.APIKeyLoginEnabled() {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "API-key sign-in is not enabled for this agent"})
		return
	}
	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	// Trimmed like the Claude code: a paste carries a trailing newline, and the key itself must
	// not — stdin is the whole key, and extra lines would be extra input to whatever reads next.
	key := strings.TrimSpace(req.Key)
	if key == "" || len(key) > maxAPIKeyLength || strings.ContainsAny(key, "\r\n") {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid key"})
		return
	}

	ok, message, err := login.SubmitAPIKey(key)
	if err != nil {
		core.LogCtx(r).Warn("API-key sign-in failed", "component", "muse-login", "agent", agent, "error", err)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	logMuseLogin.Info("API-key sign-in finished", "agent", agent, "ok", ok,
		"user", core.IdentityFromRequest(r).User)
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: ok, Message: message})
}

// ── device handlers ───────────────────────────────────────────────────────────

// deviceLoginForRequest resolves the agent's device port, or answers the 404 a deployment that
// keeps the endpoint off is indistinguishable by.
func (s *Service) deviceLoginForRequest(w http.ResponseWriter, r *http.Request) AgentDeviceLogin {
	login := s.agents.deviceLoginFor(r.PathValue("agent"))
	if login == nil || !login.DeviceLoginEnabled() {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusNotFound, Msg: "Device sign-in is not enabled for this agent"})
		return nil
	}
	return login
}

// HandleDeviceLoginStart serves POST /hybridflow-runner/auth/{agent}/login/start: spawns the CLI and returns
// the page to open and the code to confirm.
func (s *Service) HandleDeviceLoginStart(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	url, userCode, err := login.DeviceLoginStart()
	if err != nil {
		core.LogCtx(r).Warn("device sign-in start failed", "component", "muse-login", "error", err)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: false, Message: err.Error()})
		return
	}
	core.LogCtx(r).Info("device sign-in page issued", "component", "muse-login",
		"user", core.IdentityFromRequest(r).User)
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, URL: url, UserCode: userCode})
}

// HandleDeviceLoginStatus serves GET /hybridflow-runner/auth/{agent}/login/status: pending while the CLI is
// still parked on the approval, and once it has exited whether the approval landed. Reading a
// finished wait consumes it; a status with nothing in flight is 409.
func (s *Service) HandleDeviceLoginStatus(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	pending, ok, message, err := login.DeviceLoginStatus()
	if err != nil {
		if errors.Is(err, errNoLoginInFlight) {
			core.WriteError(w, r, &core.HTTPError{Status: http.StatusConflict, Msg: err.Error()})
			return
		}
		core.LogCtx(r).Warn("device sign-in status failed", "component", "muse-login", "error", err)
		core.WriteJSON(w, http.StatusOK, AgentDeviceLoginDto{Message: err.Error()})
		return
	}
	if !pending {
		logMuseLogin.Info("device sign-in finished", "ok", ok,
			"user", core.IdentityFromRequest(r).User)
	}
	core.WriteJSON(w, http.StatusOK, AgentDeviceLoginDto{Pending: pending, Ok: ok, Message: message})
}

// HandleDeviceLoginCancel serves POST /hybridflow-runner/auth/{agent}/login/cancel.
func (s *Service) HandleDeviceLoginCancel(w http.ResponseWriter, r *http.Request) {
	login := s.deviceLoginForRequest(w, r)
	if login == nil {
		return
	}
	if login.DeviceLoginCancel() {
		core.LogCtx(r).Info("device sign-in cancelled", "component", "muse-login",
			"user", core.IdentityFromRequest(r).User)
		core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, Message: "Sign-in cancelled."})
		return
	}
	core.WriteJSON(w, http.StatusOK, AgentLoginDto{Ok: true, Message: "No sign-in was in progress."})
}
