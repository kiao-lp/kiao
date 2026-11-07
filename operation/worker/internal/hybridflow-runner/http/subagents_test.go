package runnerhttp

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"strings"
	"testing"
	"time"
)

// The turn's delegation becomes the record's, timestamped like the turn's own blocks and
// descending into the child's own.
func TestSubagentToRecordFilesTheDelegationWhole(t *testing.T) {
	at := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	sub := &agentapi.TurnSubagent{
		SubagentID: "sub-1", ChildSessionID: "ses-child",
		Role: "researcher", Objective: "find the bug", Status: "completed",
		Result: "it was the cache", DurationMs: 9000,
		Blocks: []agentapi.TurnBlock{
			{Kind: agentapi.BlockKindThinking, Text: "where would I hide", At: at},
			{Kind: agentapi.BlockKindToolUse, Name: "Read", Input: "x", ToolUseID: "call-1", At: at},
		},
	}
	rec := pkgConversations.SubagentToRecord(sub)
	if rec == nil {
		t.Fatal("subagentToRecord = nil, want the delegation filed")
	}
	if rec.Role != "researcher" || rec.Objective != "find the bug" || rec.Status != "completed" ||
		rec.Result != "it was the cache" || rec.DurationMs != 9000 {
		t.Errorf("metadata = %+v, want the delegation's own", rec)
	}
	if rec.SubagentID != "sub-1" || rec.ChildSessionID != "ses-child" {
		t.Errorf("handles = %q/%q, want the durable id and the child's session",
			rec.SubagentID, rec.ChildSessionID)
	}
	if len(rec.Blocks) != 2 || rec.Blocks[0].Kind != agentapi.BlockKindThinking ||
		rec.Blocks[1].Kind != agentapi.BlockKindToolUse {
		t.Fatalf("blocks = %+v, want the child's own in order", rec.Blocks)
	}
	if rec.Blocks[0].At == "" || rec.Blocks[1].ToolUseID != "call-1" {
		t.Errorf("blocks = %+v, want them timestamped and joined like the turn's own", rec.Blocks)
	}
	if rec.Truncated {
		t.Error("Truncated = true, want a whole transcript filed whole")
	}
	if pkgConversations.SubagentToRecord(nil) != nil {
		t.Error("subagentToRecord(nil) != nil, want nothing filed for no delegation")
	}
}

// A block files its delegation beside its own fields — and a block that holds none files none.
func TestBlockToRecordCarriesTheDelegation(t *testing.T) {
	with := pkgConversations.BlockToRecord(agentapi.TurnBlock{Kind: agentapi.BlockKindSubagent, Text: "child did things",
		Subagent: &agentapi.TurnSubagent{SubagentID: "sub-1"}})
	if with.Kind != agentapi.BlockKindSubagent || with.Text != "child did things" {
		t.Errorf("block = %+v, want the delegation where it happened", with)
	}
	if with.Subagent == nil || with.Subagent.SubagentID != "sub-1" {
		t.Errorf("subagent = %+v, want what the child thought and did", with.Subagent)
	}
	without := pkgConversations.BlockToRecord(agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "plain"})
	if without.Subagent != nil {
		t.Errorf("subagent = %+v, want none on a block that holds none", without.Subagent)
	}
}

// One child's transcript is bounded like the turn's own: the newest blocks are kept and the
// delegation says it was cut.
func TestCapSubagentBlocksKeepsTheNewest(t *testing.T) {
	blocks := make([]agentapi.TurnBlock, 0, agentapi.MaxSubagentBlocks+10)
	for i := 0; i < agentapi.MaxSubagentBlocks+10; i++ {
		blocks = append(blocks, agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: string(rune('a' + i%26))})
	}
	kept, cut := agentapi.CapSubagentBlocks(blocks)
	if !cut || len(kept) != agentapi.MaxSubagentBlocks {
		t.Fatalf("kept %d blocks cut=%v, want the newest %d", len(kept), cut, agentapi.MaxSubagentBlocks)
	}
	if kept[0].Text != blocks[10].Text {
		t.Error("the oldest blocks go rather than the newest")
	}
	if kept, cut := agentapi.CapSubagentBlocks(blocks[:10]); cut || len(kept) != 10 {
		t.Errorf("a short transcript is filed whole, got %d blocks cut=%v", len(kept), cut)
	}
}

// A delegation filed metadata-only is who was asked and to do what, marked truncated so no
// reader mistakes it for a child that did nothing.
func TestMetadataSubagentMarksTheGap(t *testing.T) {
	sub := agentapi.MetadataSubagent(agentapi.SubagentRef{SubagentID: "sub-1", ChildSessionID: "ses-child",
		Role: "r", Objective: "o", Status: "running", Summary: "s", DurationMs: 5})
	if !sub.Truncated || len(sub.Blocks) != 0 {
		t.Errorf("sub = %+v, want metadata-only and marked", sub)
	}
	if sub.Role != "r" || sub.Objective != "o" || sub.Status != "running" ||
		sub.Result != "s" || sub.DurationMs != 5 {
		t.Errorf("sub = %+v, want the parent's account of the delegation", sub)
	}
}

