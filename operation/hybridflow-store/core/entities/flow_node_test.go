package entities

import "testing"

// The type a card is read as where it says none: a named agent makes it an agent's, a named model
// beside no agent is what a board written before managed agents says, and nothing at all is a
// person's.
func TestReadFlowNodeType(t *testing.T) {
	cases := []struct {
		name     string
		said     string
		settings TaskSettings
		want     FlowNodeType
	}{
		{"explicit", "ai", TaskSettings{}, FlowNodeAI},
		{"explicit human", "human", TaskSettings{Agent: "id-1"}, FlowNodeHuman},
		{"agent", "", TaskSettings{Agent: "id-1"}, FlowNodeAI},
		{"legacy engine and model", "", TaskSettings{Agent: "claude", Model: "opus"}, FlowNodeAI},
		{"legacy model alone", "", TaskSettings{Model: "opus"}, FlowNodeAI},
		{"nothing", "", TaskSettings{}, FlowNodeHuman},
		{"unknown word", "hal", TaskSettings{}, FlowNodeHuman},
	}
	for _, c := range cases {
		if got := ReadFlowNodeType(c.said, c.settings); got != c.want {
			t.Errorf("%s: type = %q, want %q", c.name, got, c.want)
		}
	}
}

// An AI card is played where it names all four of its settings. The legacy model is no part of
// the answer: a card naming an agent, an effort, a permission mode and a folder is complete with
// or without one.
func TestTaskSettingsComplete(t *testing.T) {
	full := TaskSettings{Agent: "id-1", Effort: "high", Permission: "bypassPermissions", Folder: "/"}
	if !full.Complete() {
		t.Error("a card naming all four is not complete")
	}
	if full.Empty() {
		t.Error("a card naming all four is empty")
	}
	for name, settings := range map[string]TaskSettings{
		"no agent":     {Effort: "high", Permission: "bypassPermissions", Folder: "/"},
		"no effort":    {Agent: "id-1", Permission: "bypassPermissions", Folder: "/"},
		"no mode":      {Agent: "id-1", Effort: "high", Folder: "/"},
		"no folder":    {Agent: "id-1", Effort: "high", Permission: "bypassPermissions"},
		"legacy alone": {Agent: "claude", Model: "opus"},
	} {
		if settings.Complete() {
			t.Errorf("%s: a card missing a setting is complete", name)
		}
	}
	if (!TaskSettings{}.Empty()) {
		t.Error("a card naming nothing is not empty")
	}
	// A legacy model is still something a card says, even though nothing writes it any more.
	if (TaskSettings{Model: "opus"}).Empty() {
		t.Error("a card naming only a legacy model is empty")
	}
}

// `compact` was one word for two answers — shorten this chat *and* hand it on — so a store, a
// client or a script still saying it says both, and neither half has to be picked again.
func TestTransitionModeReadsTheWordThatSplit(t *testing.T) {
	mode, compact := ReadTransitionMode("compact")
	if mode != TransitionContinue || !compact {
		t.Errorf("read = %q / %v, want the chat shortened and carried on", mode, compact)
	}
	if mode, compact := ReadTransitionMode("continue"); mode != TransitionContinue || compact {
		t.Errorf("read = %q / %v, want continue on its own", mode, compact)
	}
	// A word this build has no meaning for is somebody having answered the question, so it is read
	// as the answer that claims nothing.
	if mode, compact := ReadTransitionMode("shutdown"); mode != TransitionModeDefault || compact {
		t.Errorf("read = %q / %v, want a word with no meaning read as claiming nothing", mode, compact)
	}
}

// What a card says about its chat is read against its type, the retired word included: a card that
// is not AI has no conversation to shorten or to hand on.
func TestTransitionForTheCardsType(t *testing.T) {
	said := Transition{Mode: LegacyTransitionCompact}
	if got := said.For(FlowNodeAI); got.Mode != TransitionContinue || !got.Compact {
		t.Errorf("ai = %+v, want the old word read as both answers", got)
	}
	if got := said.For(FlowNodeHuman); got.Mode != TransitionEnd || got.Compact {
		t.Errorf("human = %+v, want nothing claimed about a chat", got)
	}
}

// The chain is read against the type too, and there the answer is the Shutdown's: the board ends
// where the machine goes off, so a card drawn out of one is a chain nothing could follow.
func TestNextForTheCardsType(t *testing.T) {
	for _, flowNodeType := range []FlowNodeType{FlowNodeAI, FlowNodeHuman, FlowNodeScheduler} {
		if got := NextFor("flow-node-9", flowNodeType); got != "flow-node-9" {
			t.Errorf("%s: next = %q, want the chain kept", flowNodeType, got)
		}
	}
	if got := NextFor("flow-node-9", FlowNodeShutdown); got != "" {
		t.Errorf("shutdown: next = %q, want no chain after the machine goes off", got)
	}
	if got := NextFor("flow-node-9", FlowNodeGateway); got != "" {
		t.Errorf("gateway: next = %q, want none the single way — its branches are the list", got)
	}
}

// The branches are a Gateway's alone: one card follows every other kind, named the single way.
// What a Gateway keeps is cleaned — trimmed, emptied of empties, each kept once in the order said.
func TestNextsForTheCardsType(t *testing.T) {
	for _, flowNodeType := range []FlowNodeType{FlowNodeAI, FlowNodeHuman, FlowNodeShutdown, FlowNodeScheduler} {
		if got := NextsFor([]string{"flow-node-9"}, flowNodeType); got != nil {
			t.Errorf("%s: nexts = %q, want nothing for a list on a card that is no gateway", flowNodeType, got)
		}
	}
	got := NextsFor([]string{" b ", "", "b", "a"}, FlowNodeGateway)
	want := []string{"b", "a"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("gateway: nexts = %q, want %q", got, want)
	}
	if got := NextsFor(nil, FlowNodeGateway); got != nil {
		t.Errorf("gateway: nexts = %q, want none where none were said", got)
	}
}

// Which kinds of card are **tasks** — work somebody does, and the two that carry one.
func TestOnlyTheTwoKindsOfWorkAreTasks(t *testing.T) {
	for _, flowNodeType := range []FlowNodeType{FlowNodeAI, FlowNodeHuman} {
		if !flowNodeType.IsTask() {
			t.Errorf("%s: not a task, and it is work somebody does", flowNodeType)
		}
	}
	for _, flowNodeType := range []FlowNodeType{FlowNodeShutdown, FlowNodeScheduler, FlowNodeGateway} {
		if flowNodeType.IsTask() {
			t.Errorf("%s: a task, and it describes no work", flowNodeType)
		}
		if !flowNodeType.RunsItself() {
			t.Errorf("%s: neither a task nor played by the run itself", flowNodeType)
		}
	}
}

// A card that is no task has nothing to send, and says so rather than panicking on a nil task.
func TestACardWithNoTaskHasNoPrompt(t *testing.T) {
	shutdown := FlowNode{Type: FlowNodeShutdown}
	if shutdown.Prompt() != "" || shutdown.ConversationID() != "" || !shutdown.Settings().Empty() {
		t.Errorf("a Shutdown answers %q / %q / %+v, want nothing at all",
			shutdown.Prompt(), shutdown.ConversationID(), shutdown.Settings())
	}
	if err := shutdown.Runnable(); err != nil {
		t.Errorf("a Shutdown is not runnable: %v", err)
	}
}
