package runnerhttp

import (
	"encoding/json"
	coreconfig "kiao/worker/internal/core/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestHarnessModelPreferencesPersistAndSetConversationDefault(t *testing.T) {
	svc, cfg := newConversationTestServer(t)
	svc.harnesses.Set(harnessapi.HarnessClaude, &claudecli.ClaudeHarness{OptionsService: &claudecli.ClaudeOptionsService{
		BypassEnabled: true, Help: func() (string, error) { return wrappedHelpExcerpt, nil },
	}})
	path := "/hybridflow-runner/harness-models/claude"
	initial := do(svc, jsonReq(http.MethodGet, path, ""))
	var configuration harnessapi.ModelConfiguration
	if err := json.Unmarshal(initial.Body.Bytes(), &configuration); initial.Code != http.StatusOK || err != nil {
		t.Fatalf("read model configuration: %d %s", initial.Code, initial.Body.String())
	}
	if configuration.DefaultModel != "opus" || !slices.Equal(configuration.ActiveModels, []string{"opus", "sonnet", "haiku"}) {
		t.Fatalf("initial models = %+v", configuration.ModelPreferences)
	}
	if !harnessapi.HasHarnessOption(configuration.Models, "fable") {
		t.Fatal("the configuration omits an inactive catalogue model")
	}

	for _, body := range []string{
		`{"activeModels":["haiku"],"defaultModel":"sonnet"}`,
		`{"activeModels":["unknown"],"defaultModel":"unknown"}`,
		`{"activeModels":["sonnet","sonnet"],"defaultModel":"sonnet"}`,
	} {
		if response := do(svc, jsonReq(http.MethodPut, path, body)); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid preferences: %d %s", response.Code, response.Body.String())
		}
	}
	response := do(svc, jsonReq(http.MethodPut, path, `{"activeModels":["sonnet","haiku"],"defaultModel":"sonnet"}`))
	if response.Code != http.StatusNoContent {
		t.Fatalf("save model preferences: %d %s", response.Code, response.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(cfg.DCMSRoot, coreconfig.StateDirName, "harness-models", "claude.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved harnessapi.ModelPreferences
	if err := json.Unmarshal(data, &saved); err != nil || saved.DefaultModel != "sonnet" || !slices.Equal(saved.ActiveModels, []string{"sonnet", "haiku"}) {
		t.Fatalf("saved models = %+v (%v)", saved, err)
	}
	options := do(svc, jsonReq(http.MethodGet, "/hybridflow-runner/options", ""))
	var offered harnessapi.HarnessOptionsDto
	if err := json.Unmarshal(options.Body.Bytes(), &offered); err != nil || offered.DefaultModel != saved.DefaultModel ||
		len(offered.Harnesses) == 0 || !slices.Equal(offered.Harnesses[0].ActiveModels, saved.ActiveModels) {
		t.Fatalf("offered options = %s (%v)", options.Body.String(), err)
	}
	created := mustCreateThroughHandlers(t, svc, `{"agentId":"claude-agent"}`)
	if created.Model != saved.DefaultModel {
		t.Fatalf("conversation model = %q, want %q", created.Model, saved.DefaultModel)
	}
	fork := do(svc, jsonReq(http.MethodPost, "/hybridflow-runner/conversations/"+created.ID+"/fork", `{"harness":"claude","model":"haiku"}`))
	var selected pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(fork.Body.Bytes(), &selected); fork.Code != http.StatusCreated || err != nil ||
		selected.Model != "haiku" || selected.AgentVersion == nil || selected.AgentVersion.ResolvedModel != "haiku" {
		t.Fatalf("fork with selected model: %d %s", fork.Code, fork.Body.String())
	}
	unknown := do(svc, jsonReq(http.MethodPost, "/hybridflow-runner/conversations", `{"agentId":"claude-agent","model":"unknown"}`))
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("create on an unknown model: %d %s", unknown.Code, unknown.Body.String())
	}
}