// The reply's derived text reads a delegation as its own line — what a turn that handed its work
// over has always read as, now as when a delegation was folded to a bare line.
func TestBlockTextReadsADelegationAsItsLine(t *testing.T) {
	rec := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindText, Text: "before "},
		{Kind: agentapi.BlockKindSubagent, Text: "child did things",
			Subagent: &pkgConversations.ConversationSubagent{Blocks: []pkgConversations.ConversationBlock{
				{Kind: agentapi.BlockKindText, Text: "the child's own paragraph"},
			}}},
		{Kind: agentapi.BlockKindText, Text: " after"},
	}}
	if got := rec.BlockText(); got != "before child did things after" {
		t.Errorf("blockText = %q, want the delegation's line in place", got)
	}
	if got := rec.BlockTail(); got != " after" {
		t.Errorf("blockTail = %q, want the last line said", got)
	}
	tail := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindSubagent, Text: "child did things"},
	}}
	if got := tail.BlockTail(); got != "child did things" {
		t.Errorf("blockTail = %q, want a delegation the turn ended on", got)
	}
}

// The flat tool list holds what the turn did through its children too, where the delegation
// stands — a reader that knows no subagents still sees every call.
func TestBlockToolsCollectsTheChildrensCalls(t *testing.T) {
	rec := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindToolUse, Name: "Bash", Input: "ls"},
		{Kind: agentapi.BlockKindSubagent, Subagent: &pkgConversations.ConversationSubagent{Blocks: []pkgConversations.ConversationBlock{
			{Kind: agentapi.BlockKindToolUse, Name: "Read", Input: "x"},
			{Kind: agentapi.BlockKindSubagent, Subagent: &pkgConversations.ConversationSubagent{Blocks: []pkgConversations.ConversationBlock{
				{Kind: agentapi.BlockKindToolUse, Name: "Grep", Input: "y"},
			}}},
		}}},
	}}
	tools := rec.BlockTools()
	if len(tools) != 3 || tools[0].Name != "Bash" || tools[1].Name != "Read" || tools[2].Name != "Grep" {
		t.Errorf("tools = %+v, want the turn's and its children's in order", tools)
	}
}

// A delegation's blocks draw on the record's own budgets: past the tool cap the oldest calls go —
// the child's with them — and the delegation says it was cut along with the record.
func TestCapBlocksSpendsTheBudgetsInsideDelegations(t *testing.T) {
	child := []pkgConversations.ConversationBlock{}
	for i := 0; i < 10; i++ {
		child = append(child, pkgConversations.ConversationBlock{Kind: agentapi.BlockKindToolUse, Name: "Read"})
	}
	rec := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindSubagent, Text: "child did things",
			Subagent: &pkgConversations.ConversationSubagent{Blocks: child}},
	}}
	for i := 0; i < pkgConversations.MaxRecordTools; i++ {
		rec.Blocks = append(rec.Blocks, pkgConversations.ConversationBlock{Kind: agentapi.BlockKindToolUse, Name: "Bash"})
	}
	capped := pkgConversations.CapBlocks(rec)
	// Walked backwards, the parent's own calls spend the budget first: the child's ten are the
	// oldest and go, and the delegation's list is empty rather than dropped.
	sub := capped.Blocks[0].Subagent
	if sub == nil || len(sub.Blocks) != 0 || !sub.Truncated {
		t.Fatalf("subagent = %+v, want its calls cut and marked", sub)
	}
	if !capped.Truncated {
		t.Error("Truncated = false, want the record marked with its delegation")
	}
	if got := len(capped.Blocks); got != pkgConversations.MaxRecordTools+1 {
		t.Errorf("%d blocks kept, want the delegation and the newest %d calls", got, pkgConversations.MaxRecordTools)
	}
}

// A child's dumped file is as unbounded as its parent's: results are held to what a transcript
// can show however deep the call sits.
func TestCapBlocksHoldsNestedResults(t *testing.T) {
	rec := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindSubagent, Subagent: &pkgConversations.ConversationSubagent{Blocks: []pkgConversations.ConversationBlock{
			{Kind: agentapi.BlockKindToolUse, Name: "Bash", Result: strings.Repeat("x", protocol.MaxBlockResultChars+10)},
		}}},
	}}
	capped := pkgConversations.CapBlocks(rec)
	got := capped.Blocks[0].Subagent.Blocks[0].Result
	if len([]rune(got)) > protocol.MaxBlockResultChars+len([]rune(protocol.TruncationMarker)) {
		t.Errorf("nested result kept %d runes, want it held to the cap", len([]rune(got)))
	}
	if !capped.Truncated {
		t.Error("Truncated = false, want the record marked")
	}
}

