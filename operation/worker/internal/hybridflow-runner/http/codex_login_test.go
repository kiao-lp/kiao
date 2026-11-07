package runnerhttp

import (
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	codexcli "kiao/worker/internal/hybridflow-runner/agents/codex"
	pkgLogin "kiao/worker/internal/hybridflow-runner/agents/login"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// No real credentials or model calls: this CLI stores its state beside the script.
const fakeCodexLogin = `#!/bin/sh
case "$*" in
  'login status')
    if [ -f "$0.broken" ]; then echo 'configuration failed' >&2; exit 2; fi
    if [ -f "$0.auth" ]; then echo 'Logged in using an API key - partial-secret' >&2; exit 0; fi
    echo 'Not logged in' >&2; exit 1 ;;
  'login --device-auth')
    printf '1. Open this link in your browser and sign in to your account\n   \033[36mhttps://auth.openai.com/codex/device\033[0m\n\n'
    printf '2. Enter this one-time code (expires in 15 minutes)\n   \033[1mABCD-EFGHI\033[0m\n'
    while [ ! -f "$0.approve" ]; do sleep 0.05; done
    touch "$0.auth"
    echo 'Successfully logged in' ;;
  'login --with-api-key')
    key=$(cat)
    if [ "$key" != 'good-key' ]; then echo "refused: $key" >&2; exit 1; fi
    touch "$0.auth"
    echo 'Successfully logged in' ;;
  *) echo 'unexpected command' >&2; exit 2 ;;
esac
`

func codexLoginFixture(t *testing.T, enabled bool) (*codexcli.CodexLoginService, *Service) {
	t.Helper()
	t.Setenv("CODEX_API_KEY", "")
	login := codexcli.NewCodexLoginService(&runnerconfig.Config{CodexLoginEnabled: enabled})
	login.Binary = filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(login.Binary, []byte(fakeCodexLogin), 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(login.ShutdownDevice)
	srv := &Service{agents: &agentapi.AgentRegistry{Entries: []agentapi.AgentEntry{{
		Name: agentapi.AgentCodex, Label: "Codex", Allowed: true, Agent: &codexcli.CodexAgent{Login: login},
	}}}}
	return login, srv
}

func codexAuthRequest(srv *Service) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	srv.HandleAuthStatus(rec, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/auth/status?agent=codex", nil))
	return rec
}

func TestCodexAuthStatus(t *testing.T) {
	login, srv := codexLoginFixture(t, false)
	for _, signedIn := range []bool{false, true} {
		if signedIn {
			if err := os.WriteFile(login.Binary+".auth", nil, 0600); err != nil {
				t.Fatal(err)
			}
		}
		rec := codexAuthRequest(srv)
		var status agentapi.AgentAuthStatusDto
		if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusOK || status.LoggedIn != signedIn || status.LoginEnabled {
			t.Fatalf("signedIn=%v: status=%d body=%s", signedIn, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "secret") {
			t.Fatal("credential details escaped the status check")
		}
	}
	if err := os.WriteFile(login.Binary+".broken", nil, 0600); err != nil {
		t.Fatal(err)
	}
	if rec := codexAuthRequest(srv); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("broken CLI reported as signed out: %d %s", rec.Code, rec.Body.String())
	}
	srv.agents.Entries[0].Allowed = false
	if rec := codexAuthRequest(srv); rec.Code != http.StatusNotFound {
		t.Fatalf("disabled agent status=%d", rec.Code)
	}
}

func TestCodexAuthStatusWithExecAPIKey(t *testing.T) {
	login, _ := codexLoginFixture(t, false)
	t.Setenv("CODEX_API_KEY", "fake-key-for-exec")
	t.Setenv("OPENAI_FEDERATION_RULE_ID", "")
	t.Setenv("OPENAI_IDENTITY_TOKEN_FILE", "")
	if status, err := login.Status(); err != nil || !status.LoggedIn {
		t.Fatalf("exec's API key should not require a stored login: %+v %v", status, err)
	}
	// Incomplete WIF is still the CLI's decision, ahead of the API key.
	t.Setenv("OPENAI_FEDERATION_RULE_ID", "test-rule")
	if status, _ := login.Status(); status.LoggedIn {
		t.Fatal("exec API key overrode workload identity")
	}
}

func TestCodexDeviceLoginFlow(t *testing.T) {
	login, srv := codexLoginFixture(t, true)
	rec := deviceCall(t, srv, srv.HandleDeviceLoginStart, http.MethodPost, agentapi.AgentCodex)
	var result agentapi.AgentLoginDto
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !result.Ok || result.URL != "https://auth.openai.com/codex/device" || result.UserCode != "ABCD-EFGHI" {
		t.Fatalf("start: %d %+v", rec.Code, result)
	}
	if pending, _, _, err := login.DeviceStatus(); err != nil || !pending {
		t.Fatalf("not waiting for approval: pending=%v err=%v", pending, err)
	}
	if err := os.WriteFile(login.Binary+".approve", nil, 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		pending, ok, message, err := login.DeviceStatus()
		if !pending {
			if err != nil || !ok || message != "Signed in." {
				t.Fatalf("approval: ok=%v message=%q err=%v", ok, message, err)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("approval never completed")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if status, err := login.Status(); err != nil || !status.LoggedIn {
		t.Fatalf("status after approval: %+v %v", status, err)
	}
	if _, _, _, err := login.DeviceStatus(); err != pkgLogin.ErrNoLoginInFlight {
		t.Fatalf("finished status not consumed: %v", err)
	}
}

func TestCodexDeviceLoginCancelAndDisabled(t *testing.T) {
	login, srv := codexLoginFixture(t, true)
	if _, _, err := login.StartDevice(); err != nil {
		t.Fatal(err)
	}
	session := login.Session
	deviceCall(t, srv, srv.HandleDeviceLoginCancel, http.MethodPost, agentapi.AgentCodex)
	select {
	case <-session.Done:
	case <-time.After(3 * time.Second):
		t.Fatal("cancel left the CLI or its child running")
	}
	login.Enabled = false
	if rec := deviceCall(t, srv, srv.HandleDeviceLoginStart, http.MethodPost, agentapi.AgentCodex); rec.Code != http.StatusNotFound {
		t.Fatalf("disabled start: %d", rec.Code)
	}
	if rec := postAPIKey(t, srv, agentapi.AgentCodex, `{"key":"good-key"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("disabled key: %d", rec.Code)
	}
}

func TestCodexAPIKeyLogin(t *testing.T) {
	login, srv := codexLoginFixture(t, true)
	for _, key := range []string{"bad-secret-key", "good-key"} {
		rec := postAPIKey(t, srv, agentapi.AgentCodex, `{"key":"`+key+`"}`)
		var result agentapi.AgentLoginDto
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusOK || result.Ok != (key == "good-key") {
			t.Fatalf("key result: %d %+v", rec.Code, result)
		}
		if strings.Contains(result.Message, key) {
			t.Fatal("the API key was echoed")
		}
	}
	if status, err := login.Status(); err != nil || !status.LoggedIn {
		t.Fatalf("status after key: %+v %v", status, err)
	}
}

func TestCodexDevicePagePartialReads(t *testing.T) {
	full := "https://auth.openai.com/codex/device\n\nEnter this one-time code\n\x1b[1mABCD-EFGHI\x1b[0m\n"
	for i := 0; i < len(full); i++ {
		if _, ok := codexcli.FindCodexDevicePage(full[:i]); ok {
			t.Fatalf("published a partial page at byte %d", i)
		}
	}
	if page, ok := codexcli.FindCodexDevicePage(full); !ok || page.UserCode != "ABCD-EFGHI" {
		t.Fatalf("complete page: %+v %v", page, ok)
	}
}

func TestCodexAdvertisesLogin(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		agent := codexcli.NewCodexAgent(&runnerconfig.Config{CodexLoginEnabled: enabled})
		offer := agentapi.LoginOfferFor(agent)
		if offer == nil || offer.Enabled != enabled || strings.Join(offer.Methods, ",") != "device,api-key" || offer.HostCommand != "codex login --device-auth" {
			t.Fatalf("offer=%+v", offer)
		}
	}
}
