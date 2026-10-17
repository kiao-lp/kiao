package hybridflowrunner

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

// The board as this service reads it: one list of cards, each carrying an id of its own. Reading
// is forgiving — a card may have been hand-written, produced by a turn or pasted in from another
// instance — and writing is narrow: what goes back is the shape below, with everything that says
// nothing left out.

const boardFixture = `{"flowNodes":[
  {"id":"flow-node-1","title":"Write the plan","type":"ai","body":"The objective.",
   "settings":{"model":"opus","effort":"high","permission":"manualLive","folder":"/"},
   "onSuccess":{"flowNode":"flow-node-2","mode":"continue","compact":true}},
  {"id":"flow-node-2","title":"Ship it"}
]}`

// readBoard reads service-shaped JSON the way a board off the wire is read.
func readBoard(t *testing.T, source string) *boardContent {
	t.Helper()
	var board boardContent
	if err := json.Unmarshal([]byte(source), &board); err != nil {
		t.Fatalf("read: %v", err)
	}
	return &board
}

func TestFlowNodeReadingIsForgiving(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"title":"No id at all","type":"ai","status":"whatever","settings":{},"onSuccess":"flow-node-9"},
		{"id":" flow-node-2 ","title":"Legacy compact","type":"ai","onSuccess":{"flowNode":"flow-node-1","compact":true}},
		{"id":"flow-node-3","title":"Unreadable link","onSuccess":42},
		{"id":"flow-node-4","title":"Still being written","status":"draft"},
		{"id":"flow-node-5","title":"Stopped part-way","status":" interrupted "},
		{"id":"flow-node-6","title":"Waiting","status":"ready"},
		{"id":"flow-node-7","title":"Waiting on somebody else","status":"blocked"}
	]}`)
	flowNodes := board.FlowNodes
	if flowNodes[0].ID == "" {
		t.Error("a flow node written without an id must be given one, or nothing can be keyed on it")
	}
	if flowNodes[0].Status != "" {
		t.Errorf("status = %q, want an unknown one read as ready", flowNodes[0].Status)
	}
	if flowNodes[3].Status != flowNodeStatusDraft || flowNodes[4].Status != flowNodeStatusInterrupted {
		t.Errorf("statuses = %q and %q, want the words this build knows read as themselves",
			flowNodes[3].Status, flowNodes[4].Status)
	}
	if flowNodes[5].Status != "" {
		t.Errorf("status = %q, want `ready` held as no status", flowNodes[5].Status)
	}
	// The user's own word for a card held up by something off the board: nothing here writes it and
	// nothing here clears it, so the whole of what this end owes it is to carry it.
	if flowNodes[6].Status != flowNodeStatusBlocked {
		t.Errorf("status = %q, want a blocked card kept blocked", flowNodes[6].Status)
	}
	if !flowNodes[0].Settings.empty() || flowNodes[0].Settings.playable() {
		t.Errorf("settings = %+v, want an empty object read as no settings at all", flowNodes[0].Settings)
	}
	if flowNodes[0].OnSuccess.FlowNode != "flow-node-9" || flowNodes[0].OnSuccess.Mode != transitionContinue {
		t.Errorf("onSuccess = %+v, want a bare id read as the flow node it names", flowNodes[0].OnSuccess)
	}
	if flowNodes[1].ID != "flow-node-2" {
		t.Errorf("id = %q, want it trimmed", flowNodes[1].ID)
	}
	if flowNodes[1].OnSuccess.Mode != transitionContinue || !flowNodes[1].OnSuccess.Compact {
		t.Errorf("onSuccess = %+v, want `compact: true` read as the chat shortened and carried on",
			flowNodes[1].OnSuccess)
	}
	if flowNodes[2].OnSuccess.FlowNode != "" {
		t.Errorf("onSuccess = %+v, want an unreadable link read as no link at all", flowNodes[2].OnSuccess)
	}
}

// Everything that says nothing is left out, so a card stays a thing a person reads.
func TestFlowNodeWritesNothingItDoesNotHave(t *testing.T) {
	data, err := json.Marshal(flowNode{ID: "flow-node-1", Title: "Plain"})
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"id":"flow-node-1","title":"Plain"}` {
		t.Errorf("flow node = %s, want the two fields it actually has", data)
	}
}

