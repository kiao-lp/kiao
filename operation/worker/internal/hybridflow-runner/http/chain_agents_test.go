package runnerhttp

import (
	"errors"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubAgents is the hybridflow-store's agents behind a map: the ids it holds, and the failure it
// answers with where one is set.
type stubAgents struct {
	byID        map[string]*pkgBoards.ManagedAgent
	err         error
	unpublished bool
}

func (s stubAgents) Agent(id string) (*pkgBoards.ManagedAgent, error) {
	if s.err != nil {
		return nil, s.err
	}
	if found, ok := s.byID[id]; ok {
		out := *found
		if out.Published == nil && !s.unpublished {
			out.Published = &pkgBoards.ManagedAgentVersion{AgentID: id, Version: "1.0.0", Name: out.Name,
				Harness: out.Harness, Model: out.Model, ProfileID: out.ProfileID, Instructions: out.Instructions}
		}
		return &out, nil
	}
	return nil, pkgBoards.ErrAgentUnknown
}

// A flow node naming a managed agent runs on what the agent says: its harness, its model, and its
// standing instructions.
func TestResolveAgentReadsAManagedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Harness: "claude", Model: "opus", Instructions: "Be concise."},
	}}
	got, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Reviewer" || got.Harness != "claude" || got.Model != "opus" ||
		got.Instructions != "Be concise." {
		t.Errorf("resolved = %+v, want the agent's harness, model and instructions", got)
	}
	if got.Id != "agent-1" {
		t.Errorf("resolved id = %q, want the flow node's own words for the agent", got.Id)
	}
}

// A flow node written before managed agents names the harness itself, with the model beside it. Where
// the id names no agent and the value is a harness this build drives, that is still a flow node to
// play — and nothing about the harness having to be offered right now, which is the refusal's own
// question rather than the resolution's.
func TestResolveAgentReadsLegacyFlowNodes(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{}
	got, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "claude", Model: "opus"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "" || got.Harness != "claude" || got.Model != "opus" || got.Instructions != "" {
		t.Errorf("resolved = %+v, want the flow node's own harness and model", got)
	}
	if got.Id != "claude" {
		t.Errorf("resolved id = %q, want the harness the flow node named", got.Id)
	}
}

// Anything else is refused with the flow node's own words in the message: an id nothing holds, or an
// harness with no model beside it — which is not a flow node from before, it is a flow node that never said
// enough.
func TestResolveAgentRefusesWhatItCannotRead(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{}
	for _, settings := range []pkgBoards.FlowNodeSettings{
		{Agent: "ghost"},
		{Agent: "claude"},
	} {
		if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{Settings: settings}); err == nil ||
			!strings.Contains(err.Error(), settings.Agent) {
			t.Errorf("resolve(%q) = %v, want a refusal naming it", settings.Agent, err)
		}
	}
}

// A service that cannot be asked is not the flow node's fault: the failure travels as it stands, and
// the play stops on it rather than on a refusal of the flow node.
func TestResolveAgentCarriesAServiceFailure(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	cause := errors.New("the hybridflow store could not be reached")
	rt.runner.Agents = stubAgents{err: cause}
	if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1"},
	}); !errors.Is(err, cause) {
		t.Errorf("resolve = %v, want the failure carried", err)
	}
}

// A runner with no resolver — no store is named — plays legacy flow nodes only: a harness with
// a model beside it, as every flow node said before managed agents.
func TestResolveAgentWithoutAResolverPlaysLegacyOnly(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	if rt.runner.Agents != nil {
		t.Fatal("a runner with no store must resolve nothing")
	}
	if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "claude", Model: "opus"},
	}); err != nil {
		t.Errorf("a legacy flow node = %v, want it read", err)
	}
	if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1"},
	}); err == nil {
		t.Error("an id with no resolver to ask reads as nothing, want a refusal")
	}
}

