package hybridflowrunner

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeMuseAuthScript stands in for the `muse` CLI: it checks it was asked to store a key, reads
// the key off stdin — the only way the real command accepts one — and reports success for the one
// key it accepts.
const fakeMuseAuthScript = `#!/bin/sh
if [ "$1 $2 $3" != "auth set --api-key-stdin" ]; then echo "unexpected invocation: $*" >&2; exit 2; fi
read -r key
if [ "$key" = "good-key" ]; then echo "credentials saved for provider meta"; exit 0; fi
echo "not a key this CLI accepts" >&2
exit 1
`

// fakeMuseBinary writes the stand-in CLI to a temporary directory and returns its path.
func fakeMuseBinary(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "muse")
	if err := os.WriteFile(path, []byte(fakeMuseAuthScript), 0755); err != nil {
		t.Fatalf("write the fake muse CLI: %v", err)
	}
	return path
}

// ── the one round trip ────────────────────────────────────────────────────────

// A stored key is the happy path end to end: the key reaches the CLI's stdin, and a zero exit
// reports success carrying the CLI's own words.
func TestMuseSubmitKeyStoresIt(t *testing.T) {
	svc := &MuseLoginService{enabled: true, binary: fakeMuseBinary(t)}

	ok, message, err := svc.submitKey("good-key")
	if err != nil {
		t.Fatalf("submitKey: %v", err)
	}
	if !ok {
		t.Errorf("ok = false, want true (message %q)", message)
	}
	if message != "credentials saved for provider meta" {
		t.Errorf("message = %q, want the CLI's own words", message)
	}
}

// A refused key is not a service failure: it comes back ok=false with the CLI's diagnosis, so the
// user can tell "wrong key" from "the service is broken".
func TestMuseSubmitKeyRefused(t *testing.T) {
	svc := &MuseLoginService{enabled: true, binary: fakeMuseBinary(t)}

	ok, message, err := svc.submitKey("wrong-key")
	if err != nil {
		t.Fatalf("submitKey returned an error for a refused key: %v", err)
	}
	if ok {
		t.Error("ok = true, want false")
	}
	if !strings.Contains(message, "not a key this CLI accepts") {
		t.Errorf("message = %q, want it to carry the CLI's failure line", message)
	}
}

// A CLI that cannot be started at all is the service's problem, not the key's: an error rather
// than a refusal.
func TestMuseSubmitKeyWithoutBinary(t *testing.T) {
	svc := &MuseLoginService{enabled: true, binary: "muse-binary-that-does-not-exist"}

	if _, _, err := svc.submitKey("good-key"); err == nil {
		t.Error("err = nil, want the spawn failure")
	}
}

// ── the endpoint ──────────────────────────────────────────────────────────────

// keyService is a service whose Muse agent stores keys with the fake CLI — or refuses to, where
// the deployment keeps the endpoint off.
func keyService(t *testing.T, enabled bool) *Service {
	t.Helper()
	srv := newSocketTestServer(t, nil)
	srv.hub.agents.set(agentMuse, &museAgent{
		login: &MuseLoginService{enabled: enabled, binary: fakeMuseBinary(t)},
	})
	return srv
}

func postAPIKey(t *testing.T, srv *Service, agent, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/hybridflow-runner/auth/"+agent+"/key", strings.NewReader(body))
	req.SetPathValue("agent", agent)
	rec := httptest.NewRecorder()
	srv.HandleAPIKeyLogin(rec, req)
	return rec
}