func TestFlowNodeRunIsReadAndWritten(t *testing.T) {
	var held flowNode
	if err := json.Unmarshal([]byte(`{"id":"flow-node-1","status":"running","run":"run-1"}`), &held); err != nil {
		t.Fatal(err)
	}
	if held.Run != "run-1" {
		t.Errorf("run = %q, want the run holding the card", held.Run)
	}
	data, err := json.Marshal(held)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"id":"flow-node-1","title":"","status":"running","run":"run-1"}` {
		t.Errorf("flow node = %s, want the claim carried beside the status", data)
	}
	free, err := json.Marshal(flowNode{ID: "flow-node-1", Title: "Plain"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(free), `"run"`) {
		t.Errorf("flow node = %s, want no claim on a free card", free)
	}
}

func TestBoardBoardEdits(t *testing.T) {
	board := readBoard(t, boardFixture)

	if !board.setChat("flow-node-1", "conv-1") || board.flowNode("flow-node-1").Chat != "conv-1" {
		t.Error("setChat must write the conversation the flow node is played in")
	}
	if board.setChat("flow-node-1", "conv-1") {
		t.Error("setChat must report that a chat already written changed nothing")
	}
	// Taking the flow node marks it: the board says what a running turn was told while the turn is
	// still running, in the description it holds, not once it is over.
	if !board.start("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusRunning {
		t.Fatal("start must mark the flow node a play has taken")
	}
	// A second round of the same play — the prompt sent again after an error worth waiting out —
	// writes nothing: the flow node is already being played, and it is the same play.
	if board.start("flow-node-1") {
		t.Error("start must write nothing where a play already holds the flow node")
	}
	if !board.complete("flow-node-1") {
		t.Fatal("complete must mark the flow node done")
	}
	flowNode := board.flowNode("flow-node-1")
	if flowNode.Status != flowNodeStatusDone {
		t.Errorf("status = %q, want the flow node marked done", flowNode.Status)
	}
	// The description stays where it is: what the turn said is in the conversation the card names.
	if flowNode.Body != "The objective." {
		t.Errorf("body = %q, want the description kept", flowNode.Body)
	}
	// Played again, as it stands: the description was never taken away, so nothing has to be
	// written back before the next play.
	if !board.start("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusRunning {
		t.Error("start must mark the card taken again for its next play")
	}
	if !board.complete("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Error("complete must mark the card done again")
	}
	// A card nobody sends a prompt for is marked all the same.
	if !board.start("flow-node-2") || board.flowNode("flow-node-2").Status != flowNodeStatusRunning {
		t.Error("start must mark the flow node a play has taken")
	}
	if !board.interrupt("flow-node-2") ||
		board.flowNode("flow-node-2").Status != flowNodeStatusInterrupted {
		t.Error("interrupt must mark the stopped flow node, not fail it")
	}
	if !board.fail("flow-node-2") || board.flowNode("flow-node-2").Status != flowNodeStatusError {
		t.Error("fail must mark the flow node")
	}
	if board.flowNode("no-such-flow-node") != nil || board.setStatus("no-such-flow-node", flowNodeStatusDone) {
		t.Error("a flow node that is not on the board is not found and is not written")
	}
}

// A flow node held until Claude's usage limit lifts says so, and comes back to being worked on: it
// is the same play holding the same flow node.
func TestBoardBoardHoldsAndReopensOnePlay(t *testing.T) {
	board := &boardContent{
		FlowNodes: []flowNode{{ID: "flow-node-1", Title: "First", Type: flowNodeTypeAI, Body: "The objective."}},
	}

	board.start("flow-node-1")
	if !board.hold("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusWaitingRefresh {
		t.Fatal("hold must say the card is waiting for the limit to refresh rather than being worked on")
	}
	if !board.reopen("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusRunning {
		t.Fatal("reopen must put the card back to being worked on once the limit has lifted")
	}
	if !board.complete("flow-node-1") || board.flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Error("complete must mark the flow node done")
	}
	if body := board.flowNode("flow-node-1").Body; body != "The objective." {
		t.Errorf("body = %q, want the description kept, however long the limit held the play", body)
	}
}

// Every ending keeps its description: the card still asks what it was asking, so it is played again
// as it stands. What the turn said is in the conversation the card names.
func TestEndingsKeepTheDescriptionToBeAskedAgain(t *testing.T) {
	board := readBoard(t, boardFixture)
	if !board.fail("flow-node-1") {
		t.Fatal("fail must mark the flow node")
	}
	if body := board.flowNode("flow-node-1").Body; body != "The objective." {
		t.Errorf("body = %q, want the description kept for a flow node nothing came back for", body)
	}
}

// The prompt is the description — or, where there is none, the title — and the success
// criteria, always, where there are any. The title is the card's name — read on the board, named
// by a chain — and it used to be the prompt's first line as well, so a flow node played twice
// sent it twice.
func TestFlowNodePromptIsTheDescriptionAlone(t *testing.T) {
	prompt := flowNodePrompt(flowNode{Title: " Write the plan ", Body: "## Objective\n\nDo it.\n"})
	if prompt != "## Objective\n\nDo it." {
		t.Errorf("prompt = %q, want the description and nothing else", prompt)
	}
	// A card with an empty box is still asked on its name: the title stands in for the missing
	// description.
	titled := flowNode{Title: "Bare"}
	if got := flowNodePrompt(titled); got != "Bare" {
		t.Errorf("prompt = %q, want the title for a flow node with no description", got)
	}
	if !titled.hasPrompt() {
		t.Error("a titled flow node has a prompt, and is played")
	}
	if (flowNode{Title: "  ", Body: " \n "}).hasPrompt() {
		t.Error("a flow node with no title, no description and no criteria has no prompt")
	}
	if !(flowNode{Body: "Do it."}).hasPrompt() {
		t.Error("a flow node with a description has a prompt")
	}
	// The criteria go out with whatever base they go out with — the description, the title
	// standing in for one, or on their own.
	measured := flowNode{Title: "Write the plan", Body: "Go on.",
		Criteria: []successCriterion{{ID: "c1", Text: "It holds"}, {ID: "c2", Text: "It reads well"}}}
	if got := flowNodePrompt(measured); got !=
		"Go on.\n\nSuccess criteria:\n- It holds\n- It reads well" {
		t.Errorf("prompt = %q, want the description and the criteria", got)
	}
	if got := flowNodePrompt(flowNode{Title: "Write the plan",
		Criteria: []successCriterion{{ID: "c1", Text: "It holds"}}}); got !=
		"Write the plan\n\nSuccess criteria:\n- It holds" {
		t.Errorf("prompt = %q, want the title and the criteria", got)
	}
	bare := flowNode{Criteria: []successCriterion{{ID: "c1", Text: "It holds"}}}
	if got := flowNodePrompt(bare); got != "Success criteria:\n- It holds" {
		t.Errorf("prompt = %q, want the criteria on their own", got)
	}
	if !bare.hasPrompt() {
		t.Error("a flow node with only a criterion has a prompt, and is played")
	}
}

// The type a card is read as where it says none: a named agent makes it an agent's, a named
// model beside no agent is what a card written before managed agents says, and nothing at all is
// a person's.
func TestFlowNodeTypeOf(t *testing.T) {
	cases := []struct {
		name     string
		said     string
		settings flowNodeSettings
		want     string
	}{
		{"explicit", flowNodeTypeAI, flowNodeSettings{}, flowNodeTypeAI},
		{"explicit human", flowNodeTypeHuman, flowNodeSettings{Agent: "agent-1"}, flowNodeTypeHuman},
		{"agent", "", flowNodeSettings{Agent: "agent-1"}, flowNodeTypeAI},
		{"legacy engine and model", "", flowNodeSettings{Agent: "claude", Model: "opus"}, flowNodeTypeAI},
		{"legacy model alone", "", flowNodeSettings{Model: "opus"}, flowNodeTypeAI},
		{"nothing", "", flowNodeSettings{}, flowNodeTypeHuman},
	}
	for _, c := range cases {
		if got := flowNodeTypeOf(c.said, c.settings); got != c.want {
			t.Errorf("%s: type = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestBoardSettingsFolder(t *testing.T) {
	for settings, want := range map[string]string{
		"/":                  "",
		"":                   "",
		"exchange/dashboard": "exchange/dashboard",
		"/units/":            "units",
	} {
		if got := (flowNodeSettings{Folder: settings}).folder(); got != want {
			t.Errorf("folder(%q) = %q, want %q", settings, got, want)
		}
	}
	full := flowNodeSettings{Agent: "agent-1", Effort: "high", Permission: "manual", Folder: "/"}
	if !full.playable() {
		t.Error("a flow node naming all four settings is playable")
	}
	// The legacy model is no part of the answer: a card written before managed agents, naming an
	// engine with a model beside it, is playable exactly as it always was.
	legacy := flowNodeSettings{Agent: "claude", Model: "opus", Effort: "high", Permission: "manual", Folder: "/"}
	if !legacy.playable() {
		t.Error("a legacy card naming an engine and a model is playable")
	}
	for _, missing := range []flowNodeSettings{
		{Effort: "high", Permission: "manual", Folder: "/"},
		{Agent: "agent-1", Permission: "manual", Folder: "/"},
		{Agent: "agent-1", Effort: "high", Folder: "/"},
		{Agent: "agent-1", Effort: "high", Permission: "manual"},
	} {
		if missing.playable() {
			t.Errorf("settings = %+v, want part of the set to be no more a choice than none of it", missing)
		}
	}
}

// The transition mode: what becomes of the conversation once a flow node is done. Two of the three
// say the flow node is Claude's, and `end` — the one that assumes nothing — is what a card says
// by saying nothing. `shutdown` was a fourth answer before it was a card of its own: a word this
// build has no meaning for is somebody having answered, so it reads as the answer that claims
// nothing rather than as the legacy default an *unanswered* chain meant.
func TestBoardTransitionModeIsRead(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Carries on","type":"ai","onSuccess":{"flowNode":"flow-node-9","mode":"continue"}},
		{"id":"flow-node-2","title":"Ends there","type":"ai","onSuccess":{"flowNode":"flow-node-9","mode":"end"}},
		{"id":"flow-node-3","title":"The retired mode","type":"ai","onSuccess":{"mode":"shutdown"}},
		{"id":"flow-node-4","title":"Said nothing","type":"ai"},
		{"id":"flow-node-5","title":"A word nobody knows","type":"ai","onSuccess":{"flowNode":"flow-node-9","mode":"shorten"}}
	]}`)
	flowNodes := board.FlowNodes
	for i, want := range []string{
		transitionContinue, transitionEnd, transitionEnd, transitionEnd, transitionEnd,
	} {
		if flowNodes[i].OnSuccess.Mode != want {
			t.Errorf("%q: mode = %q, want %q", flowNodes[i].Title, flowNodes[i].OnSuccess.Mode, want)
		}
	}
	if flowNodes[0].OnSuccess.carriesChat() == flowNodes[1].OnSuccess.carriesChat() {
		t.Error("carrying the chat on and ending it are not the same thing")
	}
	if flowNodes[2].OnSuccess.carriesChat() {
		t.Error("a machine going off hands no conversation to anybody")
	}
}

