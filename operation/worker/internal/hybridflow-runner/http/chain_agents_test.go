package runnerhttp

import (
	"errors"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
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
			out.Published = &pkgBoards.ManagedAgentVersion{AgentID: id, Version: 1, Name: out.Name,
				Platform: out.Platform, Model: out.Model, ProfileID: out.ProfileID, Instructions: out.Instructions}
		}
		return &out, nil
	}
	return nil, pkgBoards.ErrAgentUnknown
}

// A card naming a managed agent runs on what the agent says: its platform, its model, and its
// standing instructions.
func TestResolveAgentReadsAManagedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus", Instructions: "Be concise."},
	}}
	got, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Reviewer" || got.Platform != "claude" || got.Model != "opus" ||
		got.Instructions != "Be concise." {
		t.Errorf("resolved = %+v, want the agent's platform, model and instructions", got)
	}
	if got.Id != "agent-1" {
		t.Errorf("resolved id = %q, want the card's own words for the agent", got.Id)
	}
}

// A card written before managed agents names the engine itself, with the model beside it. Where
// the id names no agent and the value is an engine this build drives, that is still a card to
// play — and nothing about the engine having to be offered right now, which is the refusal's own
// question rather than the resolution's.
func TestResolveAgentReadsLegacyCards(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{}
	got, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "claude", Model: "opus"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "" || got.Platform != "claude" || got.Model != "opus" || got.Instructions != "" {
		t.Errorf("resolved = %+v, want the card's own engine and model", got)
	}
	if got.Id != "claude" {
		t.Errorf("resolved id = %q, want the engine the card named", got.Id)
	}
}

// Anything else is refused with the card's own words in the message: an id nothing holds, or an
// engine with no model beside it — which is not a card from before, it is a card that never said
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

// A service that cannot be asked is not the card's fault: the failure travels as it stands, and
// the play stops on it rather than on a refusal of the card.
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

// A runner with no resolver — no store is named — plays legacy cards only: an engine with
// a model beside it, as every card said before managed agents.
func TestResolveAgentWithoutAResolverPlaysLegacyOnly(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	if rt.runner.Agents != nil {
		t.Fatal("a runner with no store must resolve nothing")
	}
	if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "claude", Model: "opus"},
	}); err != nil {
		t.Errorf("a legacy card = %v, want it read", err)
	}
	if _, err := rt.runner.ResolveAgent(pkgBoards.FlowNode{
		Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1"},
	}); err == nil {
		t.Error("an id with no resolver to ask reads as nothing, want a refusal")
	}
}

// A managed agent on a platform this host does not offer is refused by its name rather than by an
// id nobody reads; a legacy card reads as it always did.
func TestAgentRefusalNamesTheAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Platform: "codex", Model: "gpt-5.6"},
	}}
	// Codex withdrawn from this host: the card is refused for the platform, not for the id.
	for i := range rt.hub.Agents.Entries {
		if rt.hub.Agents.Entries[i].Name == agentapi.AgentCodex {
			rt.hub.Agents.Entries[i].Allowed = false
		}
	}
	refusal := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI,
		Settings: pkgBoards.FlowNodeSettings{Agent: "agent-1", Effort: "high"}})
	if !strings.Contains(refusal, "Reviewer") || !strings.Contains(refusal, "codex") {
		t.Errorf("refusal = %q, want the agent's name and its platform", refusal)
	}
	legacy := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI,
		Settings: pkgBoards.FlowNodeSettings{Agent: "codex", Model: "gpt-5.6", Effort: "high"}})
	if !strings.Contains(legacy, "codex") || strings.Contains(legacy, "no agent of this store") {
		t.Errorf("legacy refusal = %q, want the engine refused as unoffered", legacy)
	}
	// And a platform this host does offer, in a mode it has, is refused nothing.
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-2": {Name: "Writer", Platform: "claude", Model: "opus"},
	}}
	if refusal := rt.runner.AgentRefusal(pkgBoards.FlowNode{Type: pkgBoards.FlowNodeTypeAI, Settings: pkgBoards.FlowNodeSettings{
		Agent: "agent-2", Effort: "high", Permission: runnerconfig.PermissionModeBypass, Folder: "/",
	}}); refusal != "" {
		t.Errorf("refusal = %q, want nothing refused", refusal)
	}
}