func TestAPIKeyLoginStoresTheKey(t *testing.T) {
	rec := postAPIKey(t, keyService(t, true), agentMuse, `{"key":"good-key"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result AgentLoginDto
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !result.Ok {
		t.Errorf("ok = false, want true (message %q)", result.Message)
	}
}

func TestAPIKeyLoginRefusedKeyIsNotAnHTTPError(t *testing.T) {
	rec := postAPIKey(t, keyService(t, true), agentMuse, `{"key":"wrong-key"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result AgentLoginDto
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Ok {
		t.Error("ok = true, want false")
	}
	if !strings.Contains(result.Message, "not a key this CLI accepts") {
		t.Errorf("message = %q, want the CLI's failure line", result.Message)
	}
}

// A deployment that keeps the endpoint off is indistinguishable from an agent with no such sign-in:
// both are 404, and neither names the reason.
func TestAPIKeyLoginDisabledIsNotFound(t *testing.T) {
	if rec := postAPIKey(t, keyService(t, false), agentMuse, `{"key":"good-key"}`); rec.Code != http.StatusNotFound {
		t.Errorf("disabled status = %d, want 404", rec.Code)
	}
	if rec := postAPIKey(t, keyService(t, true), agentCodex, `{"key":"good-key"}`); rec.Code != http.StatusNotFound {
		t.Errorf("codex status = %d, want 404", rec.Code)
	}
	if rec := postAPIKey(t, keyService(t, true), "vaporised", `{"key":"good-key"}`); rec.Code != http.StatusNotFound {
		t.Errorf("unknown agent status = %d, want 404", rec.Code)
	}
}

// An empty, multi-line or implausibly long key never reaches the CLI: stdin is the whole key, and
// extra lines would be extra input to whatever reads next.
func TestAPIKeyLoginRejectsABadKey(t *testing.T) {
	srv := keyService(t, true)
	for _, key := range []string{"", "  ", "one\ntwo", strings.Repeat("k", maxAPIKeyLength+1)} {
		body, _ := json.Marshal(map[string]string{"key": key})
		if rec := postAPIKey(t, srv, agentMuse, string(body)); rec.Code != http.StatusBadRequest {
			t.Errorf("key %q: status = %d, want 400", key, rec.Code)
		}
	}
	if rec := postAPIKey(t, srv, agentMuse, `{"key":`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status = %d, want 400", rec.Code)
	}
}

// The route is on the air as long as one agent answers the port — and off it where none does,
// rather than serving an endpoint that cannot work.
func TestAPIKeyLoginRouteFollowsThePort(t *testing.T) {
	if patterns := mountedPatterns(keyService(t, true)); !patterns["POST /hybridflow-runner/auth/{agent}/key"] {
		t.Error("the key route is not mounted where Muse answers the port")
	}
	srv := newSocketTestServer(t, nil)
	srv.hub.agents.set(agentMuse, refusingAgent())
	if patterns := mountedPatterns(srv); patterns["POST /hybridflow-runner/auth/{agent}/key"] {
		t.Error("the key route is mounted where no agent answers the port")
	}
}

// ── the advertisement ─────────────────────────────────────────────────────────

// The options entry names the sign-in the usage panel can drive for the agent — and nothing for
// one it cannot sign in at all.
func TestHandleOptionsAdvertisesTheAPIKeyLogin(t *testing.T) {
	muse := newMuseAgent(&Config{MuseLoginEnabled: true})
	// The models are not what this test is about: reading them would spawn a `muse` the host
	// need not have.
	muse.options.catalogue = func() ([]byte, error) { return nil, errors.New("no CLI in this test") }
	srv := &Service{agents: &agentRegistry{entries: []agentEntry{
		{name: agentMuse, label: "Muse", agent: muse, allowed: true},
		{name: agentCodex, label: "Codex", agent: refusingAgent(), allowed: true},
	}}}

	req := httptest.NewRequest(http.MethodGet, "/hybridflow-runner/options", nil)
	rec := httptest.NewRecorder()
	srv.HandleOptions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var opts agentOptionsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &opts); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(opts.Agents) != 2 {
		t.Fatalf("agents = %+v, want the two entries", opts.Agents)
	}
	offered := opts.Agents[0]
	if offered.Login == nil {
		t.Fatalf("muse login = nil, want the sign-in offer")
	}
	if len(offered.Login.Methods) != 2 ||
		offered.Login.Methods[0] != deviceLoginMethod ||
		offered.Login.Methods[1] != apiKeyLoginMethod {
		t.Errorf("muse login methods = %+v, want the device flow first and the key second",
			offered.Login.Methods)
	}
	if !offered.Login.Enabled {
		t.Errorf("muse login = %+v, want the enabled offer", *offered.Login)
	}
	if offered.Login.HostCommand != "muse login" {
		t.Errorf("host command = %q, want the device flow's command", offered.Login.HostCommand)
	}
	if opts.Agents[1].Login != nil {
		t.Errorf("codex login = %+v, want no offer where the agent has no sign-in", *opts.Agents[1].Login)
	}
}

// A deployment that keeps the endpoint off still advertises the sign-in — as disabled, with the
// host command to run instead. Withholding the offer would leave the panel with no button and no
// explanation, which is the same dead end the failure link is there to open.
func TestHandleOptionsAdvertisesADisabledLoginAsDisabled(t *testing.T) {
	muse := newMuseAgent(&Config{})
	muse.options.catalogue = func() ([]byte, error) { return nil, errors.New("no CLI in this test") }
	srv := &Service{agents: &agentRegistry{entries: []agentEntry{
		{name: agentMuse, label: "Muse", agent: muse, allowed: true},
	}}}

	req := httptest.NewRequest(http.MethodGet, "/hybridflow-runner/options", nil)
	rec := httptest.NewRecorder()
	srv.HandleOptions(rec, req)

	var opts agentOptionsDto
	if err := json.Unmarshal(rec.Body.Bytes(), &opts); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(opts.Agents) != 1 || opts.Agents[0].Login == nil {
		t.Fatalf("agents = %+v, want the muse entry carrying its offer", opts.Agents)
	}
	if opts.Agents[0].Login.Enabled {
		t.Error("enabled = true, want the offer withheld by the deployment's own gate")
	}
}

// ── the device flow ───────────────────────────────────────────────────────────

// fakeDeviceBanner is what `muse login` prints verbatim: the page carrying the code as its query,
// the code again under the marker, and the wait beginning.
//
// A parked script ends in `exec sleep` rather than a bare `sleep`: the wait must be the session's
// own process and not its grandchild, which would inherit the pipe and hold it open past the kill
// — `done` would then never close and the test would hang to its timeout.
const fakeDeviceBanner = `
printf 'Open this page to sign in:\n'
printf '  https://auth.meta.com/oauth/device/?code=RDSN-TCSF\n'
printf 'confirm this code matches:\n'
printf '  RDSN-TCSF\n'
printf '\nWaiting for approval…\n'
`

const fakeDeviceURL = "https://auth.meta.com/oauth/device/?code=RDSN-TCSF"

// newFakeDeviceService builds a service driving `script` instead of the CLI, which is what makes
// the flow testable: a real approval needs a browser and a human.
func newFakeDeviceService(t *testing.T, script string, enabled bool) *MuseLoginService {
	t.Helper()
	svc := &MuseLoginService{
		enabled: enabled,
		loginCmd: func(ctx context.Context) *exec.Cmd {
			return exec.CommandContext(ctx, "sh", "-c", script)
		},
	}
	t.Cleanup(svc.shutdownDevice)
	return svc
}

func currentDeviceSession(svc *MuseLoginService) *museDeviceSession {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	return svc.session
}

// A start returns the page to open and the code to confirm, and parks the CLI on the wait.
func TestMuseDeviceStartReturnsPageAndCode(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)

	url, code, err := svc.startDevice()
	if err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	if url != fakeDeviceURL {
		t.Errorf("url = %q, want %q", url, fakeDeviceURL)
	}
	if code != "RDSN-TCSF" {
		t.Errorf("code = %q, want the code the page carries", code)
	}
	if currentDeviceSession(svc) == nil {
		t.Error("no session is parked on the wait")
	}
}