// `chat` is what the mode was called while it only spoke about conversations, and `compact` was a
// word of that field before it was a field of its own again. The retired one is read only beside a
// named flow node, which is the only place it ever meant anything — and, like the mode itself, only
// on the one type that has a chat.
func TestBoardTransitionModeReadsTheSpellingsItReplaced(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Chat field","type":"ai","onSuccess":{"flowNode":"flow-node-9","chat":"end"}},
		{"id":"flow-node-2","title":"Compact flag","type":"ai","onSuccess":{"flowNode":"flow-node-9","compact":true}},
		{"id":"flow-node-3","title":"Chained, unsaid","type":"ai","onSuccess":{"flowNode":"flow-node-9"}},
		{"id":"flow-node-4","title":"Unchained, unsaid","type":"ai","onSuccess":{"chat":"compact"}},
		{"id":"flow-node-5","title":"The word that split","type":"ai","onSuccess":{"flowNode":"flow-node-9","mode":"compact"}}
	]}`)
	flowNodes := board.FlowNodes
	for i, want := range []struct {
		mode    string
		compact bool
	}{
		{transitionEnd, false},
		{transitionContinue, true},
		{transitionContinue, false},
		{transitionEnd, false},
		{transitionContinue, true},
	} {
		if flowNodes[i].OnSuccess.Mode != want.mode || flowNodes[i].OnSuccess.Compact != want.compact {
			t.Errorf("%q: onSuccess = %+v, want mode %q and compact %v",
				flowNodes[i].Title, flowNodes[i].OnSuccess, want.mode, want.compact)
		}
	}
}

// The type is a field, and a card that says none is read the way cards were read before it
// existed: a named model makes the card AI, and nothing at all makes it Human.
func TestFlowNodeTypeIsRead(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Said","type":"shutdown"},
		{"id":"flow-node-2","title":"Waits","type":"Scheduler","at":"2026-09-03T22:00"},
		{"id":"flow-node-3","title":"Older AI","settings":{"agent":"claude","model":"opus"}},
		{"id":"flow-node-4","title":"Older Human"},
		{"id":"flow-node-5","title":"A word nobody knows","type":"robot","settings":{"agent":"claude","model":"opus"}},
		{"id":"flow-node-6","title":"Join","type":"gateway"}
	]}`)
	flowNodes := board.FlowNodes
	for i, want := range []string{
		flowNodeTypeShutdown, flowNodeTypeScheduler, flowNodeTypeAI, flowNodeTypeHuman, flowNodeTypeAI,
		flowNodeTypeGateway,
	} {
		if flowNodes[i].Type != want {
			t.Errorf("%q: type = %q, want %q", flowNodes[i].Title, flowNodes[i].Type, want)
		}
	}
	if flowNodes[1].At != "2026-09-03T22:00" {
		t.Errorf("at = %q, want the datetime the card says", flowNodes[1].At)
	}
	// The three the board plays to itself are the three it can take without a turn.
	if !flowNodes[0].runnable() || !flowNodes[1].runnable() || !flowNodes[5].runnable() || flowNodes[3].runnable() {
		t.Error("a Shutdown, an answered Scheduler and a Gateway are runnable; a Human card is not")
	}
}

