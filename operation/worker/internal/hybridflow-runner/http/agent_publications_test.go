package runnerhttp

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/access"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"kiao/worker/internal/hybridflow-runner/playback"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskConversationsSelectLatestPublicationAndKeepItAcrossRestart(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Review","body":"Review the code.","settings":{"agent":"reviewer",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	first := &pkgBoards.ManagedAgentVersion{AgentID: "reviewer", Version: 1, Name: "Reviewer", Platform: "claude",
		Model: "opus", Instructions: "Published instructions.", PublishedAt: "2026-10-20T12:00:00Z"}
	current := &pkgBoards.ManagedAgent{Name: "Draft name", Platform: "codex", Model: "draft-model", Instructions: "Draft instructions.", Published: first}
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{"reviewer": current}}
	rt.play("flow-node-1")
	rt.waitIdle()
	chat := rt.board().FlowNode("flow-node-1").Chat
	meta, err := rt.convs.Get(chat)
	if err != nil || meta.AgentVersion == nil || meta.AgentVersion.Version != 1 || meta.Model != "opus" || meta.Agent != "claude" {
		t.Fatalf("first conversation = %+v, %v", meta, err)
	}
	records, err := rt.convs.Messages(chat)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.Role == pkgConversations.RoleUser || record.Role == pkgConversations.RoleAssistant {
			if record.AgentVersion != 1 || record.AgentRef != "reviewer" || record.PlayedBy != "Reviewer" {
				t.Fatalf("missing publication provenance = %+v", record)
			}
		}
		if record.Role == pkgConversations.RoleUser && record.Instructions != first.Instructions {
			t.Fatalf("prompt instructions = %q", record.Instructions)
		}
	}
	second := *first
	second.Version, second.Model, second.Instructions = 2, "sonnet", "Second publication."
	current.Published = &second
	if _, err := rt.boards.Chat(rt.handle, "flow-node-1", ""); err != nil {
		t.Fatal(err)
	}
	rt.play("flow-node-1")
	rt.waitIdle()
	newChat := rt.board().FlowNode("flow-node-1").Chat
	latest, err := rt.convs.Get(newChat)
	if err != nil || newChat == chat || latest.AgentVersion == nil || latest.AgentVersion.Version != 2 || latest.Model != "sonnet" {
		t.Fatalf("new conversation = %+v, %v", latest, err)
	}
	reloaded, err := pkgConversations.NewConversationStore(rt.convs.Dir)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := reloaded.Get(chat)
	if err != nil || stored.AgentVersion == nil || stored.AgentVersion.Version != first.Version ||
		stored.AgentVersion.Instructions != first.Instructions || stored.AgentVersion.ResolvedModel != "opus" {
		t.Fatalf("reloaded configuration = %+v, %v", stored, err)
	}
	rt.runner.Agents = stubAgents{err: errors.New("store unavailable")}
	resolved, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{Chat: chat})
	if err != nil || resolved.Model != "opus" || resolved.Instructions != first.Instructions {
		t.Fatalf("historical configuration depends on the catalogue: %+v, %v", resolved, err)
	}
}

func TestManualTurnsUseTheCapturedAgentConfiguration(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	agent := &stubAgent{}
	srv.hub.Agents.Set(agentapi.AgentClaude, agent)
	version := &pkgBoards.ManagedAgentVersion{AgentID: "reviewer", Version: 3, Name: "Reviewer", Platform: "claude",
		Model: "", ResolvedModel: "retired-model", Instructions: "Published instructions."}
	conversation, err := store.Create(pkgConversations.ConversationMeta{Agent: "claude", Model: "retired-model", AgentVersion: version})
	if err != nil {
		t.Fatal(err)
	}
	job, refusal := srv.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: conversation.ID, Prompt: "Continue the task.", Model: "other-model",
		Instructions: "Other orders.", PermissionMode: runnerconfig.PermissionModeBypass,
	})
	if refusal != nil {
		t.Fatalf("manual turn refused: %+v", refusal)
	}
	driver := agent.waitForDriver(t)
	driver.mu.Lock()
	run := driver.run
	driver.mu.Unlock()
	if run.Model != "retired-model" || run.Instructions != version.Instructions {
		t.Fatalf("turn configuration = %+v", run)
	}
	driver.text("done")
	driver.finish(0)
	<-job.Settled
	for _, record := range mustMessages(t, store, conversation.ID) {
		if record.AgentVersion != 3 || record.AgentRef != "reviewer" || record.PlayedBy != "Reviewer" {
			t.Fatalf("manual turn lost its provenance = %+v", record)
		}
	}
}

func TestPublishedConversationRefusesModelPatchAndForksOntoLatestPublication(t *testing.T) {
	service, _ := newConversationTestServer(t)
	service.agents.Set(agentapi.AgentClaude, &stubAgent{})
	first := &pkgBoards.ManagedAgentVersion{AgentID: "reviewer", Version: 1, Name: "Reviewer", Platform: "claude", Model: "opus"}
	source, err := service.conversations.Create(pkgConversations.ConversationMeta{
		Agent: "claude", Model: "opus", Effort: "high", PermissionMode: runnerconfig.PermissionModeBypass, AgentVersion: first,
	})
	if err != nil {
		t.Fatal(err)
	}
	second := *first
	second.Version, second.Model = 2, "sonnet"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(pkgBoards.ManagedAgent{Name: "Reviewer", Published: &second})
	}))
	defer server.Close()
	service.boardsUpstream = pkgBoards.NewHybridflowStore(server.URL, "token")
	patch := do(service, jsonReq(http.MethodPatch, "/hybridflow-runner/conversations/"+source.ID, `{"model":"sonnet"}`))
	if patch.Code != http.StatusBadRequest {
		t.Fatalf("model patch = %d %s", patch.Code, patch.Body)
	}
	fork := do(service, jsonReq(http.MethodPost, "/hybridflow-runner/conversations/"+source.ID+"/fork", `{}`))
	if fork.Code != http.StatusCreated {
		t.Fatalf("fork = %d %s", fork.Code, fork.Body)
	}
	var made pkgConversations.AgentConversationDto
	if err := json.Unmarshal(fork.Body.Bytes(), &made); err != nil {
		t.Fatal(err)
	}
	if made.AgentVersion == nil || made.AgentVersion.Version != 2 || made.Model != "sonnet" {
		t.Fatalf("fork configuration = %+v", made)
	}
	stored, _ := service.conversations.Get(source.ID)
	if stored.AgentVersion.Version != 1 || stored.Model != "opus" {
		t.Fatal("fork changed its source")
	}
}

func TestNewTaskConversationsRefuseArchivedAndUnpublishedAgents(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{unpublished: true, byID: map[string]*pkgBoards.ManagedAgent{
		"draft":    {Name: "Draft", Platform: "claude"},
		"archived": {Name: "Archived", Platform: "claude", Archived: true},
	}}
	for id, want := range map[string]string{"draft": "no published version", "archived": "archived"} {
		if _, err := rt.runner.ResolveAgent(playback.FlowNodeWithAgent(id)); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%s resolution = %v", id, err)
		}
	}
}
