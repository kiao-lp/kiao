package runnerhttp

import (
	"context"
	"encoding/json"
	"errors"
	coreconfig "kiao/worker/internal/core/config"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	pkgLogin "kiao/worker/internal/hybridflow-runner/agents/login"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/skills"
	"net/http"
	"net/http/httptest"
	pkgExec "os/exec"
	"strings"
	"testing"
	"time"
)

// fakeLoginScript mimics `claude auth login` closely enough to exercise the whole flow: the banner
// and authorize URL on stdout, then a prompt carrying no newline, then a line read from stdin that
// decides the exit code. dash flushes stdout before `read`, so the URL really does arrive before
// the process blocks, exactly as it does with the real CLI.
const fakeLoginScript = `
printf 'Opening browser to sign in\n'
printf 'If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=xyz\n'
printf 'Paste code here if prompted > '
read -r code
if [ "$code" = "good#state" ]; then printf 'Login successful.\n'; exit 0; fi
printf 'Login failed: Request failed with status code 400\n'
exit 1
`

const fakeAuthorizeURL = "https://claude.com/cai/oauth/authorize?code=true&state=xyz"

// newFakeLoginService builds a service driving `script` instead of the CLI, which is what makes the
// flow testable: a real sign-in needs a browser and a human.
func newFakeLoginService(t *testing.T, script string, enabled bool) *claudecli.ClaudeLoginService {
	t.Helper()
	svc := &claudecli.ClaudeLoginService{
		Enabled: enabled,
		LoginCmd: func(ctx context.Context) *pkgExec.Cmd {
			return pkgExec.CommandContext(ctx, "sh", "-c", script)
		},
		AuthStatus: func(context.Context) ([]byte, error) {
			return []byte(`{"loggedIn":true,"authMethod":"claude.ai"}`), nil
		},
	}
	t.Cleanup(svc.Shutdown)
	return svc
}

func currentSession(svc *claudecli.ClaudeLoginService) *claudecli.ClaudeLoginSession {
	svc.Mu.Lock()
	defer svc.Mu.Unlock()
	return svc.Session
}

// An accepted code is the happy path end to end: start yields the URL the CLI printed, the code
// reaches the parked process's stdin, and a zero exit reports success carrying the CLI's own words.
func TestClaudeLoginAcceptedCode(t *testing.T) {
	svc := newFakeLoginService(t, fakeLoginScript, true)

	url, err := svc.Start()
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if url != fakeAuthorizeURL {
		t.Errorf("url = %q, want %q", url, fakeAuthorizeURL)
	}

	ok, message, err := svc.SubmitCode("good#state")
	if err != nil {
		t.Fatalf("submitCode: %v", err)
	}
	if !ok {
		t.Errorf("ok = false, want true (message %q)", message)
	}
	// The stdin prompt must not leak into the message: only the CLI's answer to the code is worth
	// showing, whichever side of the submit mark the unterminated prompt happened to land on.
	if message != "Login successful." {
		t.Errorf("message = %q, want %q", message, "Login successful.")
	}
	if currentSession(svc) != nil {
		t.Errorf("a finished sign-in should leave no session behind")
	}
}

// A refused code is not a service failure: it comes back ok=false with the CLI's diagnosis, so the
// user can tell "wrong code" from "the service is broken".
func TestClaudeLoginRejectedCode(t *testing.T) {
	svc := newFakeLoginService(t, fakeLoginScript, true)
	if _, err := svc.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	ok, message, err := svc.SubmitCode("wrong-code")
	if err != nil {
		t.Fatalf("submitCode returned an error for a refused code: %v", err)
	}
	if ok {
		t.Errorf("ok = true, want false")
	}
	if !strings.Contains(message, "Login failed") {
		t.Errorf("message = %q, want it to carry the CLI's failure line", message)
	}
	if currentSession(svc) != nil {
		t.Errorf("a failed sign-in should leave no session behind")
	}
}