// A field nothing shows and nothing can reach would sit on the card marking it as broken
// with no control to fix it on, so what a card says is read against the type it is.
func TestFlowNodeFieldsAreReadAgainstTheType(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Human","onSuccess":{"flowNode":"flow-node-9","mode":"continue","compact":true}},
		{"id":"flow-node-2","title":"Waits","type":"scheduler","at":"2026-09-03T22:00",
		 "onSuccess":{"flowNode":"flow-node-9","mode":"continue"}},
		{"id":"flow-node-3","title":"Off","type":"shutdown","onSuccess":{"flowNode":"flow-node-9","mode":"continue"}}
	]}`)
	flowNodes := board.FlowNodes
	for _, flowNode := range flowNodes {
		if flowNode.OnSuccess.Mode != transitionEnd {
			t.Errorf("%q: mode = %q, want a card that is not AI claiming no conversation",
				flowNode.Title, flowNode.OnSuccess.Mode)
		}
	}
	// The chain is untouched on every type but a Shutdown, which ends the board.
	if flowNodes[0].OnSuccess.FlowNode != "flow-node-9" || flowNodes[1].OnSuccess.FlowNode != "flow-node-9" {
		t.Error("a chain is the order somebody wrote down whoever plays the cards")
	}
	if flowNodes[2].OnSuccess.FlowNode != "" {
		t.Errorf("onSuccess = %+v, want nothing named after a Shutdown", flowNodes[2].OnSuccess)
	}
}

// The shutdown box was a fifth setting once, and a transition mode after that. It means nothing
// here either way, so it reads as nothing like every other key this build has no meaning for.
func TestBoardRetiredShutdownBoxIsDropped(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Boolean","settings":{"shutdown":true}}
	]}`)
	flowNode := board.FlowNodes[0]
	if !flowNode.Settings.empty() {
		t.Errorf("settings = %+v, want the retired key read as nothing", flowNode.Settings)
	}
	written, err := json.Marshal(flowNode)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(string(written), "shutdown") || strings.Contains(string(written), "settings") {
		t.Errorf("flow node = %s, want the retired key gone from the card", written)
	}
}

