package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/hybridflow-runner/assembly"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
	"net/http/httptest"
	"testing"
)

// usageServiceFor is a service whose two harnesses report the windows a test names — or, for a nil
// snapshot, do not answer the quota port at all.
func usageServiceFor(t *testing.T, claude, codex *harnessapi.HarnessUsageDto) *Service {
	t.Helper()
	convs, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, convs)
	set := func(name string, dto *harnessapi.HarnessUsageDto) {
		if dto == nil {
			hub.Harnesses.Set(name, &stubHarness{})
			return
		}
		hub.Harnesses.Set(name, &usageHarness{dto: *dto})
	}
	set(harnessapi.HarnessClaude, claude)
	set(harnessapi.HarnessCodex, codex)
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.IsRunning}
	svc.bindHarnesses(hub.Harnesses)
	return svc
}

func oneWindow(percent int) *harnessapi.HarnessUsageDto {
	return &harnessapi.HarnessUsageDto{Windows: []harnessapi.HarnessWindow{
		{WindowMinutes: 300, PercentUsed: percent, ResetAtEpochSeconds: 1791148787}}}
}

// readWindows is the answer as the client reads it.
func readWindows(t *testing.T, rec *httptest.ResponseRecorder) []harnessapi.HarnessWindow {
	t.Helper()
	var dto harnessapi.HarnessUsageDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("the answer could not be read: %v (%s)", err, rec.Body.String())
	}
	return dto.Windows
}

// Each harness answers about its own account, and the two do not cross.
func TestUsageAnswersAboutTheAgentAskedFor(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), oneWindow(77))

	for path, want := range map[string]int{
		"/hybridflow-runner/usage?harness=claude": 11,
		"/hybridflow-runner/usage?harness=codex":  77,
		// No harness at all is the default's, which is what this endpoint has always answered and what
		// a client written before there was more than one harness keeps getting.
		"/hybridflow-runner/usage": 11,
	} {
		rec := do(svc, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, rec.Code)
			continue
		}
		windows := readWindows(t, rec)
		if len(windows) != 1 || windows[0].PercentUsed != want {
			t.Errorf("GET %s = %+v, want the account at %d%%", path, windows, want)
		}
	}
}

// A harness with no quota to report is a 404 — "this service does not do that" — and so is a name this
// deployment has never heard of. Neither is a 503: nothing failed, and the panel shows the quota as
// unavailable rather than as a figure belonging to somebody else.
func TestUsageIsNotFoundForAnAgentWithNoAccountToReport(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), nil)

	for _, path := range []string{"/hybridflow-runner/usage?harness=codex", "/hybridflow-runner/usage?harness=nobody"} {
		if rec := do(svc, httptest.NewRequest(http.MethodGet, path, nil)); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}

// A harness that has a quota and could not be asked is a 503, which is the older half of this
// endpoint's contract: the CLI is signed out, or the probe timed out.
func TestUsageIsUnavailableWhenTheAccountCannotBeAsked(t *testing.T) {
	convs, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, convs)
	hub.Harnesses.Set(harnessapi.HarnessCodex, &usageHarness{err: errors.New("signed out")})
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.IsRunning}
	svc.bindHarnesses(hub.Harnesses)

	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?harness=codex", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("GET /hybridflow-runner/usage?harness=codex = %d, want 503", rec.Code)
	}
}

// refreshUsageHarness is a harness answering both quota ports: the cheap one and the refreshed one.
type refreshUsageHarness struct {
	usageHarness
	fresh harnessapi.HarnessUsageDto
}

func (a *refreshUsageHarness) RefreshUsage() (harnessapi.HarnessUsageDto, error) { return a.fresh, nil }

// The endpoint reads through the refresh port where one is answered: a read here is a person
// asking for fresh figures, worth what the refresh costs. The runner's own reads stay on the
// cheap port.
func TestUsagePrefersTheRefreshPort(t *testing.T) {
	convs, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, convs)
	hub.Harnesses.Set(harnessapi.HarnessMuse, &refreshUsageHarness{
		usageHarness: usageHarness{dto: *oneWindow(11)},
		fresh:        *oneWindow(77),
	})
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.IsRunning}
	svc.bindHarnesses(hub.Harnesses)

	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?harness=muse", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /hybridflow-runner/usage?harness=muse = %d, want 200", rec.Code)
	}
	windows := readWindows(t, rec)
	if len(windows) != 1 || windows[0].PercentUsed != 77 {
		t.Errorf("usage = %+v, want the refreshed account at 77%%", windows)
	}
}

// The route is mounted as long as *one* harness has an account to report. It answers per harness, and a
// silent engine is no reason to take the endpoint off the air for the other one.
func TestUsageStaysMountedWhileOneAgentHasAnAccount(t *testing.T) {
	svc := usageServiceFor(t, nil, oneWindow(5))
	if !svc.offersUsage() {
		t.Fatal("a harness with a quota must keep the endpoint mounted")
	}
	if rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?harness=codex", nil)); rec.Code != http.StatusOK {
		t.Errorf("GET /hybridflow-runner/usage?harness=codex = %d, want 200", rec.Code)
	}
}
