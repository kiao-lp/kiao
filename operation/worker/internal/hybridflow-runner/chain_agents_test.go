package hybridflowrunner

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubAgents is the hybridflow-store's agents behind a map: the ids it holds, and the failure it
// answers with where one is set.
type stubAgents struct {
	byID map[string]*managedAgent
	err  error
}

func (s stubAgents) Agent(id string) (*managedAgent, error) {
	if s.err != nil {
		return nil, s.err
	}
	if found, ok := s.byID[id]; ok {
		return found, nil
	}
	return nil, ErrAgentUnknown
}

// A card naming a managed agent runs on what the agent says: its platform, its model, and its
// standing instructions.
func TestResolveAgentReadsAManagedAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus", Instructions: "Be concise."},
	}}
	got, err := rt.runner.resolveAgent(flowNode{Settings: flowNodeSettings{Agent: "agent-1"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.name != "Reviewer" || got.platform != "claude" || got.model != "opus" ||
		got.instructions != "Be concise." {
		t.Errorf("resolved = %+v, want the agent's platform, model and instructions", got)
	}
	if got.id != "agent-1" {
		t.Errorf("resolved id = %q, want the card's own words for the agent", got.id)
	}
}

// A card written before managed agents names the engine itself, with the model beside it. Where
// the id names no agent and the value is an engine this build drives, that is still a card to
// play — and nothing about the engine having to be offered right now, which is the refusal's own
// question rather than the resolution's.
func TestResolveAgentReadsLegacyCards(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.agents = stubAgents{}
	got, err := rt.runner.resolveAgent(flowNode{
		Settings: flowNodeSettings{Agent: "claude", Model: "opus"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.name != "" || got.platform != "claude" || got.model != "opus" || got.instructions != "" {
		t.Errorf("resolved = %+v, want the card's own engine and model", got)
	}
	if got.id != "claude" {
		t.Errorf("resolved id = %q, want the engine the card named", got.id)
	}
}

// Anything else is refused with the card's own words in the message: an id nothing holds, or an
// engine with no model beside it — which is not a card from before, it is a card that never said
// enough.
func TestResolveAgentRefusesWhatItCannotRead(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.agents = stubAgents{}
	for _, settings := range []flowNodeSettings{
		{Agent: "ghost"},
		{Agent: "claude"},
	} {
		if _, err := rt.runner.resolveAgent(flowNode{Settings: settings}); err == nil ||
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
	rt.runner.agents = stubAgents{err: cause}
	if _, err := rt.runner.resolveAgent(flowNode{
		Settings: flowNodeSettings{Agent: "agent-1"},
	}); !errors.Is(err, cause) {
		t.Errorf("resolve = %v, want the failure carried", err)
	}
}

// A runner with no resolver — no store is named — plays legacy cards only: an engine with
// a model beside it, as every card said before managed agents.
func TestResolveAgentWithoutAResolverPlaysLegacyOnly(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	if rt.runner.agents != nil {
		t.Fatal("a runner with no store must resolve nothing")
	}
	if _, err := rt.runner.resolveAgent(flowNode{
		Settings: flowNodeSettings{Agent: "claude", Model: "opus"},
	}); err != nil {
		t.Errorf("a legacy card = %v, want it read", err)
	}
	if _, err := rt.runner.resolveAgent(flowNode{
		Settings: flowNodeSettings{Agent: "agent-1"},
	}); err == nil {
		t.Error("an id with no resolver to ask reads as nothing, want a refusal")
	}
}

// A managed agent on a platform this host does not offer is refused by its name rather than by an
// id nobody reads; a legacy card reads as it always did.
func TestAgentRefusalNamesTheAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-1": {Name: "Reviewer", Platform: "codex", Model: "gpt-5.6"},
	}}
	// Codex withdrawn from this host: the card is refused for the platform, not for the id.
	for i := range rt.hub.agents.entries {
		if rt.hub.agents.entries[i].name == agentCodex {
			rt.hub.agents.entries[i].allowed = false
		}
	}
	refusal := rt.runner.agentRefusal(flowNode{Type: flowNodeTypeAI,
		Settings: flowNodeSettings{Agent: "agent-1", Effort: "high"}})
	if !strings.Contains(refusal, "Reviewer") || !strings.Contains(refusal, "codex") {
		t.Errorf("refusal = %q, want the agent's name and its platform", refusal)
	}
	legacy := rt.runner.agentRefusal(flowNode{Type: flowNodeTypeAI,
		Settings: flowNodeSettings{Agent: "codex", Model: "gpt-5.6", Effort: "high"}})
	if !strings.Contains(legacy, "codex") || strings.Contains(legacy, "no agent of this store") {
		t.Errorf("legacy refusal = %q, want the engine refused as unoffered", legacy)
	}
	// And a platform this host does offer, in a mode it has, is refused nothing.
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-2": {Name: "Writer", Platform: "claude", Model: "opus"},
	}}
	if refusal := rt.runner.agentRefusal(flowNode{Type: flowNodeTypeAI, Settings: flowNodeSettings{
		Agent: "agent-2", Effort: "high", Permission: permissionModeBypass, Folder: "/",
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
			`"description":"` + description + `","instructions":"Be terse."}`))
	}))
	defer server.Close()
	rt.runner.agents = newHybridflowStore(server.URL, "token")

	rt.play("flow-node-1")
	rt.waitIdle()

	flowNode := rt.board().flowNode("flow-node-1")
	if flowNode.Status != flowNodeStatusDone {
		t.Fatalf("status = %q, want the card played", flowNode.Status)
	}
	meta, err := rt.convs.get(flowNode.Chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Agent != agentClaude || meta.Model != "opus" {
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

// A card played again runs on what its agent says now, not on what its chat still holds from
// the first play: the turn is spawned with the agent's current model, in the same chat, and the
// chat then holds that model as its own default.
func TestAReplayedCardRunsOnItsAgentsCurrentModel(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"agent-1",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()
	first := rt.board().flowNode("flow-node-1")

	// The definition edited between the plays: the next turn runs on sonnet.
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "sonnet"},
	}}
	rt.play("flow-node-1")
	rt.waitIdle()
	second := rt.board().flowNode("flow-node-1")

	if second.Chat == "" || second.Chat != first.Chat {
		t.Fatalf("replay chat = %q, want the first play's %q", second.Chat, first.Chat)
	}
	meta, err := rt.convs.get(second.Chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Model != "sonnet" {
		t.Errorf("chat model = %q, want the agent's current model", meta.Model)
	}
	if invoked := rt.invoked(); !strings.Contains(invoked, "opus") || !strings.Contains(invoked, "sonnet") {
		t.Errorf("invoked = %q, want a turn spawned on each of the agent's models", invoked)
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
	rt.runner.agents = stubAgents{byID: map[string]*managedAgent{
		"agent-1": {Name: "Reviewer", Platform: "claude", Model: "opus"},
	}}

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	first, second := board.flowNode("flow-node-1"), board.flowNode("flow-node-2")
	if first.Status != flowNodeStatusDone {
		t.Errorf("first = %q, want it played", first.Status)
	}
	// Standing as it stood: a chain reaching a card nobody can play ends there, and the card is
	// marked nothing — no spinner, no error, no mark.
	switch second.Status {
	case "", flowNodeStatusReady:
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

	client := newHybridflowStore(server.URL, "token")
	found, err := client.Agent("agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if found.Name != "Reviewer" || found.Platform != "claude" || found.Model != "opus" ||
		found.Instructions != "Be concise." {
		t.Errorf("agent = %+v, want the fields a play runs on", found)
	}
	if _, err := client.Agent("ghost"); !errors.Is(err, ErrAgentUnknown) {
		t.Errorf("an id nothing holds = %v, want unknown rather than a failure", err)
	}
}