// Unsaid is the one thing the mode cannot mean: a chain written before it existed meant *carry the
// chat on*, and a chain meaning to end the conversation would read exactly the same way.
func TestBoardTransitionModeIsAlwaysWritten(t *testing.T) {
	chained, err := json.Marshal(flowNode{ID: "t", Title: "Plan",
		OnSuccess: flowNodeSuccess{FlowNode: "flow-node-9", Mode: transitionEnd}})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.Contains(string(chained), `"onSuccess":{"flowNode":"flow-node-9","mode":"end"}`) {
		t.Errorf("flow node = %s, want the mode said on the chain it was written with", chained)
	}
	alone, err := json.Marshal(flowNode{ID: "t", Title: "Shortens its chat and ends it",
		OnSuccess: flowNodeSuccess{Mode: transitionEnd, Compact: true}})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !strings.Contains(string(alone), `"onSuccess":{"mode":"end","compact":true}`) {
		t.Errorf("flow node = %s, want what the card says about its chat with no flow node after it", alone)
	}
	quiet, err := json.Marshal(flowNode{ID: "t", Title: "Nothing to say",
		OnSuccess: flowNodeSuccess{Mode: transitionEnd}})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(string(quiet), "onSuccess") {
		t.Errorf("flow node = %s, want what a flow node says by saying nothing left out", quiet)
	}
}

