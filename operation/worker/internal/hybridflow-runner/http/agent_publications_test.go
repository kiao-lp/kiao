package runnerhttp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/equipment"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
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
	first := &pkgBoards.ManagedAgentVersion{AgentID: "reviewer", Version: "1.0.0", Name: "Reviewer", Harness: "claude",
		Model: "opus", Instructions: "Published instructions.", PublishedAt: "2026-10-20T12:00:00Z"}
	current := &pkgBoards.ManagedAgent{Name: "Draft name", Harness: "codex", Model: "draft-model", Instructions: "Draft instructions.", Published: first}
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{"reviewer": current}}
	rt.play("flow-node-1")
	rt.waitIdle()
	chat := rt.board().FlowNode("flow-node-1").Chat
	meta, err := rt.convs.Get(chat)
	if err != nil || meta.AgentVersion == nil || meta.AgentVersion.Version != "1.0.0" || meta.Model != "opus" || meta.Harness != "claude" {
		t.Fatalf("first conversation = %+v, %v", meta, err)
	}
	records, err := rt.convs.Messages(chat)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.Role == pkgConversations.RoleUser || record.Role == pkgConversations.RoleAssistant {
			if record.AgentVersion != "1.0.0" || record.AgentRef != "reviewer" || record.PlayedBy != "Reviewer" {
				t.Fatalf("missing publication provenance = %+v", record)
			}
		}
		if record.Role == pkgConversations.RoleUser && record.Instructions != first.Instructions {
			t.Fatalf("prompt instructions = %q", record.Instructions)
		}
	}
	second := *first
	second.Version, second.Model, second.Instructions = "1.0.1", "sonnet", "Second publication."
	current.Published = &second
	if _, err := rt.boards.Chat(rt.handle, "flow-node-1", ""); err != nil {
		t.Fatal(err)
	}
	rt.play("flow-node-1")
	rt.waitIdle()
	newChat := rt.board().FlowNode("flow-node-1").Chat
	latest, err := rt.convs.Get(newChat)
	if err != nil || newChat == chat || latest.AgentVersion == nil || latest.AgentVersion.Version != "1.0.1" || latest.Model != "sonnet" {
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

type publicationHarness struct {
	stubHarness
	servers []equipment.MCPServer
}

func (h *publicationHarness) RenderMCP(servers []equipment.MCPServer) (string, error) {
	h.servers = servers
	return "rendered-tools", nil
}

func TestManualTurnsUseThePublishedAgentPackage(t *testing.T) {
	service, cfg := newConversationTestServer(t)
	t.Cleanup(service.hub.Shutdown)
	cfg.RequireAgentPackages = true
	harness := &publicationHarness{}
	service.harnesses.Set(harnessapi.HarnessClaude, harness)

	lock := []byte("lockfile_version: 1\n")
	digest := sha256.Sum256(lock)
	version := pkgBoards.ManagedAgentVersion{
		AgentID: "reviewer", Version: "1.0.2", Name: "Reviewer", Harness: "claude",
		Model: "retired-model", Effort: "high", Instructions: "Published instructions.",
		Commit: strings.Repeat("a", 40), LockDigest: hex.EncodeToString(digest[:]),
	}
	bundle := pkgBoards.AgentPackage{Format: "apm-deployment-v1", Project: "deployment", Commit: version.Commit, Files: map[string][]byte{
		"deployment/apm.lock.yaml":                     lock,
		"deployment/.claude/skills/checklist/SKILL.md": []byte("---\ndescription: Review checklist\n---\nPublished checklist\n"),
		"deployment/.mcp.json":                         []byte(`{"mcpServers":{"review":{"type":"http","url":"http://127.0.0.1:1/review"}}}`),
	}}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/reviewer/packages/"+version.Commit {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(bundle)
	}))
	defer upstream.Close()
	cfg.AgenticURL = upstream.URL
	definition := &pkgBoards.ManagedAgent{Name: "Draft", Harness: "codex", Model: "draft-model", Published: &version}
	service.agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{"reviewer": definition}}
	conversation := mustCreateThroughHandlers(t, service, `{"folder":"","agentId":"reviewer"}`)
	if conversation.AgentVersion == nil || conversation.AgentVersion.Commit != version.Commit ||
		conversation.Harness != version.Harness || conversation.Model != version.Model || conversation.Effort != version.Effort {
		t.Fatalf("created conversation = %+v", conversation)
	}

	definition.Published = nil
	job, refusal := service.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: conversation.ID, Prompt: "Review this draft.", Model: "other-model",
		Instructions: "Other orders.", PermissionMode: runnerconfig.PermissionModeBypass,
	})
	if refusal != nil {
		t.Fatalf("manual turn refused: %+v", refusal)
	}
	driver := harness.waitForDriver(t)
	run := driver.spawnedWith()
	if run.Model != version.Model || !strings.Contains(run.Instructions, version.Instructions) ||
		!strings.Contains(run.Instructions, "checklist/SKILL.md") || !strings.Contains(run.Instructions, "Review checklist") {
		t.Fatalf("turn configuration = %+v", run)
	}
	if len(harness.servers) != 1 || harness.servers[0].Name != "review" || run.MCPConfig != "rendered-tools" {
		t.Fatalf("turn tools = %+v, %q", harness.servers, run.MCPConfig)
	}
	driver.text("done")
	driver.finish(0)
	<-job.Settled
	for _, record := range mustMessages(t, service.conversations, conversation.ID) {
		if record.AgentVersion != "1.0.2" || record.AgentRef != "reviewer" || record.PlayedBy != "Reviewer" {
			t.Fatalf("manual turn lost its provenance = %+v", record)
		}
	}
}