// A record with no delegations caps exactly as before: the budgets, the newest-wins cuts and the
// marker are untouched by the nesting.
func TestCapBlocksWithoutDelegationsIsUnchanged(t *testing.T) {
	rec := pkgConversations.ConversationRecord{Blocks: []pkgConversations.ConversationBlock{
		{Kind: agentapi.BlockKindText, Text: "old"},
		{Kind: agentapi.BlockKindToolUse, Name: "Bash"},
		{Kind: agentapi.BlockKindText, Text: "new"},
	}}
	capped := pkgConversations.CapBlocks(rec)
	if capped.Truncated || len(capped.Blocks) != 3 {
		t.Fatalf("blocks = %+v truncated=%v, want the reply untouched", capped.Blocks, capped.Truncated)
	}
}

// The wire carries a delegation whole: the metadata beside the parent's line, and the child's
// own blocks beneath — with their nested delegations the same way.
func TestWireBlockCarriesADelegationWhole(t *testing.T) {
	frame := agentapi.WireBlock(agentapi.TurnBlock{Kind: agentapi.BlockKindSubagent, Text: "child did things",
		Subagent: &agentapi.TurnSubagent{SubagentID: "sub-1", ChildSessionID: "ses-child",
			Role: "r", Objective: "o", Status: "completed", Result: "done",
			Blocks: []agentapi.TurnBlock{{Kind: agentapi.BlockKindThinking, Text: "hmm"}}}})
	if frame["kind"] != agentapi.BlockKindSubagent || frame["text"] != "child did things" {
		t.Fatalf("frame = %+v, want the delegation where it happened", frame)
	}
	sub, _ := frame["subagent"].(map[string]any)
	if sub["subagentId"] != "sub-1" || sub["childSessionId"] != "ses-child" ||
		sub["role"] != "r" || sub["objective"] != "o" ||
		sub["status"] != "completed" || sub["result"] != "done" {
		t.Errorf("subagent = %+v, want the delegation's metadata", sub)
	}
	blocks, _ := sub["blocks"].([]any)
	if len(blocks) != 1 {
		t.Fatalf("blocks = %+v, want the child's own", sub["blocks"])
	}
	first, _ := blocks[0].(map[string]any)
	if first["kind"] != agentapi.BlockKindThinking || first["text"] != "hmm" {
		t.Errorf("first = %+v, want what the child thought", first)
	}
}

// A delegation reaches a live turn as its own frame, saying where in the reply it belongs.
func TestBlockFrameAnnouncesADelegation(t *testing.T) {
	frame := pkgTurns.BlockFrame(3, agentapi.TurnBlock{Kind: agentapi.BlockKindSubagent, Text: "child did things",
		Subagent: &agentapi.TurnSubagent{SubagentID: "sub-1"}})
	if frame["type"] != "subagent" || frame["index"] != 3 || frame["kind"] != agentapi.BlockKindSubagent {
		t.Fatalf("frame = %+v, want the delegation announced at its index", frame)
	}
	sub, _ := frame["subagent"].(map[string]any)
	if sub["subagentId"] != "sub-1" {
		t.Errorf("subagent = %+v, want the delegation carried", sub)
	}
}

// The transcript endpoint reports a delegation the way the socket does: the same metadata, the
// same nested blocks.
func TestBlockDtoOfReportsADelegation(t *testing.T) {
	dto := pkgConversations.BlockDtoOf(pkgConversations.ConversationBlock{Kind: agentapi.BlockKindSubagent, Text: "child did things",
		Subagent: &pkgConversations.ConversationSubagent{SubagentID: "sub-1", Status: "completed",
			Blocks: []pkgConversations.ConversationBlock{{Kind: agentapi.BlockKindToolUse, Name: "Read", Input: "x"}}}})
	if dto.Kind != agentapi.BlockKindSubagent || dto.Text != "child did things" {
		t.Fatalf("dto = %+v, want the delegation where it happened", dto)
	}
	if dto.Subagent == nil || dto.Subagent.SubagentID != "sub-1" || dto.Subagent.Status != "completed" {
		t.Fatalf("subagent = %+v, want the delegation's metadata", dto.Subagent)
	}
	if len(dto.Subagent.Blocks) != 1 || dto.Subagent.Blocks[0].Name != "Read" {
		t.Errorf("blocks = %+v, want what the child did", dto.Subagent.Blocks)
	}
	plain := pkgConversations.BlockDtoOf(pkgConversations.ConversationBlock{Kind: agentapi.BlockKindText, Text: "plain"})
	if plain.Subagent != nil {
		t.Errorf("subagent = %+v, want none on a block that holds none", plain.Subagent)
	}
}