// A code with no sign-in in flight (stale tab, or a restart between the two steps) is reported as
// such rather than silently doing nothing.
func TestClaudeLoginCodeWithoutStart(t *testing.T) {
	svc := newFakeLoginService(t, fakeLoginScript, true)

	if _, _, err := svc.SubmitCode("good#state"); err != pkgLogin.ErrNoLoginInFlight {
		t.Errorf("err = %v, want errNoLoginInFlight", err)
	}
}

// Starting over replaces the parked process: the abandoned attempt's code is unusable anyway, and
// leaving it parked on stdin would leak a process per abandoned tab.
func TestClaudeLoginStartReplacesUnfinished(t *testing.T) {
	svc := newFakeLoginService(t, fakeLoginScript, true)
	if _, err := svc.Start(); err != nil {
		t.Fatalf("first start: %v", err)
	}
	first := currentSession(svc)

	if _, err := svc.Start(); err != nil {
		t.Fatalf("second start: %v", err)
	}
	second := currentSession(svc)

	if first == nil || second == nil || first == second {
		t.Fatalf("the second start should have replaced the first session")
	}
	select {
	case <-first.Done:
	case <-time.After(5 * time.Second):
		t.Errorf("the replaced sign-in process was not killed")
	}

	// The live session is the second one, and it is the one the code reaches.
	ok, message, err := svc.SubmitCode("good#state")
	if err != nil || !ok {
		t.Errorf("submitCode after replacement: ok = %v, err = %v (message %q)", ok, err, message)
	}
}

// A CLI that dies without printing a URL (absent binary, broken install) must fail the start step
// with what it did print, not hang until the URL timeout.
func TestClaudeLoginStartWithoutURL(t *testing.T) {
	svc := newFakeLoginService(t, `printf 'hub: command not found\n'; exit 127`, true)

	url, err := svc.Start()
	if err == nil {
		t.Fatalf("expected an error, got url %q", url)
	}
	if !strings.Contains(err.Error(), "command not found") {
		t.Errorf("err = %v, want it to carry the CLI output", err)
	}
	if currentSession(svc) != nil {
		t.Errorf("a failed start should leave no session behind")
	}
}

// shutdown must not leave a parked CLI process behind when the service stops (systemd SIGTERM).
func TestClaudeLoginShutdownKillsSession(t *testing.T) {
	svc := newFakeLoginService(t, fakeLoginScript, true)
	if _, err := svc.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	session := currentSession(svc)

	svc.Shutdown()

	if currentSession(svc) != nil {
		t.Errorf("shutdown should clear the session")
	}
	select {
	case <-session.Done:
	case <-time.After(5 * time.Second):
		t.Errorf("process was not killed by shutdown within 5s")
	}
}

// The URL is only read off a completed line: a read that splits it mid-way must not publish a
// truncated URL, which would send the user to a broken page.
func TestFindAuthorizeURL(t *testing.T) {
	cases := map[string]struct {
		text string
		want string
	}{
		"complete line":      {"visit: " + fakeAuthorizeURL + "\n", fakeAuthorizeURL},
		"followed by more":   {"visit: " + fakeAuthorizeURL + "\nPaste code here > ", fakeAuthorizeURL},
		"line still partial": {"visit: https://claude.com/cai/oauth/authorize?code=tr", ""},
		"split mid-url":      {"banner\nvisit: https://claude.com/cai/oauth/authorize?code=tr", ""},
		"no url":             {"Opening browser to sign in\n", ""},
	}
	for name, tc := range cases {
		if got := claudecli.FindAuthorizeURL(tc.text); got != tc.want {
			t.Errorf("%s: findAuthorizeURL = %q, want %q", name, got, tc.want)
		}
	}
}