func TestManualConversationRunsTheSavedDraftPackage(t *testing.T) {
	service, cfg := newConversationTestServer(t)
	t.Cleanup(service.hub.Shutdown)
	cfg.RequireAgentPackages = true
	harness := &publicationHarness{}
	service.harnesses.Set(harnessapi.HarnessClaude, harness)
	lock := []byte("lockfile_version: 1\n")
	digest := sha256.Sum256(lock)
	draft := pkgBoards.DraftAgentPackage{
		Agent: pkgBoards.ManagedAgentVersion{
			AgentID: "reviewer", Name: "Reviewer", Harness: "claude", Model: "haiku",
			Instructions: "Working tree instructions.", DraftID: strings.Repeat("A", 26),
			LockDigest: hex.EncodeToString(digest[:]),
		},
		Package: pkgBoards.AgentPackage{Format: "apm-deployment-v1", Project: "deployment", DraftID: strings.Repeat("A", 26), Files: map[string][]byte{
			"deployment/apm.lock.yaml":                 lock,
			"deployment/.agents/skills/draft/SKILL.md": []byte("---\ndescription: Working tree skill\n---\nDraft skill\n"),
			"deployment/.mcp.json":                     []byte(`{"mcpServers":{"draft-tool":{"type":"stdio","command":"node"}}}`),
		}},
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/agents/reviewer":
			_ = json.NewEncoder(w).Encode(pkgBoards.ManagedAgent{Name: draft.Agent.Name})
		case r.Method == http.MethodPost && r.URL.Path == "/agents/reviewer/packages/draft":
			_ = json.NewEncoder(w).Encode(draft)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	cfg.AgenticURL = upstream.URL
	service.agents = pkgBoards.NewHybridflowStore(upstream.URL, "")

	withoutDraft := httptest.NewRecorder()
	service.HandleCreateConversation(withoutDraft, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"agentId":"reviewer"}`)))
	if withoutDraft.Code != http.StatusBadRequest {
		t.Fatalf("create without opting into the draft: %d %s", withoutDraft.Code, withoutDraft.Body)
	}
	conversation := mustCreateThroughHandlers(t, service, `{"folder":"","agentId":"reviewer","useDraft":true}`)
	upstream.Close()
	if conversation.AgentVersion == nil || conversation.AgentVersion.DraftID != draft.Agent.DraftID ||
		conversation.AgentVersion.Commit != "" || conversation.Model != "haiku" {
		t.Fatalf("draft conversation = %+v", conversation)
	}
	job, refusal := service.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: conversation.ID, Prompt: "Use the draft.", PermissionMode: runnerconfig.PermissionModeBypass,
	})
	if refusal != nil {
		t.Fatalf("draft turn refused: %+v", refusal)
	}
	driver := harness.waitForDriver(t)
	run := driver.spawnedWith()
	if !strings.Contains(run.Instructions, draft.Agent.Instructions) || !strings.Contains(run.Instructions, "Working tree skill") {
		t.Fatalf("draft instructions = %q", run.Instructions)
	}
	if len(harness.servers) != 1 || harness.servers[0].Name != "draft-tool" {
		t.Fatalf("draft tools = %+v", harness.servers)
	}
	driver.text("done")
	driver.finish(0)
	<-job.Settled
}

func TestPublishedConversationRefusesModelPatchAndForksOntoLatestPublication(t *testing.T) {
	service, _ := newConversationTestServer(t)
	service.harnesses.Set(harnessapi.HarnessClaude, &stubHarness{})
	first := &pkgBoards.ManagedAgentVersion{AgentID: "reviewer", Version: "1.0.0", Name: "Reviewer", Harness: "claude", Model: "opus"}
	source, err := service.conversations.Create(pkgConversations.ConversationMeta{
		Harness: "claude", Model: "opus", Effort: "high", PermissionMode: runnerconfig.PermissionModeBypass, AgentVersion: first,
	})
	if err != nil {
		t.Fatal(err)
	}
	second := *first
	second.Version, second.Model = "1.0.1", "sonnet"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(pkgBoards.ManagedAgent{Name: "Reviewer", Published: &second})
	}))
	defer server.Close()
	service.agents = pkgBoards.NewHybridflowStore(server.URL, "token")
	patch := do(service, jsonReq(http.MethodPatch, "/hybridflow-runner/conversations/"+source.ID, `{"model":"sonnet"}`))
	if patch.Code != http.StatusBadRequest {
		t.Fatalf("model patch = %d %s", patch.Code, patch.Body)
	}
	fork := do(service, jsonReq(http.MethodPost, "/hybridflow-runner/conversations/"+source.ID+"/fork", `{}`))
	if fork.Code != http.StatusCreated {
		t.Fatalf("fork = %d %s", fork.Code, fork.Body)
	}
	var made pkgConversations.HarnessConversationDto
	if err := json.Unmarshal(fork.Body.Bytes(), &made); err != nil {
		t.Fatal(err)
	}
	if made.AgentVersion == nil || made.AgentVersion.Version != "1.0.1" || made.Model != "sonnet" {
		t.Fatalf("fork configuration = %+v", made)
	}
	stored, _ := service.conversations.Get(source.ID)
	if stored.AgentVersion.Version != "1.0.0" || stored.Model != "opus" {
		t.Fatal("fork changed its source")
	}
}

func TestNewTaskConversationsRefuseArchivedAndUnpublishedAgents(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{unpublished: true, byID: map[string]*pkgBoards.ManagedAgent{
		"draft":    {Name: "Draft", Harness: "claude"},
		"archived": {Name: "Archived", Harness: "claude", Archived: true},
	}}
	for id, want := range map[string]string{"draft": "no published version", "archived": "archived"} {
		if _, err := rt.runner.ResolveAgent(playback.FlowNodeWithAgent(id)); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%s resolution = %v", id, err)
		}
	}
}
