package runnerhttp

import (
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"strings"
	"testing"
)

// One delegation item as the reader takes it: the durable id, the child's own session, what it
// was asked to be and to do, where it stands, and the summary it came back with.
func TestMuseSubagentRefReadsTheDelegation(t *testing.T) {
	ref := musecli.MuseSubagentRef(map[string]any{
		"subagentId": "sub-1", "childSessionId": "ses-child",
		"role": "researcher", "objective": "find the bug",
		"status": "completed", "durationMs": float64(9000),
		"result": map[string]any{"summary": "it was the cache"},
	})
	if ref.SubagentID != "sub-1" || ref.ChildSessionID != "ses-child" {
		t.Errorf("handles = %+v, want the durable id and the child's session", ref)
	}
	if ref.Role != "researcher" || ref.Objective != "find the bug" {
		t.Errorf("asked = %+v, want what the child was asked", ref)
	}
	if ref.Status != "completed" || ref.Summary != "it was the cache" || ref.DurationMs != 9000 {
		t.Errorf("outcome = %+v, want where it stands and what it came back with", ref)
	}
}

// The generic item status first, the control status where that says nothing.
func TestMuseSubagentStatusPrefersTheItemStatus(t *testing.T) {
	if got := musecli.MuseSubagentStatus(map[string]any{"status": "completed"}); got != "completed" {
		t.Errorf("status = %q, want the item's own", got)
	}
	if got := musecli.MuseSubagentStatus(map[string]any{"controlStatus": "running"}); got != "running" {
		t.Errorf("status = %q, want the control status where the item says nothing", got)
	}
	if got := musecli.MuseSubagentStatus(map[string]any{}); got != "" {
		t.Errorf("status = %q, want nothing where neither says anything", got)
	}
}

// The parent's one line about the delegation, however the host summarised it.
func TestMuseSubagentSummaryReadsTheHostLine(t *testing.T) {
	if got := musecli.MuseSubagentSummary(map[string]any{"fallbackText": "a"}); got != "a" {
		t.Errorf("summary = %q, want the host's line", got)
	}
	if got := musecli.MuseSubagentSummary(map[string]any{"text": "b"}); got != "b" {
		t.Errorf("summary = %q, want the text where no line was given", got)
	}
	if got := musecli.MuseSubagentSummary(map[string]any{"summary": "c"}); got != "c" {
		t.Errorf("summary = %q, want the summary where nothing else was given", got)
	}
	if got := musecli.MuseSubagentSummary(map[string]any{}); got != "" {
		t.Errorf("summary = %q, want nothing summarised nowhere", got)
	}
}

// A `session/read` answer is its folded item array — and anything else is a read that found no
// transcript, filed as the summary line rather than as a delegation claiming a child that did
// nothing.
func TestMuseChildItemsReadsTheFoldedTranscript(t *testing.T) {
	items, err := musecli.MuseChildItems(json.RawMessage(
		`{"history":{"items":[{"kind":"agentMessage","text":"hi"}]}}`))
	if err != nil || len(items) != 1 {
		t.Fatalf("items = %+v err=%v, want the child's transcript", items, err)
	}
	for _, raw := range []string{
		`{"history":{}}`,
		`{"history":{"items":null}}`,
		`not json`,
	} {
		if _, err := musecli.MuseChildItems(json.RawMessage(raw)); err == nil {
			t.Errorf("items of %s: err = nil, want the read refused", raw)
		}
	}
}

// A delegation with no child to read files metadata-only, without ever asking the host.
func TestMuseSubagentReaderFilesNoChildMetadataOnly(t *testing.T) {
	reader := musecli.NewMuseSubagentReader(nil, nil, 0)
	sub, err := reader.ReadSubagent(agentapi.SubagentRef{SubagentID: "sub-1", Objective: "o"})
	if err != nil {
		t.Fatalf("ReadSubagent = %v, want metadata-only rather than an error", err)
	}
	if !sub.Truncated || len(sub.Blocks) != 0 || sub.Objective != "o" {
		t.Errorf("sub = %+v, want the parent's account and nothing beneath it", sub)
	}
}

// Past the fetch budget a delegation files metadata-only: a tree nobody will open in full is not
// worth stalling the relay on.
func TestMuseSubagentReaderSpendsOneBudgetPerTurn(t *testing.T) {
	reader := musecli.NewMuseSubagentReader(nil, nil, 0)
	reader.Fetches = 0
	sub, err := reader.ReadSubagent(agentapi.SubagentRef{SubagentID: "sub-1", ChildSessionID: "ses-child"})
	if err != nil {
		t.Fatalf("ReadSubagent = %v, want metadata-only rather than an error", err)
	}
	if !sub.Truncated || len(sub.Blocks) != 0 {
		t.Errorf("sub = %+v, want the delegation filed without reading", sub)
	}
}