// A managed agent on an unavailable harness is refused by name;
// a legacy harness/model flow node is refused by harness.
func TestAgentRefusalNamesTheAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Harness: "codex", Model: "gpt-5.6"},
	}}
	// Codex withdrawn from this host: the flow node is refused for the harness, not for the id.
	for i := range rt.hub.Harnesses.Entries {
		if rt.hub.Harnesses.Entries[i].Name == harnessapi.HarnessCodex {
			rt.hub.Harnesses.Entries[i].Allowed = false
		}
	}
	refusal := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI,
		Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1", Effort: "high"}})
	if !strings.Contains(refusal, "Reviewer") || !strings.Contains(refusal, "codex") {
		t.Errorf("refusal = %q, want the agent's name and its harness", refusal)
	}
	legacy := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI,
		Settings: pkgBoards.FlowNodeSettings{Agent: "codex", Model: "gpt-5.6", Effort: "high"}})
	if !strings.Contains(legacy, "codex") || strings.Contains(legacy, "no agent of this store") {
		t.Errorf("legacy refusal = %q, want the harness refused as unoffered", legacy)
	}
	// And a harness this host does offer, in a mode it has, is refused nothing.
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-2": {Name: "Writer", Harness: "claude", Model: "opus"},
	}}
	if refusal := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI, Settings: pkgBoards.FlowNodeSettings{
		Agent: "agent-2", Effort: "high", Permission: runnerconfig.PermissionModeBypass, Folder: "/",
	}}); refusal != "" {
		t.Errorf("refusal = %q, want nothing refused", refusal)
	}
}

// A flow node naming a managed agent is played on what the agent says: its chat is bound to the
// harness and the model, and its turn is given the standing instructions — in the system prompt
// beside the briefing, never in the prompt text.
func TestAPlayedFlowNodeRunsOnItsManagedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"agent-1",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	const description = "Choose for code review."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"agent-1","name":"Reviewer","harness":"claude","model":"opus",` +
			`"description":"` + description + `","instructions":"Be terse.",` +
			`"published":{"agentId":"agent-1","version":1,"name":"Reviewer","harness":"claude","model":"opus","instructions":"Be terse."}}`))
	}))
	defer server.Close()
	rt.runner.Agents = pkgBoards.NewHybridflowStore(server.URL, "token")

	rt.play("flow-node-1")
	rt.waitIdle()

	flowNode := rt.board().FlowNode("flow-node-1")
	if flowNode.Status != pkgBoards.FlowNodeStatusDone {
		t.Fatalf("status = %q, want the flow node played", flowNode.Status)
	}
	meta, err := rt.convs.Get(flowNode.Chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Harness != harnessapi.HarnessClaude || meta.Model != "opus" {
		t.Errorf("chat runs on %q/%q, want the agent's harness and model", meta.Harness, meta.Model)
	}
	prompts := rt.prompts()
	if len(prompts) != 1 || !strings.HasPrefix(prompts[0], "Do a thing") {
		t.Errorf("prompts = %q, want the description sent", prompts)
	} else if strings.Contains(prompts[0], "Be terse.") {
		t.Errorf("prompt = %q, want the instructions out of the prompt text", prompts[0])
	}
	if !strings.Contains(rt.invoked(), "Be terse.") {
		t.Error("the CLI was invoked without the agent's standing instructions")
	}
	if strings.Contains(rt.invoked(), description) || strings.Contains(strings.Join(prompts, "\n"), description) {
		t.Error("the agent's selection description was sent to its turn")
	}
}

func TestAReadyFlowNodeKeepsItsConversationsPublishedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"agent-1",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Harness: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()
	first := rt.board().FlowNode("flow-node-1")

	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Renamed", Harness: "claude", Model: "sonnet", Archived: true, Instructions: "New orders."},
	}}
	rt.editFlowNode("flow-node-1", func(node *pkgBoards.FlowNode) { node.Status = pkgBoards.FlowNodeStatusReady })
	rt.play("flow-node-1")
	rt.waitIdle()
	second := rt.board().FlowNode("flow-node-1")

	if second.Chat == "" || second.Chat != first.Chat {
		t.Fatalf("replay chat = %q, want the first play's %q", second.Chat, first.Chat)
	}
	meta, err := rt.convs.Get(second.Chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Model != "opus" || meta.AgentVersion == nil || meta.AgentVersion.Version != "1.0.0" || meta.AgentVersion.Name != "Reviewer" {
		t.Errorf("chat configuration = %+v, want publication 1", meta)
	}
	if invoked := rt.invoked(); !strings.Contains(invoked, "opus") || strings.Contains(invoked, "sonnet") || strings.Contains(invoked, "New orders.") {
		t.Errorf("invoked = %q, want the original configuration on both turns", invoked)
	}
}

func TestPlayingACompletedFlowNodeUsesTheCurrentAgentPublication(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[{"id":"task","title":"Review","status":"done","chat":"chat-on-another-runner",
		"settings":{"agent":"reviewer","effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"reviewer": {Published: &pkgBoards.ManagedAgentVersion{
			AgentID: "reviewer", Version: "2.0.0", Name: "Reviewer", Harness: "claude", Model: "sonnet",
		}},
	}}
	rt.play("task")
	rt.waitIdle()
	task := rt.board().FlowNode("task")
	if task.Status != pkgBoards.FlowNodeStatusDone || task.Chat == "" || task.Chat == "chat-on-another-runner" {
		t.Fatalf("replayed task = %+v", task)
	}
	meta, err := rt.convs.Get(task.Chat)
	if err != nil || meta.AgentVersion == nil || meta.AgentVersion.Version != "2.0.0" || meta.ForkedFrom != "" {
		t.Fatalf("new conversation = %+v, %v", meta, err)
	}
}

// A flow node whose agent is gone ends the chain unmarked, the way a chain reaching a flow node nobody can
// play ends it — rather than as a turn that ran and failed.
func TestAChainEndsOnAFlowNodeWhoseAgentIsGone(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"},"onSuccess":{"flowNode":"flow-node-2","mode":"end"}},
		{"id":"flow-node-2","title":"Second","body":"Do the second thing.","settings":{"agent":"ghost",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Harness: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	first, second := board.FlowNode("flow-node-1"), board.FlowNode("flow-node-2")
	if first.Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("first = %q, want it played", first.Status)
	}
	// Standing as it stood: a chain reaching a flow node nobody can play ends there, and the flow node is
	// marked nothing — no spinner, no error, no mark.
	switch second.Status {
	case "", pkgBoards.FlowNodeStatusReady:
	default:
		t.Errorf("second = %q, want it standing ready, unmarked", second.Status)
	}
	if second.Body != "Do the second thing." {
		t.Errorf("second body = %q, want the description untouched", second.Body)
	}
}

// The agent read over HTTP: the fields a play runs on, and a 404 answered as unknown rather than
// as a failure — the caller reads a legacy flow node next.
func TestHybridflowStoreReadsAnAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/agent-1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"agent-1","name":"Reviewer","harness":"claude",` +
			`"model":"opus","instructions":"Be concise.","revision":3}`))
	}))
	defer server.Close()

	client := pkgBoards.NewHybridflowStore(server.URL, "token")
	found, err := client.Agent("agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if found.Name != "Reviewer" || found.Harness != "claude" || found.Model != "opus" ||
		found.Instructions != "Be concise." {
		t.Errorf("agent = %+v, want the fields a play runs on", found)
	}
	if _, err := client.Agent("ghost"); !errors.Is(err, pkgBoards.ErrAgentUnknown) {
		t.Errorf("an id nothing holds = %v, want unknown rather than a failure", err)
	}
}