// The code is printed twice — as the page's query and under the marker. The marker's is what
// saves the flow if Meta ever reshapes the URL.
func TestMuseDeviceStartReadsCodeUnderMarker(t *testing.T) {
	script := `
printf 'Open this page to sign in:\n'
printf '  https://auth.meta.com/oauth/device/\n'
printf 'confirm this code matches:\n'
printf '  RDSN-TCSF\n'
printf '\nWaiting for approval…\n'
exec sleep 30`
	svc := newFakeDeviceService(t, script, true)

	url, code, err := svc.startDevice()
	if err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	if url != "https://auth.meta.com/oauth/device/" {
		t.Errorf("url = %q, want the page", url)
	}
	if code != "RDSN-TCSF" {
		t.Errorf("code = %q, want the code from under the marker", code)
	}
}

// A CLI that dies without printing a page (absent binary, broken install) must fail the start
// with what it did print, not hang until the page timeout.
func TestMuseDeviceStartWithoutPage(t *testing.T) {
	svc := newFakeDeviceService(t, `printf 'muse: command not found\n'; exit 127`, true)

	if _, _, err := svc.startDevice(); err == nil {
		t.Fatal("expected an error, got a page")
	} else if !strings.Contains(err.Error(), "command not found") {
		t.Errorf("err = %v, want it to carry the CLI output", err)
	}
	if currentDeviceSession(svc) != nil {
		t.Error("a failed start should leave no session behind")
	}
}