// A card naming a managed agent is played on what the agent says: its chat is bound to the
// platform and the model, and its turn is given the standing instructions — in the system prompt
// beside the briefing, never in the prompt text.
func TestAPlayedCardRunsOnItsManagedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"agent-1",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	const description = "Choose for code review."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"agent-1","name":"Reviewer","platform":"claude","model":"opus",` +
			`"description":"` + description + `","instructions":"Be terse.",` +
			`"published":{"agentId":"agent-1","version":1,"name":"Reviewer","platform":"claude","model":"opus","instructions":"Be terse."}}`))
	}))
	defer server.Close()
	rt.runner.Agents = pkgBoards.NewHybridflowStore(server.URL, "token")

	rt.play("flow-node-1")
	rt.waitIdle()

	flowNode := rt.board().FlowNode("flow-node-1")
	if flowNode.Status != pkgBoards.FlowNodeStatusDone {
		t.Fatalf("status = %q, want the card played", flowNode.Status)
	}
	meta, err := rt.convs.Get(flowNode.Chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Agent != agentapi.AgentClaude || meta.Model != "opus" {
		t.Errorf("chat runs on %q/%q, want the agent's platform and model", meta.Agent, meta.Model)
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

func TestAReplayedCardKeepsItsConversationsPublishedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"agent-1",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()
	first := rt.board().FlowNode("flow-node-1")

	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Renamed", Platform: "claude", Model: "sonnet", Archived: true, Instructions: "New orders."},
	}}
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
	if meta.Model != "opus" || meta.AgentVersion == nil || meta.AgentVersion.Version != 1 || meta.AgentVersion.Name != "Reviewer" {
		t.Errorf("chat configuration = %+v, want publication 1", meta)
	}
	if invoked := rt.invoked(); !strings.Contains(invoked, "opus") || strings.Contains(invoked, "sonnet") || strings.Contains(invoked, "New orders.") {
		t.Errorf("invoked = %q, want the original configuration on both turns", invoked)
	}
}

// A card whose agent is gone ends the chain unmarked, the way a chain reaching a card nobody can
// play ends it — rather than as a turn that ran and failed.
func TestAChainEndsOnACardWhoseAgentIsGone(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"},"onSuccess":{"flowNode":"flow-node-2","mode":"end"}},
		{"id":"flow-node-2","title":"Second","body":"Do the second thing.","settings":{"agent":"ghost",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.Agents = stubAgents{byID: map[string]*pkgBoards.ManagedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	first, second := board.FlowNode("flow-node-1"), board.FlowNode("flow-node-2")
	if first.Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("first = %q, want it played", first.Status)
	}
	// Standing as it stood: a chain reaching a card nobody can play ends there, and the card is
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
// as a failure — the caller reads a legacy card next.
func TestHybridflowStoreReadsAnAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/agent-1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"agent-1","name":"Reviewer","platform":"claude",` +
			`"model":"opus","instructions":"Be concise.","revision":3}`))
	}))
	defer server.Close()

	client := pkgBoards.NewHybridflowStore(server.URL, "token")
	found, err := client.Agent("agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if found.Name != "Reviewer" || found.Platform != "claude" || found.Model != "opus" ||
		found.Instructions != "Be concise." {
		t.Errorf("agent = %+v, want the fields a play runs on", found)
	}
	if _, err := client.Agent("ghost"); !errors.Is(err, pkgBoards.ErrAgentUnknown) {
		t.Errorf("an id nothing holds = %v, want unknown rather than a failure", err)
	}
}