// A whole turn over the stub host: the delegation is filed with what the child thought and did —
// its paragraph, its reasoning, its tool call — and the grandchild beneath that, to the depth
// the read reaches.
func TestMuseDriverFilesADelegationWhole(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "subagent")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "delegate", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	var block agentapi.TurnBlock
	found := false
	for _, event := range got {
		if event.Kind == agentapi.EventBlock && event.Block.Kind == agentapi.BlockKindSubagent {
			block, found = event.Block, true
		}
	}
	if !found {
		t.Fatalf("events = %+v, want the delegation filed as a block of its own", got)
	}
	if block.Text != "child did things" {
		t.Errorf("text = %q, want the parent's line on the block", block.Text)
	}
	sub := block.Subagent
	if sub == nil {
		t.Fatal("subagent is nil, want what the child thought and did")
	}
	if sub.SubagentID != "sub-1" || sub.ChildSessionID != "ses-child" ||
		sub.Role != "researcher" || sub.Objective != "find the bug" ||
		sub.Status != "completed" || sub.Result != "it was the cache" {
		t.Errorf("sub = %+v, want the delegation's metadata", sub)
	}
	if sub.Truncated {
		t.Error("Truncated = true, want a whole transcript filed whole")
	}
	if len(sub.Blocks) != 4 {
		t.Fatalf("blocks = %+v, want the child's four items in order", sub.Blocks)
	}
	if sub.Blocks[0].Kind != agentapi.BlockKindText || sub.Blocks[0].Text != "child here" {
		t.Errorf("first = %+v, want what the child said", sub.Blocks[0])
	}
	if sub.Blocks[1].Kind != agentapi.BlockKindThinking || sub.Blocks[1].Text != "a plan" {
		t.Errorf("second = %+v, want what the child thought", sub.Blocks[1])
	}
	if sub.Blocks[2].Kind != agentapi.BlockKindToolUse || sub.Blocks[2].Name != "Read" {
		t.Errorf("third = %+v, want what the child did", sub.Blocks[2])
	}
	nested := sub.Blocks[3]
	if nested.Kind != agentapi.BlockKindSubagent || nested.Subagent == nil {
		t.Fatalf("fourth = %+v, want the grandchild's delegation", nested)
	}
	if nested.Subagent.Role != "helper" || nested.Subagent.Result != "the fact" {
		t.Errorf("nested = %+v, want the grandchild's metadata", nested.Subagent)
	}
	if len(nested.Subagent.Blocks) != 1 || nested.Subagent.Blocks[0].Text != "grandchild here" {
		t.Errorf("nested blocks = %+v, want what the grandchild said", nested.Subagent.Blocks)
	}
	// The history is the whole point of the call: metadata-only is the default, and the read
	// asks for the folded items explicitly — once per delegation, the child's and its own.
	calls := museStubCalls(t, logPath)
	reads := 0
	for _, call := range calls {
		if call.Method != "session/read" {
			continue
		}
		reads++
		if asked, _ := call.Params["excludeItems"].(bool); asked {
			t.Errorf("session/read excludes its items, want the folded transcript")
		}
	}
	if reads != 2 {
		t.Errorf("%d session/read calls, want the child's and the grandchild's", reads)
	}
}

// A read the host refuses files the summary line alone: what every delegation was before its
// transcript was read beneath it — and the turn ends as it always has.
func TestMuseDriverFilesARefusedReadAsTheSummaryLine(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "subagent-fail")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "delegate", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	var block agentapi.TurnBlock
	found := false
	for _, event := range got {
		if event.Kind == agentapi.EventBlock {
			block, found = event.Block, true
		}
	}
	if !found {
		t.Fatalf("events = %+v, want the delegation filed", got)
	}
	if block.Kind != agentapi.BlockKindText || block.Text != "child did things" {
		t.Errorf("block = %+v, want the summary line alone", block)
	}
	last := got[len(got)-1]
	if last.Kind != agentapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last = %+v, want the turn ending as it always has", last)
	}
}

// A delegation that names no child files the summary line without asking the host anything: the
// stub refuses a read it was never scripted for, so any ask would end the turn in failure.
func TestMuseDriverFilesAChildlessDelegationAsTheSummaryLine(t *testing.T) {
	driver := &musecli.MuseDriver{EventStream: make(chan agentapi.AgentEvent, 1)}
	block, ok := driver.CompletedSubagent(map[string]any{
		"kind": "subagent", "fallbackText": "child did things",
	})
	if !ok || block.Kind != agentapi.BlockKindText || block.Text != "child did things" {
		t.Errorf("block = %+v ok=%v, want the summary line alone", block, ok)
	}
	if _, ok := driver.CompletedSubagent(map[string]any{"kind": "subagent"}); ok {
		t.Error("a delegation summarised nowhere files nothing, like any empty item")
	}
}

// Long texts are cut where the delegation is read: the transcript carries the substance, and the
// metadata are the lines a collapsed delegation is read by.
func TestMuseSubagentRefCutsTheMetadata(t *testing.T) {
	ref := musecli.MuseSubagentRef(map[string]any{
		"objective": strings.Repeat("o", agentapi.MaxSubagentObjectiveChars+10),
		"result":    map[string]any{"summary": strings.Repeat("s", agentapi.MaxSubagentResultChars+10)},
		"role":      strings.Repeat("r", agentapi.MaxSubagentNameChars+10),
	})
	if len([]rune(ref.Objective)) > agentapi.MaxSubagentObjectiveChars+1 {
		t.Errorf("objective kept %d runes, want it cut", len([]rune(ref.Objective)))
	}
	if len([]rune(ref.Summary)) > agentapi.MaxSubagentResultChars+1 {
		t.Errorf("summary kept %d runes, want it cut", len([]rune(ref.Summary)))
	}
	if len([]rune(ref.Role)) > agentapi.MaxSubagentNameChars+1 {
		t.Errorf("role kept %d runes, want it cut", len([]rune(ref.Role)))
	}
}