// The stdin prompt carries no newline, so whether it precedes or follows the mark taken at submit
// time is a matter of flush timing rather than meaning. Either way it is noise, not a message.
func TestCleanLoginMessage(t *testing.T) {
	cases := map[string]struct {
		raw  string
		want string
	}{
		"prompt before answer": {"Paste code here if prompted > Login failed: 400\n", "Login failed: 400"},
		"answer alone":         {"  Login successful.\n", "Login successful."},
		"prompt alone":         {"Paste code here if prompted ", ""},
		"empty":                {"", ""},
	}
	for name, tc := range cases {
		if got := claudecli.CleanLoginMessage(tc.raw); got != tc.want {
			t.Errorf("%s: cleanLoginMessage = %q, want %q", name, got, tc.want)
		}
	}

	if got := claudecli.CleanLoginMessage(strings.Repeat("x", pkgLogin.MaxLoginMessage+500)); len(got) != pkgLogin.MaxLoginMessage+len("…") {
		t.Errorf("long output was not capped: len = %d", len(got))
	}
}

// A logged-out CLI prints a well-formed status *and* exits 1. Reading the exit code as the signal
// would turn the most useful answer this endpoint has ("you are logged out") into a 503.
func TestClaudeAuthStatusLoggedOut(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled: true,
		AuthStatus: func(context.Context) ([]byte, error) {
			return []byte(`{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}`),
				&pkgExec.ExitError{}
		},
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.LoggedIn {
		t.Errorf("loggedIn = true, want false")
	}
	if status.AuthMethod != "none" {
		t.Errorf("authMethod = %q, want none", status.AuthMethod)
	}
	// loginEnabled is the service's own contribution: it is what tells a client whether to offer
	// the sign-in button at all.
	if !status.LoginEnabled {
		t.Errorf("loginEnabled = false, want true")
	}
}

// With nothing parsable to go on, the failure is reported rather than passed off as "logged out".
func TestClaudeAuthStatusUnparsable(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		AuthStatus: func(context.Context) ([]byte, error) { return nil, &pkgExec.ExitError{} },
	}
	if _, err := svc.Status(); err == nil {
		t.Errorf("expected an error when the CLI produces no status")
	}
}

// signedInCLI is a `claude auth status` that reports a healthy claude.ai session, whatever the
// stored credentials say — which is exactly the CLI's real behaviour and the whole problem.
func signedInCLI(context.Context) ([]byte, error) {
	return []byte(`{"loggedIn":true,"authMethod":"claude.ai","email":"someone@example.com","subscriptionType":"max"}`), nil
}

// storedSession stands in for the credentials file, so a test can put a session in any state
// without waiting hours for one to get there.
func storedSession(token string, expiresIn, refreshExpiresIn time.Duration) func() (claudecli.ClaudeCredentials, error) {
	now := time.Now()
	return func() (claudecli.ClaudeCredentials, error) {
		return claudecli.ClaudeCredentials{
			AccessToken:           token,
			ExpiresAt:             now.Add(expiresIn),
			RefreshTokenExpiresAt: now.Add(refreshExpiresIn),
		}, nil
	}
}

// The reported failure, in one test: the CLI says signed in, the refresh token expired an hour ago,
// and the endpoint must say signed out — that field is the only thing standing between the user and
// a sign-in button.
func TestClaudeAuthStatusRefreshTokenExpired(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled:     true,
		AuthStatus:  signedInCLI,
		Credentials: storedSession("sk-ant-oat01-x", -2*time.Hour, -time.Hour),
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.LoggedIn {
		t.Errorf("loggedIn = true for a session that can no longer be renewed, want false")
	}
	// The banner is only offered a button where signing in over HTTP is exposed, so the two fields
	// have to arrive together — a signed-out status with no way to act on it is half an answer.
	if !status.LoginEnabled {
		t.Errorf("loginEnabled = false, want true")
	}
}

// The CLI blanks the tokens in place when it gives up on a session itself, leaving a file that
// parses perfectly and holds nothing.
func TestClaudeAuthStatusBlankedCredentials(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled:     true,
		AuthStatus:  signedInCLI,
		Credentials: storedSession("", -2*time.Hour, 20*24*time.Hour),
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.LoggedIn {
		t.Errorf("loggedIn = true for blanked credentials, want false")
	}
}

