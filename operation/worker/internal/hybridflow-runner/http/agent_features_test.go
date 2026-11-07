package runnerhttp

import (
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Recording every optional port catches probes and credential changes before they
// reach a CLI, rather than merely checking that their results are hidden.
type featureAgent struct {
	stubAgent
	calls int
}

func (a *featureAgent) Options() agentapi.AgentOptionsDto {
	a.calls++
	return agentapi.AgentOptionsDto{}
}

func (a *featureAgent) Usage() (agentapi.AgentUsageDto, error) {
	a.calls++
	return agentapi.AgentUsageDto{}, nil
}

func (a *featureAgent) RefreshUsage() (agentapi.AgentUsageDto, error) { return a.Usage() }

func (a *featureAgent) LoginEnabled() bool { return true }

func (a *featureAgent) AuthStatus() (agentapi.AgentAuthStatusDto, error) {
	a.calls++
	return agentapi.AgentAuthStatusDto{}, nil
}

func (a *featureAgent) LoginStart() (string, error) {
	a.calls++
	return "https://example.com/login", nil
}

func (a *featureAgent) LoginCode(string) (bool, string, error) {
	a.calls++
	return true, "", nil
}

func (a *featureAgent) LoginCancel() bool { a.calls++; return true }

func (a *featureAgent) LoginShutdown() {}

func (a *featureAgent) APIKeyLoginEnabled() bool { return true }

func (a *featureAgent) APIKeyHostCommand() string { return "agent login" }

func (a *featureAgent) SubmitAPIKey(string) (bool, string, error) {
	a.calls++
	return true, "", nil
}

func (a *featureAgent) DeviceLoginEnabled() bool { return true }

func (a *featureAgent) DeviceLoginHostCommand() string { return "agent login" }

func (a *featureAgent) DeviceLoginStart() (string, string, error) {
	a.calls++
	return "https://example.com/login", "code", nil
}

func (a *featureAgent) DeviceLoginStatus() (bool, bool, string, error) {
	a.calls++
	return false, true, "", nil
}

func (a *featureAgent) DeviceLoginCancel() bool { a.calls++; return true }

func (a *featureAgent) DeviceLoginShutdown() {}

func TestDisabledAgentsExposeNoFeatures(t *testing.T) {
	for _, name := range []string{agentapi.AgentClaude, agentapi.AgentCodex, agentapi.AgentMuse, agentapi.AgentOpenCode} {
		for _, source := range []string{"configuration", "deployment"} {
			t.Run(name+"/"+source, func(t *testing.T) {
				svc, _ := newConversationTestServer(t)
				agent := &featureAgent{}
				registry := &agentapi.AgentRegistry{Entries: []agentapi.AgentEntry{{Name: name, Label: name, Agent: agent, Allowed: true}}}
				enabled := true
				registry.Gate = gateFunc(func(string) bool { return enabled })
				svc.bindAgents(registry)
				// Mount once: switching off and back on must work without restarting.
				handler := svc.handler()
				setEnabled := func(on bool) {
					if source == "configuration" {
						enabled = on
					} else {
						registry.Entries[0].Allowed = on
					}
				}
				requests := []struct{ method, path string }{
					{http.MethodGet, "/usage?agent=" + name},
					{http.MethodGet, "/auth/status?agent=" + name},
					{http.MethodGet, "/usage"},
					{http.MethodPost, "/auth/" + name + "/key"},
					{http.MethodPost, "/auth/" + name + "/login/start"},
					{http.MethodGet, "/auth/" + name + "/login/status"},
					{http.MethodPost, "/auth/" + name + "/login/cancel"},
				}
				if name == agentapi.AgentClaude {
					requests = append(requests, []struct{ method, path string }{
						{http.MethodGet, "/auth/status"},
						{http.MethodPost, "/auth/login/start"},
						{http.MethodPost, "/auth/login/code"},
						{http.MethodPost, "/auth/login/cancel"},
					}...)
				}
				for _, on := range []bool{false, true} {
					setEnabled(on)
					agent.calls = 0
					for _, prefix := range append([]string{"/hybridflow-runner"}, legacyHTTPPrefixes...) {
						for _, req := range requests {
							rec := httptest.NewRecorder()
							handler.ServeHTTP(rec, httptest.NewRequest(req.method, prefix+req.path,
								strings.NewReader(`{"key":"test-key","code":"test-code"}`)))
							want := http.StatusNotFound
							if on {
								want = http.StatusOK
							}
							if rec.Code != want {
								t.Errorf("enabled=%v: %s %s%s = %d, want %d", on, req.method, prefix, req.path, rec.Code, want)
							}
						}
					}
					if !on && (agent.calls != 0 || registry.UsageFor(name) != nil) {
						t.Errorf("disabled agent was accessed: %d calls", agent.calls)
					}
					if on && agent.calls == 0 {
						t.Error("enabled agent was never accessed")
					}
				}
				setEnabled(false)
				agent.calls = 0
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/options", nil))
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(rec.Body.Bytes(), &fields); err != nil {
					t.Fatal(err)
				}
				if string(fields["agents"]) != "[]" {
					t.Errorf("agents = %s, want an explicit empty array so the client cannot infer Claude", fields["agents"])
				}
				if agent.calls != 0 {
					t.Error("options queried the disabled agent")
				}
			})
		}
	}
}

func TestDefaultUsageSkipsDisabledClaude(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), oneWindow(77))
	svc.agents.Gate = gateFunc(func(name string) bool { return name != agentapi.AgentClaude })
	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if windows := readWindows(t, rec); len(windows) != 1 || windows[0].PercentUsed != 77 {
		t.Errorf("usage = %+v, want the enabled default agent's account", windows)
	}
}
