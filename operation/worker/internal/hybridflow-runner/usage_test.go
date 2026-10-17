package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The quota is asked *per agent*, and answering the default agent's figures under a Codex chat is
// the bug this endpoint's `agent` parameter exists to close: two engines, two accounts, and nothing
// either spends comes out of the other.

// usageServiceFor is a service whose two agents report the windows a test names — or, for a nil
// snapshot, do not answer the quota port at all.
func usageServiceFor(t *testing.T, claude, codex *AgentUsageDto) *Service {
	t.Helper()
	convs, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, convs)
	set := func(name string, dto *AgentUsageDto) {
		if dto == nil {
			hub.agents.set(name, &stubAgent{})
			return
		}
		hub.agents.set(name, &usageAgent{dto: *dto})
	}
	set(agentClaude, claude)
	set(agentCodex, codex)
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.isRunning}
	svc.bindAgents(hub.agents)
	return svc
}

func oneWindow(percent int) *AgentUsageDto {
	return &AgentUsageDto{Windows: []agentWindow{
		{WindowMinutes: 300, PercentUsed: percent, ResetAtEpochSeconds: 1791148787}}}
}

// readWindows is the answer as the client reads it.
func readWindows(t *testing.T, rec *httptest.ResponseRecorder) []agentWindow {
	t.Helper()
	var dto AgentUsageDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("the answer could not be read: %v (%s)", err, rec.Body.String())
	}
	return dto.Windows
}

// Each agent answers about its own account, and the two do not cross.
func TestUsageAnswersAboutTheAgentAskedFor(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), oneWindow(77))

	for path, want := range map[string]int{
		"/hybridflow-runner/usage?agent=claude": 11,
		"/hybridflow-runner/usage?agent=codex":  77,
		// No agent at all is the default's, which is what this endpoint has always answered and what
		// a client written before there was more than one agent keeps getting.
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

// An agent with no quota to report is a 404 — "this service does not do that" — and so is a name this
// deployment has never heard of. Neither is a 503: nothing failed, and the panel shows the quota as
// unavailable rather than as a figure belonging to somebody else.
func TestUsageIsNotFoundForAnAgentWithNoAccountToReport(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), nil)

	for _, path := range []string{"/hybridflow-runner/usage?agent=codex", "/hybridflow-runner/usage?agent=nobody"} {
		if rec := do(svc, httptest.NewRequest(http.MethodGet, path, nil)); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}

// An agent that has a quota and could not be asked is a 503, which is the older half of this
// endpoint's contract: the CLI is signed out, or the probe timed out.
func TestUsageIsUnavailableWhenTheAccountCannotBeAsked(t *testing.T) {
	convs, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, convs)
	hub.agents.set(agentCodex, &usageAgent{err: errors.New("signed out")})
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.isRunning}
	svc.bindAgents(hub.agents)

	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?agent=codex", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("GET /hybridflow-runner/usage?agent=codex = %d, want 503", rec.Code)
	}
}

// refreshUsageAgent is an agent answering both quota ports: the cheap one and the refreshed one.
type refreshUsageAgent struct {
	usageAgent
	fresh AgentUsageDto
}

func (a *refreshUsageAgent) RefreshUsage() (AgentUsageDto, error) { return a.fresh, nil }

// The endpoint reads through the refresh port where one is answered: a read here is a person
// asking for fresh figures, worth what the refresh costs. The runner's own reads stay on the
// cheap port.
func TestUsagePrefersTheRefreshPort(t *testing.T) {
	convs, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, convs)
	hub.agents.set(agentMuse, &refreshUsageAgent{
		usageAgent: usageAgent{dto: *oneWindow(11)},
		fresh:      *oneWindow(77),
	})
	svc := &Service{cfg: cfg, hub: hub, conversations: convs, liveness: hub.isRunning}
	svc.bindAgents(hub.agents)

	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?agent=muse", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /hybridflow-runner/usage?agent=muse = %d, want 200", rec.Code)
	}
	windows := readWindows(t, rec)
	if len(windows) != 1 || windows[0].PercentUsed != 77 {
		t.Errorf("usage = %+v, want the refreshed account at 77%%", windows)
	}
}

// The route is mounted as long as *one* agent has an account to report. It answers per agent, and a
// silent engine is no reason to take the endpoint off the air for the other one.
func TestUsageStaysMountedWhileOneAgentHasAnAccount(t *testing.T) {
	svc := usageServiceFor(t, nil, oneWindow(5))
	if !svc.offersUsage() {
		t.Fatal("an agent with a quota must keep the endpoint mounted")
	}
	if rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage?agent=codex", nil)); rec.Code != http.StatusOK {
		t.Errorf("GET /hybridflow-runner/usage?agent=codex = %d, want 200", rec.Code)
	}
}