// Starting over replaces the parked process: the abandoned attempt's code is dead anyway, and
// leaving it polling would leak a process per abandoned tab.
func TestMuseDeviceStartReplacesUnfinished(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if _, _, err := svc.startDevice(); err != nil {
		t.Fatalf("first start: %v", err)
	}
	first := currentDeviceSession(svc)

	if _, _, err := svc.startDevice(); err != nil {
		t.Fatalf("second start: %v", err)
	}
	second := currentDeviceSession(svc)

	if first == nil || second == nil || first == second {
		t.Fatal("the second start should have replaced the first session")
	}
	select {
	case <-first.done:
	case <-time.After(5 * time.Second):
		t.Error("the replaced sign-in process was not killed")
	}
}

// statusUntilDone polls the service the way the panel polls the endpoint: until the wait ends or
// the deadline passes.
func statusUntilDone(t *testing.T, svc *MuseLoginService) (bool, string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		pending, ok, message, err := svc.deviceStatus()
		if err != nil {
			t.Fatalf("deviceStatus: %v", err)
		}
		if !pending {
			return ok, message
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the wait never ended")
	return false, ""
}

// Pending while the CLI is parked; done-and-stored once the approval lands, carrying the CLI's
// own sentence — and reading the finished wait consumes it.
func TestMuseDeviceStatusPendingThenApproved(t *testing.T) {
	parked := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if _, _, err := parked.startDevice(); err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	if pending, _, _, err := parked.deviceStatus(); err != nil || !pending {
		t.Fatalf("pending = %v, err = %v, want the wait still parked", pending, err)
	}

	approved := newFakeDeviceService(t, fakeDeviceBanner+`sleep 0.2
printf 'Logged in as user@example.com\n'
exit 0`, true)
	if _, _, err := approved.startDevice(); err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	ok, message := statusUntilDone(t, approved)
	if !ok {
		t.Errorf("ok = false, want true (message %q)", message)
	}
	if !strings.Contains(message, "Logged in as user@example.com") {
		t.Errorf("message = %q, want the CLI's sentence without the banner", message)
	}
	if _, _, _, err := approved.deviceStatus(); err != errNoLoginInFlight {
		t.Errorf("second status err = %v, want the finished wait consumed", err)
	}
}

// A refused approval is not a service failure: it comes back done-and-failed with the CLI's
// diagnosis, so the user can tell "denied" from "the service is broken".
func TestMuseDeviceStatusDenied(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+`sleep 0.2
printf 'approval denied\n' >&2
exit 1`, true)
	if _, _, err := svc.startDevice(); err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	ok, message := statusUntilDone(t, svc)
	if ok {
		t.Error("ok = true, want false")
	}
	if !strings.Contains(message, "approval denied") {
		t.Errorf("message = %q, want the CLI's failure line", message)
	}
}

// A status with nothing in flight (stale tab, or a restart between the two steps) is reported as
// such rather than silently doing nothing.
func TestMuseDeviceStatusWithoutStart(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if _, _, _, err := svc.deviceStatus(); err != errNoLoginInFlight {
		t.Errorf("err = %v, want errNoLoginInFlight", err)
	}
}

// Cancelling kills the parked process and reports whether there was one.
func TestMuseDeviceCancel(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if _, _, err := svc.startDevice(); err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	session := currentDeviceSession(svc)

	if !svc.cancelDevice() {
		t.Error("cancel = false, want true")
	}
	select {
	case <-session.done:
	case <-time.After(5 * time.Second):
		t.Error("the cancelled sign-in process was not killed")
	}
	if svc.cancelDevice() {
		t.Error("second cancel = true, want false")
	}
}