// The other direction, and the reason the check is not simply "is the access token in date": that
// one lapses every few hours and the CLI renews it on the next call. A banner over a session in
// this state would be up more often than not, and users would learn to ignore it.
func TestClaudeAuthStatusExpiredAccessTokenIsNotASignOut(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled:     true,
		AuthStatus:  signedInCLI,
		Credentials: storedSession("sk-ant-oat01-x", -2*time.Hour, 20*24*time.Hour),
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.LoggedIn {
		t.Errorf("loggedIn = false while the access token is merely stale, want true")
	}
	if status.Email != "someone@example.com" {
		t.Errorf("email = %q, want the CLI's own answer passed through", status.Email)
	}
}

// Credentials that cannot be read say nothing about the session — a relocated file, a different
// user, a permission the service does not have. The CLI's answer stands, or this check becomes the
// same bug pointing the other way: a sign-in banner nobody can dismiss.
func TestClaudeAuthStatusUnreadableCredentialsLeaveTheCLIsAnswer(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled:    true,
		AuthStatus: signedInCLI,
		Credentials: func() (claudecli.ClaudeCredentials, error) {
			return claudecli.ClaudeCredentials{}, errors.New("no such file or directory")
		},
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.LoggedIn {
		t.Errorf("loggedIn = false on unreadable credentials, want the CLI's own answer")
	}
}

// The check only ever takes `loggedIn` away. A CLI that reports a sign-out is the authority on it,
// whatever a leftover credentials file happens to hold.
func TestClaudeAuthStatusNeverInventsASignIn(t *testing.T) {
	svc := &claudecli.ClaudeLoginService{
		Enabled: true,
		AuthStatus: func(context.Context) ([]byte, error) {
			return []byte(`{"loggedIn":false,"authMethod":"none"}`), &pkgExec.ExitError{}
		},
		Credentials: storedSession("sk-ant-oat01-x", time.Hour, 20*24*time.Hour),
	}

	status, err := svc.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.LoggedIn {
		t.Errorf("loggedIn = true, want the CLI's own sign-out to stand")
	}
}

// newLoginTestServer wires the sign-in service in the way the program does: behind the Claude
// agent, which is what answers the AgentLogin port the endpoints are mounted on.
func newLoginTestServer(t *testing.T, login *claudecli.ClaudeLoginService) *Service {
	t.Helper()
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "debug", RootPath: t.TempDir(), MaxUploadBytes: 1 << 20}}
	agent := &claudecli.ClaudeAgent{Cfg: cfg, Binary: skills.ClaudeBinaryName, Login: login}
	hub := assembly.NewEngine(cfg, nil)
	hub.Agents.Set(agentapi.AgentClaude, agent)
	return &Service{cfg: cfg, hub: hub, agents: hub.Agents, login: agent}
}

