package runnerhttp

import (
	"encoding/json"
	"kiao/worker/internal/core/access"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	picli "kiao/worker/internal/hybridflow-runner/agents/pi"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"kiao/worker/internal/hybridflow-runner/assembly"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPiConversationHTTPRequiresProfileAndForksAcrossProfiles(t *testing.T) {
	cfg, profiles, store, original := piTestSetup(t, "")
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	service := &Service{cfg: cfg, hub: hub, conversations: store, liveness: hub.IsRunning}
	service.bindAgents(hub.Agents)
	doc, _ := profiles.ReadProfiles()
	doc.DefaultPiProfileID = ""
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	refused := do(service, httptest.NewRequest(http.MethodPost, "/hybridflow-runner/conversations", strings.NewReader(`{"agent":"pi","folder":"","model":"openai/shared-model"}`)))
	if refused.Code != http.StatusBadRequest {
		t.Fatalf("implicit profile = %d %s", refused.Code, refused.Body.String())
	}
	created := do(service, httptest.NewRequest(http.MethodPost, "/hybridflow-runner/conversations", strings.NewReader(`{"agent":"pi","profileId":"work","folder":"","permissionMode":"manual"}`)))
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"profileId":"work"`) {
		t.Fatalf("profile creation = %d %s", created.Code, created.Body.String())
	}
	patch := do(service, httptest.NewRequest(http.MethodPatch, "/hybridflow-runner/conversations/"+original.ID, strings.NewReader(`{"profileId":"other"}`)))
	if patch.Code != http.StatusBadRequest {
		t.Fatal("profile changed in place")
	}
	doc.Profiles = append(doc.Profiles, agentapi.PiProfile{ID: "other", Name: "Other API", InstallationID: "reference", DefaultModel: "deepseek/shared-model", Connections: []agentapi.PiConnection{{Provider: "deepseek", API: "openai-completions", BaseURL: "http://127.0.0.2/v1", Models: []agentapi.PiModel{{ID: "shared-model"}}}}})
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	_, err := store.AppendAndUpdate(original.ID, pkgConversations.ConversationRecord{Role: pkgConversations.RoleUser, Text: "Previous question"}, func(meta *pkgConversations.ConversationMeta) {
		meta.SessionID = filepath.Join(cfg.StatePath, pkgConversations.ConversationsDirName, original.ID, "pi", "native.jsonl")
	})
	if err != nil {
		t.Fatal(err)
	}
	result := do(service, httptest.NewRequest(http.MethodPost, "/hybridflow-runner/conversations/"+original.ID+"/fork", strings.NewReader(`{"profileId":"other"}`)))
	if result.Code != http.StatusCreated {
		t.Fatal(result.Body.String())
	}
	var fork pkgConversations.AgentConversationDto
	if json.Unmarshal(result.Body.Bytes(), &fork) != nil {
		t.Fatal("invalid fork response")
	}
	if fork.ProfileID != "other" || fork.SessionID != "" || fork.Model != "deepseek/shared-model" {
		t.Fatalf("profile/session crossover: %+v", fork)
	}
	meta, _ := store.Get(fork.ID)
	if !meta.ContextPending {
		t.Fatal("cross-profile fork lost transcript context")
	}
	if !strings.Contains(hub.ForkTranscriptContext(fork.ID), "Previous question") {
		t.Fatal("transcript context missing")
	}
}

func TestPiHubStopWaitsForCleanupAndPersistsQueue(t *testing.T) {
	cfg, _, store, meta := piTestSetup(t, "")
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	job, refused := hub.StartTurnFor(nil, access.Identity{}, pkgTurns.TurnRequest{ConversationID: meta.ID, Prompt: "slow", Model: meta.Model, Effort: "off"})
	if refused != nil {
		t.Fatal(refused)
	}
	deadline := time.After(10 * time.Second)
	for {
		job.Mu.Lock()
		driver := job.Driver
		job.Mu.Unlock()
		if driver != nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("no driver")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if !hub.StopProcess(meta.ID, "test") {
		t.Fatal("stop refused")
	}
	select {
	case <-job.Settled:
		select {
		case <-job.Driver.(*picli.PiDriver).Rpc.Process.Done:
		default:
			t.Fatal("turn settled before driver cleanup")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("stop did not settle")
	}
	records := mustMessages(t, store, meta.ID)
	last := records[len(records)-1]
	if !last.Interrupted || last.Execution == nil || last.Execution.ProfileID != "work" {
		t.Fatalf("missing turn resolution: %+v", last)
	}
}

func TestPiQueueSurvivesAWorkerRestartAsCancelled(t *testing.T) {
	cfg, _, store, meta := piTestSetup(t, "")
	_, err := store.Update(meta.ID, func(m *pkgConversations.ConversationMeta) {
		m.RunningAt = protocol.NowConversationTime()
		m.RunningTurn = "turn-pending"
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveQueue(meta.ID, "turn-pending", []agentapi.AgentQueuedMessage{{ID: "queued-1", Text: "Do this later", State: "pending"}, {ID: "queued-2", Text: "Already delivered", State: "delivered"}}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := pkgConversations.NewConversationStore(filepath.Join(cfg.StatePath, pkgConversations.ConversationsDirName))
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.SweepInterrupted() != 1 {
		t.Fatal("running turn was not recovered")
	}
	records := mustMessages(t, reloaded, meta.ID)
	queue := records[len(records)-1].Queue
	if len(queue) != 2 || queue[0].State != "cancelled" || queue[0].Text != "Do this later" || queue[1].State != "delivered" {
		t.Fatalf("recovered queue = %+v", queue)
	}
}

func TestPiImageRefusalPreservesTheConversation(t *testing.T) {
	cfg, profiles, store, meta := piTestSetup(t, "")
	doc, _ := profiles.ReadProfiles()
	doc.Profiles[0].Connections[0].Models[0].Input = []string{"text"}
	if err := profiles.WriteProfiles(doc); err != nil {
		t.Fatal(err)
	}
	hub := assembly.NewEngine(cfg, store)
	defer hub.Shutdown()
	image := filepath.Join(t.TempDir(), "image.png")
	mustWrite(t, image, "unused")
	job, refusal := hub.StartTurnFor(nil, access.Identity{}, pkgTurns.TurnRequest{ConversationID: meta.ID, Prompt: "describe", Images: []agentapi.PromptFile{{Path: image, MediaType: "image/png"}}})
	if job != nil || refusal == nil || refusal.Code != turnevents.ErrCodeBadAttachment {
		t.Fatalf("image started an unsupported turn: %+v %+v", job, refusal)
	}
	records := mustMessages(t, store, meta.ID)
	if len(records) != 0 {
		t.Fatal("a refused image changed the native conversation")
	}
}