// The tags a card wears are read here for one reason: a board read back must still say what it
// said. Nothing in the service reads what they say — the words are the board's, and their colours
// are the store's, in `kiao-user-config/tags.json`.
func TestBoardTagsAreReadAndKept(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Filed","tags":["bug"," needs   review "]},
		{"id":"flow-node-2","title":"Said it twice","tags":["bug","BUG"]},
		{"id":"flow-node-3","title":"Nothing of the sort","tags":["ok","  "]},
		{"id":"flow-node-4","title":"Said nothing"}
	]}`)
	flowNodes := board.FlowNodes
	want := [][]string{{"bug", "needs review"}, {"bug"}, {"ok"}, nil}
	for i, flowNode := range flowNodes {
		if !slices.Equal(flowNode.Tags, want[i]) {
			t.Errorf("%q: tags = %v, want %v", flowNode.Title, flowNode.Tags, want[i])
		}
	}
}

// The criteria and the complexity are a task's, like the description: read where the card is
// one, dropped where it is not, and written back after the body, before the settings.
func TestBoardCriteriaAreReadAndKept(t *testing.T) {
	five := 5
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Measured","body":"Go.",
		 "criteria":[{"id":" c1 ","text":" It holds "},{"id":"c2","text":"   "},42],"complexity":5},
		{"id":"flow-node-2","title":"Off","type":"shutdown",
		 "criteria":[{"id":"c1","text":"Nothing measures this."}],"complexity":5},
		{"id":"flow-node-3","title":"Said nothing"}
	]}`)
	flowNodes := board.FlowNodes
	measured := flowNodes[0]
	if len(measured.Criteria) != 1 || measured.Criteria[0] != (successCriterion{ID: "c1", Text: "It holds"}) {
		t.Errorf("criteria = %+v, want the one measured line trimmed", measured.Criteria)
	}
	if measured.Complexity == nil || *measured.Complexity != five {
		t.Errorf("complexity = %v, want 5", measured.Complexity)
	}
	off := flowNodes[1]
	if len(off.Criteria) != 0 || off.Complexity != nil {
		t.Errorf("a Shutdown holds %+v / %v, want neither", off.Criteria, off.Complexity)
	}
	encoded, err := json.Marshal(measured)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if string(encoded) != `{"id":"flow-node-1","title":"Measured","body":"Go.",`+
		`"criteria":[{"id":"c1","text":"It holds"}],"complexity":5}` {
		t.Errorf("flow node = %s, want the two after the body", encoded)
	}
	bare, err := json.Marshal(flowNodes[2])
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(string(bare), "criteria") || strings.Contains(string(bare), "complexity") {
		t.Errorf("flow node = %s, want nothing said about a task holding neither", bare)
	}
}

