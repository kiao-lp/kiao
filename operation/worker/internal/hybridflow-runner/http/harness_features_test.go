package runnerhttp

import (
	"encoding/json"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Recording every optional port catches probes and credential changes before they
// reach a CLI, rather than merely checking that their results are hidden.
type featureHarness struct {
	stubHarness
	calls int
}

func (a *featureHarness) Options() harnessapi.HarnessOptionsDto {
	a.calls++
	return harnessapi.HarnessOptionsDto{}
}

func (a *featureHarness) Usage() (harnessapi.HarnessUsageDto, error) {
	a.calls++
	return harnessapi.HarnessUsageDto{}, nil
}

func (a *featureHarness) RefreshUsage() (harnessapi.HarnessUsageDto, error) { return a.Usage() }

func (a *featureHarness) LoginEnabled() bool { return true }

func (a *featureHarness) AuthStatus() (harnessapi.HarnessAuthStatusDto, error) {
	a.calls++
	return harnessapi.HarnessAuthStatusDto{}, nil
}

func (a *featureHarness) LoginStart() (string, error) {
	a.calls++
	return "https://example.com/login", nil
}

func (a *featureHarness) LoginCode(string) (bool, string, error) {
	a.calls++
	return true, "", nil
}

func (a *featureHarness) LoginCancel() bool { a.calls++; return true }

func (a *featureHarness) LoginShutdown() {}

func (a *featureHarness) APIKeyLoginEnabled() bool { return true }

func (a *featureHarness) APIKeyHostCommand() string { return "harness login" }

func (a *featureHarness) SubmitAPIKey(string) (bool, string, error) {
	a.calls++
	return true, "", nil
}

func (a *featureHarness) DeviceLoginEnabled() bool { return true }

func (a *featureHarness) DeviceLoginHostCommand() string { return "harness login" }

func (a *featureHarness) DeviceLoginStart() (string, string, error) {
	a.calls++
	return "https://example.com/login", "code", nil
}

func (a *featureHarness) DeviceLoginStatus() (bool, bool, string, error) {
	a.calls++
	return false, true, "", nil
}

func (a *featureHarness) DeviceLoginCancel() bool { a.calls++; return true }

func (a *featureHarness) DeviceLoginShutdown() {}

func TestDisabledHarnessesExposeNoFeatures(t *testing.T) {
	for _, name := range []string{harnessapi.HarnessClaude, harnessapi.HarnessCodex, harnessapi.HarnessMuse, harnessapi.HarnessOpenCode} {
		for _, source := range []string{"configuration", "deployment"} {
			t.Run(name+"/"+source, func(t *testing.T) {
				svc, _ := newConversationTestServer(t)
				harness := &featureHarness{}
				registry := &harnessapi.HarnessRegistry{Entries: []harnessapi.HarnessEntry{{Name: name, Label: name, Harness: harness, Allowed: true}}}
				enabled := true
				registry.Gate = gateFunc(func(string) bool { return enabled })
				svc.bindHarnesses(registry)
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
					{http.MethodGet, "/usage?harness=" + name},
					{http.MethodGet, "/auth/status?harness=" + name},
					{http.MethodGet, "/usage"},
					{http.MethodPost, "/auth/" + name + "/key"},
					{http.MethodPost, "/auth/" + name + "/login/start"},
					{http.MethodGet, "/auth/" + name + "/login/status"},
					{http.MethodPost, "/auth/" + name + "/login/cancel"},
				}
				if name == harnessapi.HarnessClaude {
					requests = append(requests, []struct{ method, path string }{
						{http.MethodGet, "/auth/status"},
						{http.MethodPost, "/auth/login/start"},
						{http.MethodPost, "/auth/login/code"},
						{http.MethodPost, "/auth/login/cancel"},
					}...)
				}
				for _, on := range []bool{false, true} {
					setEnabled(on)
					harness.calls = 0
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
					if !on && (harness.calls != 0 || registry.UsageFor(name) != nil) {
						t.Errorf("disabled harness was accessed: %d calls", harness.calls)
					}
					if on && harness.calls == 0 {
						t.Error("enabled harness was never accessed")
					}
				}
				setEnabled(false)
				harness.calls = 0
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/options", nil))
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(rec.Body.Bytes(), &fields); err != nil {
					t.Fatal(err)
				}
				if string(fields["harnesses"]) != "[]" {
					t.Errorf("harnesses = %s, want an explicit empty array so the client cannot infer Claude", fields["harnesses"])
				}
				if harness.calls != 0 {
					t.Error("options queried the disabled harness")
				}
			})
		}
	}
}

func TestDefaultUsageSkipsDisabledClaude(t *testing.T) {
	svc := usageServiceFor(t, oneWindow(11), oneWindow(77))
	svc.harnesses.Gate = gateFunc(func(name string) bool { return name != harnessapi.HarnessClaude })
	rec := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/usage", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if windows := readWindows(t, rec); len(windows) != 1 || windows[0].PercentUsed != 77 {
		t.Errorf("usage = %+v, want the enabled default harness's account", windows)
	}
}