func TestChangingTaskAgentForksItsPublishedConversation(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[{"id":"flow-node-1","title":"Repair","body":"Do the task","settings":{"agent":"first","effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"first":  {Name: "First", Harness: "claude", Model: "opus"},
		"second": {Name: "Second", Harness: "claude", Model: "sonnet", Instructions: "Replacement orders."},
	}}
	rt.play("flow-node-1")
	rt.waitIdle()
	original := rt.board().FlowNode("flow-node-1").Chat
	rt.editFlowNode("flow-node-1", func(node *pkgBoards.FlowNode) {
		node.Settings.Agent = "second"
		node.Status = pkgBoards.FlowNodeStatusReady
	})
	rt.play("flow-node-1")
	rt.waitIdle()
	next := rt.board().FlowNode("flow-node-1").Chat
	if original == "" || next == original {
		t.Fatalf("replacement conversation: %q -> %q", original, next)
	}
	meta, err := rt.convs.Get(next)
	if err != nil || meta.AgentVersion == nil || meta.AgentVersion.AgentID != "second" || meta.Model != "sonnet" {
		t.Fatalf("replacement publication: %+v %v", meta, err)
	}
	before, err := rt.convs.Get(original)
	if err != nil || before.AgentVersion.AgentID != "first" {
		t.Fatalf("original conversation changed: %+v %v", before, err)
	}
}