// Written before the body, which is the length of the card, and not written at all for a card
// wearing none.
func TestBoardTagsAreWrittenOnlyWhereACardWearsOne(t *testing.T) {
	filed, err := json.Marshal(flowNode{ID: "t", Title: "Plan", Tags: []string{"bug"}, Body: "Text"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if string(filed) != `{"id":"t","title":"Plan","tags":["bug"],"body":"Text"}` {
		t.Errorf("flow node = %s, want the words before the body", filed)
	}
	bare, err := json.Marshal(flowNode{ID: "t", Title: "Plan"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(string(bare), "tags") {
		t.Errorf("flow node = %s, want nothing said about a card wearing none", bare)
	}
}

// Where a card sits on the board is read with it. Nothing here reads it — it is the board's, like
// the tags — and it travels with the card like they do.
func TestBoardSpotIsReadAndKept(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Placed","spot":{"x":320,"y":160.4}},
		{"id":"flow-node-2","title":"Not placed"},
		{"id":"flow-node-3","title":"Nonsense","spot":{"x":"far","y":2}}
	]}`)
	flowNodes := board.FlowNodes
	if flowNodes[0].Spot == nil || flowNodes[0].Spot.X != 320 || flowNodes[0].Spot.Y != 160 {
		t.Errorf("placed card = %v, want the point it was written at, rounded", flowNodes[0].Spot)
	}
	// A card nobody has placed, and one whose point cannot be read, are the same thing: no point.
	// Reading is forgiving here as it is everywhere in this format.
	for _, flowNode := range flowNodes[1:] {
		if flowNode.Spot != nil {
			t.Errorf("%q: spot = %v, want none", flowNode.Title, flowNode.Spot)
		}
	}

	filed, err := json.Marshal(flowNodes[0])
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if string(filed) != `{"id":"flow-node-1","title":"Placed","spot":{"x":320,"y":160}}` {
		t.Errorf("flow node = %s, want the point written back where the board writes it", filed)
	}
	bare, err := json.Marshal(flowNodes[1])
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Contains(string(bare), "spot") {
		t.Errorf("flow node = %s, want nothing said about a card nobody has placed", bare)
	}
}

// A Gateway names its branches the list way: the single card beside them is read as none, and the
// list is kept cleaned — trimmed, emptied of empties, each kept once in the order said. One card
// follows every other kind, so a list said on one of those is read as none.
func TestGatewayBranchesAreReadAgainstTheType(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"gateway-1","title":"Join","type":"gateway",
		 "onSuccess":{"flowNode":"flow-node-9","flowNodes":[" b ","","b","a"],"mode":"continue"}},
		{"id":"flow-node-2","title":"Work","type":"ai",
		 "onSuccess":{"flowNode":"flow-node-9","flowNodes":["a"],"mode":"continue"}}
	]}`)
	join, work := board.FlowNodes[0], board.FlowNodes[1]
	if join.OnSuccess.FlowNode != "" {
		t.Errorf("gateway: single = %q, want none the single way", join.OnSuccess.FlowNode)
	}
	if len(join.OnSuccess.FlowNodes) != 2 ||
		join.OnSuccess.FlowNodes[0] != "b" || join.OnSuccess.FlowNodes[1] != "a" {
		t.Errorf("gateway: branches = %q, want the two cleaned, in order", join.OnSuccess.FlowNodes)
	}
	if join.OnSuccess.Mode != transitionEnd {
		t.Errorf("gateway: mode = %q, want a card with no conversation claiming none", join.OnSuccess.Mode)
	}
	if len(work.OnSuccess.FlowNodes) != 0 {
		t.Errorf("ai: branches = %q, want none on a card that is no gateway", work.OnSuccess.FlowNodes)
	}
	if work.OnSuccess.FlowNode != "flow-node-9" {
		t.Errorf("ai: single = %q, want the chain kept", work.OnSuccess.FlowNode)
	}
}

// What feeds into a card and what follows it: the join reads both namings — the single card and a
// Gateway's own branches — and the fork reads the branches in order, leaving out cards that left
// the board.
func TestBoardPredecessorsAndSuccessors(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"a","title":"A","onSuccess":{"flowNode":"g"}},
		{"id":"g1","title":"First join","type":"gateway","onSuccess":{"flowNodes":["g","gone"]}},
		{"id":"g","title":"Join","type":"gateway","onSuccess":{"flowNodes":["b","c"]}},
		{"id":"b","title":"B"},
		{"id":"c","title":"C","onSuccess":{"flowNode":"d"}},
		{"id":"d","title":"D"}
	]}`)
	preds := board.predecessorsOf("g")
	if len(preds) != 2 || preds[0].ID != "a" || preds[1].ID != "g1" {
		t.Errorf("predecessors = %v, want the single card and the gateway naming it", idsOf(preds))
	}
	succs := board.successorsOf(*board.flowNode("g"))
	if len(succs) != 2 || succs[0].ID != "b" || succs[1].ID != "c" {
		t.Errorf("successors = %v, want the two branches, in order", idsOf(succs))
	}
	first := board.successorsOf(*board.flowNode("g1"))
	if len(first) != 1 || first[0].ID != "g" {
		t.Errorf("successors = %v, want the card still there and not the one gone", idsOf(first))
	}
	single := board.successorsOf(*board.flowNode("a"))
	if len(single) != 1 || single[0].ID != "g" {
		t.Errorf("successors = %v, want the one card named the single way", idsOf(single))
	}
}

func idsOf(flowNodes []flowNode) []string {
	out := make([]string, 0, len(flowNodes))
	for _, flowNode := range flowNodes {
		out = append(out, flowNode.ID)
	}
	return out
}

// The tail of a run's chain is a forecast, and over a Gateway it fans out: every branch reads as
// ahead, breadth-first, so the panel draws what the firing will start.
func TestChainFromFansOutOverAGatewaysBranches(t *testing.T) {
	board := readBoard(t, `{"flowNodes":[
		{"id":"a","title":"A","onSuccess":{"flowNode":"g"}},
		{"id":"g","title":"Join","type":"gateway","onSuccess":{"flowNodes":["b","c"]}},
		{"id":"b","title":"B","onSuccess":{"flowNode":"d"}},
		{"id":"c","title":"C"},
		{"id":"d","title":"D"}
	]}`)
	chain := chainFrom(board, []string{"a"}, "g")
	var ids []string
	for _, entry := range chain {
		ids = append(ids, entry.ID)
	}
	want := []string{"a", "g", "b", "c", "d"}
	if len(ids) != len(want) {
		t.Fatalf("chain = %q, want %q", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("chain = %q, want %q", ids, want)
		}
	}
}