// shutdown must not leave a parked CLI process behind when the service stops (systemd SIGTERM).
func TestMuseDeviceShutdownKillsSession(t *testing.T) {
	svc := newFakeDeviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if _, _, err := svc.startDevice(); err != nil {
		t.Fatalf("startDevice: %v", err)
	}
	session := currentDeviceSession(svc)

	svc.shutdownDevice()

	if currentDeviceSession(svc) != nil {
		t.Error("shutdown should clear the session")
	}
	select {
	case <-session.done:
	case <-time.After(5 * time.Second):
		t.Error("process was not killed by shutdown within 5s")
	}
}

// ── device page parsing ───────────────────────────────────────────────────────

// The page is only read off completed lines, and never without its code while the code may still
// be on its way: the page line precedes the code lines, so publishing on it alone would publish a
// codeless page and never revisit it.
func TestFindDevicePage(t *testing.T) {
	full := "Open this page to sign in:\n" +
		"  https://auth.meta.com/oauth/device/?code=RDSN-TCSF\n" +
		"confirm this code matches:\n" +
		"  RDSN-TCSF\n" +
		"\nWaiting for approval…\n"
	page, ok := findDevicePage(full)
	if !ok || page.url != fakeDeviceURL || page.userCode != "RDSN-TCSF" {
		t.Errorf("full banner = %+v/%v, want the page and the code", page, ok)
	}
	// A read that splits the page mid-way must not publish a truncated URL.
	if _, ok := findDevicePage("  https://auth.meta.com/oauth/dev"); ok {
		t.Error("partial page line must publish nothing")
	}
	// A codeless page alone, its code lines still on their way: nothing yet — publishing now
	// would publish a codeless page and never revisit it.
	codeless := "https://auth.meta.com/oauth/device/"
	if _, ok := findDevicePage("Open this page to sign in:\n  " + codeless + "\n"); ok {
		t.Error("a page without its code lines must publish nothing yet")
	}
	// The marker's code landing completes it.
	marked := "Open this page to sign in:\n  " + codeless + "\nconfirm this code matches:\n  RDSN-TCSF\n"
	page, ok = findDevicePage(marked)
	if !ok || page.url != codeless || page.userCode != "RDSN-TCSF" {
		t.Errorf("marked codeless page = %+v/%v, want the page with the marker's code", page, ok)
	}
	// A page seen beside the wait is a page whose code is not coming: URL-only.
	waiting := "  https://auth.meta.com/oauth/device/\n\nWaiting for approval…\n"
	page, ok = findDevicePage(waiting)
	if !ok || page.url != "https://auth.meta.com/oauth/device/" || page.userCode != "" {
		t.Errorf("codeless page = %+v/%v, want the URL drawn without the code row", page, ok)
	}
}

// ── device endpoints ─────────────────────────────────────────────────────────-

// deviceService is a service whose Muse agent runs the device flow against `script`.
func deviceService(t *testing.T, script string, enabled bool) *Service {
	t.Helper()
	srv := newSocketTestServer(t, nil)
	login := newMuseLoginService(&Config{MuseLoginEnabled: enabled})
	login.loginCmd = func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c", script)
	}
	t.Cleanup(login.shutdownDevice)
	srv.hub.agents.set(agentMuse, &museAgent{login: login})
	return srv
}

