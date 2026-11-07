package runnerhttp

import (
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	picli "kiao/worker/internal/hybridflow-runner/agents/pi"
	"kiao/worker/internal/hybridflow-runner/assembly"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiSecretsManageStoredKeysAndInvalidateModels(t *testing.T) {
	cfg, profiles, store, _ := piTestSetup(t, "")
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	service := &Service{cfg: cfg, hub: hub, conversations: store}
	service.bindAgents(hub.Agents)
	profiles = service.agents.Profiles.(*picli.PiProfiles)
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].SecretRef = "private:account"
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		return do(service, httptest.NewRequest(method, "/hybridflow-runner/profile-secrets"+path, strings.NewReader(body)))
	}
	list := request(http.MethodGet, "", "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"secrets":[]`) {
		t.Fatalf("empty list: %d %s", list.Code, list.Body)
	}
	profiles.Cache["old"] = []agentapi.PiModelOffer{}
	put := request(http.MethodPut, "/account", `{"value":"  fixture-api-key-1234  "}`)
	if put.Code != http.StatusOK || len(profiles.Cache) != 0 {
		t.Fatalf("store key: %d %s, cache = %v", put.Code, put.Body, profiles.Cache)
	}
	info, err := os.Stat(filepath.Join(cfg.StatePath, "agent-secrets", "account"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("key permissions: %v %v", info, err)
	}
	list = request(http.MethodGet, "", "")
	var keys struct {
		Secrets []agentapi.PiSecretOffer `json:"secrets"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &keys); err != nil || len(keys.Secrets) != 1 {
		t.Fatalf("list key: %d %s", list.Code, list.Body)
	}
	key := keys.Secrets[0]
	if key.Reference != "private:account" || key.Preview != "••••••••1234" || len(key.UsedBy) != 1 || key.UsedBy[0].ProfileID != "work" {
		t.Fatalf("key metadata = %+v", key)
	}
	if strings.Contains(list.Body.String(), "fixture-api-key") || list.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("list exposes or caches keys: %s", list.Body)
	}
	reveal := request(http.MethodGet, "/account", "")
	if reveal.Code != http.StatusOK || !strings.Contains(reveal.Body.String(), `"value":"fixture-api-key-1234"`) || reveal.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("explicit reveal: %d %s", reveal.Code, reveal.Body)
	}
	if _, err := profiles.Models("work", true); err != nil {
		t.Fatal(err)
	}
	if len(profiles.Cache) == 0 {
		t.Fatal("model query did not populate cache")
	}
	removed := request(http.MethodDelete, "/account", "")
	if removed.Code != http.StatusNoContent || len(profiles.Cache) != 0 {
		t.Fatalf("delete key: %d %s, cache = %v", removed.Code, removed.Body, profiles.Cache)
	}
	if _, exists := profiles.Secret("private:account"); exists {
		t.Fatal("deleted key still available")
	}
	if profiles.OfferedProfiles()[0].Status != "auth_required" {
		t.Fatal("missing key did not change profile status")
	}
	if _, err := profiles.Models("work", false); err == nil || !strings.Contains(err.Error(), "API key private:account") {
		t.Fatalf("missing-key diagnostic = %v", err)
	}
	if got := request(http.MethodGet, "/account", ""); got.Code != http.StatusNotFound {
		t.Fatalf("reveal after delete: %d", got.Code)
	}
	if got := request(http.MethodDelete, "/account", ""); got.Code != http.StatusNoContent {
		t.Fatalf("repeated delete: %d", got.Code)
	}
}

func TestPiSecretHandlersRejectInvalidReferences(t *testing.T) {
	cfg, _, store, _ := piTestSetup(t, "")
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	service := &Service{cfg: cfg, hub: hub, conversations: store}
	service.bindAgents(hub.Agents)
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		r := httptest.NewRequest(method, "/hybridflow-runner/profile-secrets/bad", strings.NewReader(`{"value":"key"}`))
		r.SetPathValue("id", "../outside")
		w := httptest.NewRecorder()
		service.HandlePiSecret(w, r)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s invalid id: %d", method, w.Code)
		}
	}
}

func TestPiDiagnosticExplainsAnEmptyModelList(t *testing.T) {
	cfg, profiles, store, _ := piTestSetup(t, "")
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].Models = []agentapi.PiModel{}
	doc.Profiles[0].DefaultModel = ""
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	service := &Service{cfg: cfg, hub: hub, conversations: store}
	service.bindAgents(hub.Agents)
	w := do(service, httptest.NewRequest(http.MethodPost, "/hybridflow-runner/profiles/work/diagnostic", nil))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "Add a model ID") {
		t.Fatalf("empty diagnostic: %d %s", w.Code, w.Body)
	}
}