// Where signing in is switched off, the endpoints must be indistinguishable from ones that were
// never deployed — and no process may be spawned on the way to finding out.
func TestClaudeLoginDisabled(t *testing.T) {
	login := newFakeLoginService(t, fakeLoginScript, false)
	s := newLoginTestServer(t, login)

	for _, path := range []string{
		"/claude/auth/login/start",
		"/claude/auth/login/code",
		"/claude/auth/login/cancel",
	} {
		rec := do(s, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"code":"x"}`)))
		if rec.Code != http.StatusNotFound {
			t.Errorf("POST %s with login disabled: status = %d, want 404", path, rec.Code)
		}
	}
	if currentSession(login) != nil {
		t.Errorf("a refused request must not have spawned a sign-in")
	}

	// Status stays reachable: "is the host logged in?" is the first question asked of a deployment
	// whose Claude features have gone quiet, whether or not signing in from here is allowed.
	if rec := do(s, httptest.NewRequest(http.MethodGet, "/claude/auth/status", nil)); rec.Code != http.StatusOK {
		t.Errorf("GET /claude/auth/status with login disabled: status = %d, want 200", rec.Code)
	}
}

// The wire payload the panel renders its banner from, end to end over a lapsed session. The panel
// decides on `loggedIn` alone, so this is the whole contract: a 200 carrying `loggedIn:false` and a
// `loginEnabled` that says a button may be offered. Anything else — a 503, or a body still claiming
// the host is signed in — and the user is left in a panel where every prompt fails silently.
func TestClaudeAuthStatusEndpointOffersSignInForALapsedSession(t *testing.T) {
	login := newFakeLoginService(t, fakeLoginScript, true)
	login.AuthStatus = signedInCLI
	login.Credentials = storedSession("sk-ant-oat01-x", -2*time.Hour, -time.Hour)
	s := newLoginTestServer(t, login)

	rec := do(s, httptest.NewRequest(http.MethodGet, "/claude/auth/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body agentapi.AgentAuthStatusDto
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.LoggedIn {
		t.Errorf("loggedIn = true, want false — the panel shows no sign-in banner while this is true")
	}
	if !body.LoginEnabled {
		t.Errorf("loginEnabled = false, want true — the banner would offer no button")
	}
}

// The code is a single line handed to a line-oriented stdin: an embedded newline would be a second
// answer to whatever the CLI asks next, so it is refused before reaching the process.
func TestClaudeLoginCodeValidation(t *testing.T) {
	s := newLoginTestServer(t, newFakeLoginService(t, fakeLoginScript, true))

	for name, body := range map[string]string{
		"empty":     `{"code":"   "}`,
		"newline":   "{\"code\":\"good#state\\nrm -rf /\"}",
		"too long":  `{"code":"` + strings.Repeat("x", claudecli.MaxLoginCodeLength+1) + `"}`,
		"not json":  `{`,
		"no fields": `{}`,
	} {
		rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/auth/login/code", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, rec.Code)
		}
	}
}

// A well-formed code with no sign-in in flight is a conflict, not a bad request: the caller did
// nothing wrong, the server just has nothing parked to feed it to.
func TestClaudeLoginCodeWithoutSessionIsConflict(t *testing.T) {
	s := newLoginTestServer(t, newFakeLoginService(t, fakeLoginScript, true))

	rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/auth/login/code", strings.NewReader(`{"code":"good#state"}`)))
	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
}

// The full flow over HTTP, which is how Dashboard drives it: start returns the URL, the code comes
// back ok, and cancel is a no-op once the session is gone.
func TestClaudeLoginEndpointsFlow(t *testing.T) {
	s := newLoginTestServer(t, newFakeLoginService(t, fakeLoginScript, true))

	rec := do(s, httptest.NewRequest(http.MethodPost, "/claude/auth/login/start", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("start: status = %d, want 200", rec.Code)
	}
	// Decoded, not string-matched: the encoder escapes the URL's `&` as &, which a JSON
	// client turns back into the URL the CLI printed.
	var start agentapi.AgentLoginDto
	if err := json.Unmarshal(rec.Body.Bytes(), &start); err != nil {
		t.Fatalf("start body %s: %v", rec.Body.String(), err)
	}
	if !start.Ok || start.URL != fakeAuthorizeURL {
		t.Fatalf("start = %+v, want ok with url %q", start, fakeAuthorizeURL)
	}

	rec = do(s, httptest.NewRequest(http.MethodPost, "/claude/auth/login/code", strings.NewReader(`{"code":"good#state"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("code: status = %d, want 200", rec.Code)
	}
	var submitted agentapi.AgentLoginDto
	if err := json.Unmarshal(rec.Body.Bytes(), &submitted); err != nil {
		t.Fatalf("code body %s: %v", rec.Body.String(), err)
	}
	if !submitted.Ok {
		t.Errorf("code = %+v, want ok", submitted)
	}

	rec = do(s, httptest.NewRequest(http.MethodPost, "/claude/auth/login/cancel", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("cancel after completion: status = %d, want 200", rec.Code)
	}
}