func deviceCall(t *testing.T, srv *Service, handler func(http.ResponseWriter, *http.Request), method, agent string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/hybridflow-runner/auth/"+agent+"/login/x", nil)
	req.SetPathValue("agent", agent)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

// Start, wait, approval: the flow end to end over HTTP.
func TestDeviceLoginEndpointsFlow(t *testing.T) {
	srv := deviceService(t, fakeDeviceBanner+`sleep 0.2
printf 'Logged in as user@example.com\n'
exit 0`, true)

	started := deviceCall(t, srv, srv.HandleDeviceLoginStart, http.MethodPost, agentMuse)
	if started.Code != http.StatusOK {
		t.Fatalf("start status = %d, want 200", started.Code)
	}
	var begun AgentLoginDto
	if err := json.Unmarshal(started.Body.Bytes(), &begun); err != nil {
		t.Fatalf("decode start: %v", err)
	}
	if !begun.Ok || begun.URL != fakeDeviceURL || begun.UserCode != "RDSN-TCSF" {
		t.Fatalf("start = %+v, want the page and the code", begun)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		rec := deviceCall(t, srv, srv.HandleDeviceLoginStatus, http.MethodGet, agentMuse)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var status AgentDeviceLoginDto
		if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		if !status.Pending {
			if !status.Ok {
				t.Errorf("ok = false, want true (message %q)", status.Message)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the wait never ended")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// The finished wait is consumed: a second status is a stale tab, not a second answer.
	if rec := deviceCall(t, srv, srv.HandleDeviceLoginStatus, http.MethodGet, agentMuse); rec.Code != http.StatusConflict {
		t.Errorf("second status = %d, want 409", rec.Code)
	}
}

// Cancelling abandons the wait; cancelling nothing is still fine.
func TestDeviceLoginCancelEndpoint(t *testing.T) {
	srv := deviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if rec := deviceCall(t, srv, srv.HandleDeviceLoginStart, http.MethodPost, agentMuse); rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want 200", rec.Code)
	}
	cancelled := deviceCall(t, srv, srv.HandleDeviceLoginCancel, http.MethodPost, agentMuse)
	if cancelled.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, want 200", cancelled.Code)
	}
	var result AgentLoginDto
	if err := json.Unmarshal(cancelled.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode cancel: %v", err)
	}
	if !result.Ok {
		t.Errorf("ok = false, want true (message %q)", result.Message)
	}
	if rec := deviceCall(t, srv, srv.HandleDeviceLoginStatus, http.MethodGet, agentMuse); rec.Code != http.StatusConflict {
		t.Errorf("status after cancel = %d, want 409", rec.Code)
	}
	if rec := deviceCall(t, srv, srv.HandleDeviceLoginCancel, http.MethodPost, agentMuse); rec.Code != http.StatusOK {
		t.Errorf("second cancel = %d, want 200", rec.Code)
	}
}

// A deployment that keeps the endpoints off is indistinguishable from an agent with no device
// flow: every step is 404.
func TestDeviceLoginDisabledIsNotFound(t *testing.T) {
	off := deviceService(t, fakeDeviceBanner+"exec sleep 30", false)
	steps := []struct {
		handler func(http.ResponseWriter, *http.Request)
		method  string
	}{
		{off.HandleDeviceLoginStart, http.MethodPost},
		{off.HandleDeviceLoginStatus, http.MethodGet},
		{off.HandleDeviceLoginCancel, http.MethodPost},
	}
	for _, step := range steps {
		if rec := deviceCall(t, off, step.handler, step.method, agentMuse); rec.Code != http.StatusNotFound {
			t.Errorf("disabled %s = %d, want 404", step.method, rec.Code)
		}
	}
	on := deviceService(t, fakeDeviceBanner+"exec sleep 30", true)
	if rec := deviceCall(t, on, on.HandleDeviceLoginStart, http.MethodPost, agentCodex); rec.Code != http.StatusNotFound {
		t.Errorf("codex start = %d, want 404", rec.Code)
	}
	if rec := deviceCall(t, on, on.HandleDeviceLoginStatus, http.MethodGet, "vaporised"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown agent status = %d, want 404", rec.Code)
	}
}

// The device routes are on the air as long as one agent answers the port — and off it where none
// does, rather than serving endpoints that cannot work.
func TestDeviceLoginRoutesFollowThePort(t *testing.T) {
	patterns := mountedPatterns(deviceService(t, fakeDeviceBanner+"exec sleep 30", true))
	for _, pattern := range []string{
		"POST /hybridflow-runner/auth/{agent}/login/start",
		"GET /hybridflow-runner/auth/{agent}/login/status",
		"POST /hybridflow-runner/auth/{agent}/login/cancel",
	} {
		if !patterns[pattern] {
			t.Errorf("%q is not mounted where Muse answers the port", pattern)
		}
	}
	srv := newSocketTestServer(t, nil)
	srv.hub.agents.set(agentMuse, refusingAgent())
	if patterns := mountedPatterns(srv); patterns["POST /hybridflow-runner/auth/{agent}/login/start"] {
		t.Error("the device routes are mounted where no agent answers the port")
	}
}
