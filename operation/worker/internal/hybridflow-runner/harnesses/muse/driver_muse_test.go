package muse

import (
	"context"
	"encoding/json"
	"os"
	pkgExec "os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
)

// Both manual modes ask about every tool call, and bypass asks about none — with the deployment's
// gate failing closed, as on the Claude side.
func TestMuseApprovalModeMapsTheThreeModes(t *testing.T) {
	for _, tc := range []struct {
		name        string
		mode        string
		allowBypass bool
		want        string
	}{
		{"manual", runnerconfig.PermissionModeManual, true, "onRequest"},
		{"manualLive uses the hub's countdown", runnerconfig.PermissionModeManualLive, true, "onRequest"},
		{"bypass", runnerconfig.PermissionModeBypass, true, "allowAll"},
		{"bypass without the deployment's leave", runnerconfig.PermissionModeBypass, false, "onRequest"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := MuseApprovalMode(tc.mode, tc.allowBypass); got != tc.want {
				t.Errorf("approval mode = %q, want %q", got, tc.want)
			}
		})
	}
}

// Thinking off is the `none` tier, a named tier passes through, and a word the vocabulary has
// moved past runs the host's default rather than refusing the turn.
func TestMuseReasoningEffortMapsThinkingAndTiers(t *testing.T) {
	for _, tc := range []struct {
		name     string
		thinking bool
		effort   string
		want     string
	}{
		{"thinking off", false, "ultra", "none"},
		{"named tier passes through", true, "xhigh", "xhigh"},
		{"no effort uses the host's default", true, "", ""},
		{"unknown effort uses the host's default", true, "glacial", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := MuseReasoningEffort(tc.thinking, tc.effort); got != tc.want {
				t.Errorf("reasoning effort = %q, want %q", got, tc.want)
			}
		})
	}
}

// An allow answers the once-scoped approval; a deny the once-scoped denial. Anything of the right
// outcome beats nothing — except a policy amendment, which rewrites the rules rather than deciding
// the call.
func TestMuseChoiceForPrefersTheCallItsOwn(t *testing.T) {
	choices := []MuseChoice{
		{ChoiceID: "session", Decision: "approved", Scope: "session"},
		{ChoiceID: "once", Decision: "approved", Scope: "once"},
		{ChoiceID: "no", Decision: "denied", Scope: "once"},
	}
	withoutOnce := []MuseChoice{{ChoiceID: "session", Decision: "approved", Scope: "session"}}
	for _, tc := range []struct {
		name    string
		choices []MuseChoice
		allow   bool
		want    string
	}{
		{"allow takes the once-scoped approval", choices, true, "once"},
		{"deny takes the once-scoped denial", choices, false, "no"},
		{"allow falls back to the session", withoutOnce, true, "session"},
		{"deny with no denial takes nothing", withoutOnce, false, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := MuseChoiceFor(tc.choices, tc.allow)
			if tc.want == "" {
				if got != nil {
					t.Errorf("choice = %+v, want nothing to take", got)
				}
			} else if got == nil || got.ChoiceID != tc.want {
				t.Errorf("choice = %+v, want %q", got, tc.want)
			}
		})
	}
}

// A single answer that names one of its options is a selection; a multi-select answer carries its
// labels comma-separated; anything else is free text rather than a forced choice.
func TestMuseSelectedLabelsMatchAnswersToOptions(t *testing.T) {
	single := MuseQuestion{Id: "q1", Labels: []string{"Red", "Blue"}}
	multi := MuseQuestion{Id: "q2", Multiple: true, Labels: []string{"A", "B", "C"}}
	for _, tc := range []struct {
		name     string
		question MuseQuestion
		answer   string
		want     []string
	}{
		{"single names an option", single, "Blue", []string{"Blue"}},
		{"single off-list stays free text", single, "Green", nil},
		{"multi keeps the named labels in order", multi, "A, C", []string{"A", "C"}},
		{"multi keeps only labels that are options", multi, "A, Z", []string{"A"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := MuseSelectedLabels(tc.question, tc.answer); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("selected labels = %q, want %q", got, tc.want)
			}
		})
	}
}

// The card is read by the subject line, so it names the target: the command, the path, the
// endpoint — rather than the kind.
func TestMuseSubjectLineNamesTheTarget(t *testing.T) {
	for _, tc := range []struct {
		name    string
		subject map[string]any
		want    string
	}{
		{"shell", map[string]any{"kind": "shell", "command": "rm -rf /tmp/x"}, "rm -rf /tmp/x"},
		{"file", map[string]any{"kind": "fileAccess", "access": "write", "path": "/a/b"}, "write /a/b"},
		{"net", map[string]any{"kind": "network", "protocol": "https", "host": "x.test"}, "https://x.test"},
		{"tool", map[string]any{"kind": "tool", "toolName": "files_read"}, "files_read"},
		{"other", map[string]any{"kind": "mystery", "target": "the moon"}, "the moon"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := MuseSubjectLine(tc.subject); got != tc.want {
				t.Errorf("subject line = %q, want %q", got, tc.want)
			}
		})
	}
}

// One transcript item is one reply block — a paragraph, a stretch of reasoning, a tool call — in
// the order the host completed them. The echo of the turn's own input is not one: the hub's
// transcript records what the user wrote, and the composed text carries the briefing nobody was
// meant to read back.
func TestMuseBlockMapsTheTranscriptKinds(t *testing.T) {
	for _, tc := range []struct {
		name           string
		item           map[string]any
		want           harnessapi.TurnBlock
		wantOK         bool
		detailContains string
	}{
		{
			name: "harness message is a paragraph",
			item: map[string]any{"kind": "agentMessage", "text": "hello"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "hello"}, wantOK: true,
		},
		{
			name: "reasoning is a thinking block",
			item: map[string]any{"kind": "reasoning", "text": "hmm"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindThinking, Text: "hmm"}, wantOK: true,
		},
		{
			name: "summarised reasoning joins its parts",
			item: map[string]any{"kind": "reasoning", "summary": []any{"first", "second"}},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindThinking, Text: "first\n\nsecond"}, wantOK: true,
		},
		{
			name: "tool call keeps the whole input for the audit",
			item: map[string]any{"kind": "toolCall", "tool": "Edit", "args": `{"file":"a.md"}`},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindToolUse, Name: "Edit"}, wantOK: true,
			detailContains: `"file": "a.md"`,
		},
		{
			name: "user message is the echo of this turn's own input",
			item: map[string]any{"kind": "userMessage", "text": "hi"},
		},
		// A turn of a turn, and the turns beside the turn, each read as the line the host
		// summarised it with — a turn that delegated its work reads as what it delegated.
		{
			name: "subagent uses the host's summary",
			item: map[string]any{"kind": "subagent", "fallbackText": "did a thing"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "user shell uses the host's summary",
			item: map[string]any{"kind": "userShell", "fallbackText": "did a thing"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "workflow uses the host's summary",
			item: map[string]any{"kind": "workflow", "fallbackText": "did a thing"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "compaction uses the host's summary",
			item: map[string]any{"kind": "compaction", "fallbackText": "did a thing"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		// A reminder child is internal housekeeping, never a reply: even with the host's
		// placeholder summary it must be dropped, so nothing is persisted or shown.
		{
			name: "reminder child drops its fallback",
			item: map[string]any{"kind": "reminderChild", "fallbackText": "Reminder child session"},
		},
		{
			name: "reminder child drops every rendering",
			item: map[string]any{"kind": "reminderChild", "fallbackText": "Reminder child session",
				"text": "Reminder child session", "summary": "Reminder child session"},
		},
		{
			name: "reminder child with no summary is skipped",
			item: map[string]any{"kind": "reminderChild"},
		},
		{
			name: "compaction with no summary is skipped",
			item: map[string]any{"kind": "compaction"},
		},
		{
			name: "unknown kind renders generically",
			item: map[string]any{"kind": "something-new", "fallbackText": "a line"},
			want: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "a line"}, wantOK: true,
		},
		{
			name: "unknown kind with no summary is skipped",
			item: map[string]any{"kind": "something-new"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := MuseBlock(tc.item)
			if ok != tc.wantOK {
				t.Fatalf("block = %+v, ok = %v, want ok = %v", got, ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if got.Kind != tc.want.Kind || got.Text != tc.want.Text || got.Name != tc.want.Name {
				t.Errorf("block = %+v, want kind/text/name from %+v", got, tc.want)
			}
			if !strings.Contains(got.Detail, tc.detailContains) {
				t.Errorf("detail = %q, want it to contain %q", got.Detail, tc.detailContains)
			}
		})
	}
}

// A toolCall item is completed, so its outcome travels on the block beside the call — the same
// account the other harnesses give, rather than a call with nothing said about whether it worked.
func TestMuseToolCallCarriesItsOutcome(t *testing.T) {
	zero := 0
	for _, tc := range []struct {
		name           string
		item           map[string]any
		wantResult     string
		wantError      bool
		wantID         string
		wantExitCode   *int
		resultNonEmpty bool
	}{
		{
			name: "output is filed under the call's id",
			item: map[string]any{
				"kind": "toolCall", "id": "item_9", "tool": "Bash", "args": `{"command":"ls"}`,
				"output": "a.md\nb.md", "exitCode": float64(0),
			},
			wantResult: "a.md\nb.md", wantID: "item_9", wantExitCode: &zero,
		},
		{
			name: "error is filed and marked",
			item: map[string]any{
				"kind": "toolCall", "tool": "Bash", "error": map[string]any{"message": "denied"},
			},
			wantError: true, resultNonEmpty: true,
		},
		// The host's own spellings, as its journal writes them: what the call showed, and the
		// verdict on a failed one.
		{
			name: "visible output is filed under the call",
			item: map[string]any{
				"kind": "toolCall", "id": "item_10", "tool": "search",
				"args": `{"pattern":"diff"}`, "status": "completed", "visibleOutput": "a.ts\nb.ts",
			},
			wantResult: "a.ts\nb.ts", wantID: "item_10",
		},
		{
			name: "failure verdict joins the output",
			item: map[string]any{
				"kind": "toolCall", "tool": "Bash", "status": "failed",
				"visibleOutput": "some log", "failureReason": "process exited with status 1",
			},
			wantResult: "some log\nprocess exited with status 1", wantError: true,
		},
		// A verdict the output already carries is not said twice.
		{
			name: "repeated verdict leaves the output alone",
			item: map[string]any{
				"kind": "toolCall", "tool": "Bash", "status": "failed",
				"visibleOutput": "tool failed: bang", "failureReason": "bang",
			},
			wantResult: "tool failed: bang", wantError: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := MuseBlock(tc.item)
			if !ok || got.Kind != harnessapi.BlockKindToolUse {
				t.Fatalf("toolCall = %+v, want the call as a tool_use block", got)
			}
			if got.ToolUseID != tc.wantID || got.IsError != tc.wantError {
				t.Errorf("toolCall = %+v, want id %q and isError %v", got, tc.wantID, tc.wantError)
			}
			if tc.resultNonEmpty {
				if got.Result == "" {
					t.Error("result is empty, want the error filed")
				}
			} else if got.Result != tc.wantResult {
				t.Errorf("result = %q, want %q", got.Result, tc.wantResult)
			}
			if !reflect.DeepEqual(got.ExitCode, tc.wantExitCode) {
				t.Errorf("exitCode = %v, want %v", got.ExitCode, tc.wantExitCode)
			}
		})
	}
}

// The turn's end files what the turn cost, in the same per-turn shape Claude files —
// whether the end carries the aggregate itself or the bill is the fold of the
// turn's model completions.
func TestMuseTurnCompletedReportsTurnUsage(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	done, code, terminal, events := driver.turnCompleted(map[string]any{
		"terminal": "completed",
		"usage":    map[string]any{"inputTokens": float64(300), "outputTokens": float64(60)},
	})
	if !done || code != 0 || terminal != "completed" {
		t.Fatalf("end = %v/%d/%q, want the turn ended cleanly", done, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v, want the turn usage first", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 300 || usage.OutputTokens != 60 ||
		usage.Scope != harnessapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the host's figures as a turn total", usage)
	}
}

// The host omits the aggregate from the end more often than not: the bill is then
// the fold of the turn's session/tokenUsage, one per model completion, summed as
// they landed — including the TokenUsage cache spellings.
func TestMuseTurnCompletedFoldsTokenUsage(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}, EventStream: make(chan harnessapi.HarnessEvent, 8)}
	first, _ := json.Marshal(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(20918), "outputTokens": float64(76),
		"cachedTokens": float64(0), "cacheReadTokens": float64(0),
		"cacheWriteTokens": float64(0), "reasoningTokens": float64(47),
	}})
	second, _ := json.Marshal(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(1000), "outputTokens": float64(50),
		"cachedTokens": float64(200), "cacheWriteTokens": float64(10),
	}})
	for _, params := range []json.RawMessage{first, second} {
		if done, _, _ := driver.relayOne(MspNotification{
			Method: "session/tokenUsage", Params: params,
		}); done {
			t.Fatal("a completion's usage ends nothing")
		}
	}
	done, code, terminal, events := driver.turnCompleted(map[string]any{
		"turnId": "turn-1", "terminal": "completed",
	})
	if !done || code != 0 || terminal != "completed" {
		t.Fatalf("end = %v/%d/%q, want the turn ended cleanly", done, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v, want the folded bill", events)
	}
	usage := events[0].Usage
	if usage.InputTokens != 21918 || usage.OutputTokens != 126 ||
		usage.CacheReadTokens != 200 || usage.CacheWriteTokens != 10 ||
		usage.ReasoningTokens != 47 ||
		usage.Scope != harnessapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the two completions summed as a turn total", usage)
	}
	if driver.host.takeTurnUsage() != nil {
		t.Error("the fold must be cleared once taken")
	}
}

func TestMuseTokenUsageUsesCountedPromptTotals(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{
		"turnId": "turn-1", "promptTokens": float64(1200), "totalTokens": float64(1250),
		"usage": map[string]any{
			"inputTokens": float64(200), "outputTokens": float64(50),
			"cacheReadTokens": float64(800), "cacheWriteTokens": float64(200),
			"reasoningTokens": float64(30),
		},
	})
	_, _, _, events := driver.turnCompleted(map[string]any{"turnId": "turn-1", "terminal": "completed"})
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v, want one usage report", events)
	}
	usage := events[0].Usage
	if usage.InputTokens != 1200 || usage.OutputTokens != 50 || usage.CacheReadTokens != 800 ||
		usage.CacheWriteTokens != 200 || usage.ReasoningTokens != 30 {
		t.Fatalf("usage = %+v, want 1250 tokens with cache and reasoning included", usage)
	}
}

// Where the end carries the aggregate and completions were folded too, the
// aggregate wins: one bill, the host's sum rather than the fold.
func TestMuseTurnCompletedPrefersItsOwnAggregate(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(1000), "outputTokens": float64(50),
	}})
	_, _, _, events := driver.turnCompleted(map[string]any{
		"turnId": "turn-1", "terminal": "completed",
		"usage": map[string]any{"inputTokens": float64(300), "outputTokens": float64(60)},
	})
	if len(events) != 1 || events[0].Kind != harnessapi.EventUsage {
		t.Fatalf("events = %+v, want one bill", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 300 || usage.OutputTokens != 60 {
		t.Errorf("usage = %+v, want the end's aggregate rather than the fold", usage)
	}
	if driver.host.takeTurnUsage() != nil {
		t.Error("the dropped fold must not survive the end")
	}
}

// Normal completions belong to their turn; explicit compaction usage is retained too.
func TestMuseTokenUsageKeepsOnlyItsOwnTurn(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-0", "usage": map[string]any{
		"inputTokens": float64(99999), "outputTokens": float64(99999),
	}})
	driver.host.noteTokenUsage(map[string]any{"usage": map[string]any{
		"inputTokens": float64(99999), "outputTokens": float64(99999),
	}})
	if driver.host.takeTurnUsage() != nil {
		t.Fatal("stragglers must not bill the running turn")
	}
	driver.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(100), "outputTokens": float64(10),
	}})
	if billed := driver.host.takeTurnUsage(); billed == nil ||
		billed.InputTokens != 100 || billed.OutputTokens != 10 {
		t.Fatalf("billed = %+v, want this turn's own completion", billed)
	}

	compacting := &MuseDriver{host: museHost{turnID: "turn-1", compacting: true}}
	compacting.host.noteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(100), "outputTokens": float64(10),
	}})
	if usage := compacting.host.takeTurnUsage(); usage == nil || usage.InputTokens != 100 || usage.OutputTokens != 10 {
		t.Errorf("compaction usage = %+v, want the observed consumption", usage)
	}
}

// A terminal naming another turn ends nothing — it is a replaced turn's straggler. A terminal the
// vocabulary has moved past fails the turn rather than reporting an end nobody asked for.
func TestMuseTurnCompletedEndsOnlyItsOwnTurn(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	if done, _, _, _ := driver.turnCompleted(map[string]any{
		"turnId": "turn-0", "terminal": "completed",
	}); done {
		t.Error("a terminal for another turn must end nothing")
	}
	done, code, terminal, events := driver.turnCompleted(map[string]any{"terminal": "completed"})
	if !done || code != 0 || terminal != "completed" || len(events) != 0 {
		t.Errorf("completed = %v/%d/%q/%+v, want the turn ended cleanly on its own word", done, code, terminal, events)
	}
	driver.host.turnID = "turn-1"
	failed, code, terminal, events := driver.turnCompleted(map[string]any{
		"terminal": "failed", "error": map[string]any{"message": "boom"},
	})
	if !failed || code != 1 || terminal != "failed" {
		t.Fatalf("failed = %v/%d/%q, want the turn failed on its own word", failed, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != harnessapi.EventFailure || events[0].Message != "boom" {
		t.Errorf("failed events = %+v, want the host's sentence first", events)
	}
	driver.host.turnID = "turn-1"
	if done, code, terminal, _ := driver.turnCompleted(map[string]any{"terminal": "cancelled"}); !done || code != -1 || terminal != "cancelled" {
		t.Errorf("cancelled = %v/%d/%q, want the service-ended shape on its own word", done, code, terminal)
	}
	driver.host.turnID = "turn-1"
	if done, code, _, _ := driver.turnCompleted(map[string]any{"terminal": "vaporised"}); !done || code != 1 {
		t.Errorf("unknown terminal = %v/%d, want the turn failed closed", done, code)
	}
}

// A turn refused for want of credentials says so structurally: the schema's `authRequired` kind
// is what the hub reports under the sign-in's own error code, whatever sentence the CLI put
// beside it. Any other failure — or none named at all — stays an ordinary mid-turn complaint.
func TestMuseTurnCompletedMarksTheSignInFailure(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	done, code, _, events := driver.turnCompleted(map[string]any{
		"terminal": "failed",
		"error": map[string]any{
			"kind":    "authRequired",
			"message": "not logged in: run /login to add an API key",
		},
	})
	if !done || code != 1 {
		t.Fatalf("end = %v/%d, want the turn failed", done, code)
	}
	if len(events) != 1 || events[0].Kind != harnessapi.EventFailure || !events[0].AuthRequired {
		t.Fatalf("events = %+v, want the failure marked as wanting credentials", events)
	}
	if events[0].Message != "not logged in: run /login to add an API key" {
		t.Errorf("message = %q, want the CLI's sentence relayed unreworded", events[0].Message)
	}

	for _, params := range []map[string]any{
		{"terminal": "failed", "error": map[string]any{"kind": "modelError", "message": "boom"}},
		{"terminal": "failed", "error": map[string]any{"message": "boom"}},
		{"terminal": "failed", "reason": "not logged in: run /login to add an API key"},
	} {
		driver.host.turnID = "turn-1"
		_, _, _, events := driver.turnCompleted(params)
		if len(events) != 1 || events[0].Kind != harnessapi.EventFailure || events[0].AuthRequired {
			t.Errorf("events for %+v = %+v, want an unmarked failure", params, events)
		}
	}
}

// A reclaim ends the turn it names with the sentence saying it never ran — and nothing else: one
// naming another turn is a replaced turn's straggler, as a terminal for one would be.
func TestMuseTurnUnqueuedEndsOnlyItsOwnTurn(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	if done, _, _ := driver.turnUnqueued(map[string]any{"turnId": "turn-0"}); done {
		t.Error("a reclaim for another turn must end nothing")
	}
	done, code, failure := driver.turnUnqueued(map[string]any{"turnId": "turn-1"})
	if !done || code != 1 || failure == nil || failure.Message == "" {
		t.Errorf("reclaim = %v/%d/%+v, want the turn ended with a sentence", done, code, failure)
	}
}

// An item completing under another turn's id is a replaced turn's straggler: heard, and kept out
// of this turn's account.
func TestMuseCompletedItemKeepsOnlyItsOwnTurn(t *testing.T) {
	driver := &MuseDriver{host: museHost{turnID: "turn-1"}}
	if events := driver.completedItem(map[string]any{
		"item": map[string]any{"kind": "agentMessage", "turnId": "turn-0", "text": "elsewhere"},
	}); events != nil {
		t.Errorf("foreign item = %+v, want it dropped", events)
	}
	events := driver.completedItem(map[string]any{
		"item": map[string]any{"kind": "agentMessage", "turnId": "turn-1", "text": "here"},
	})
	if len(events) != 1 || events[0].Kind != harnessapi.EventBlock || events[0].Block.Text != "here" {
		t.Errorf("own item = %+v, want the block", events)
	}
}

// An approval the hub has already answered is re-emitted when a further stage updates it: the card
// went down with the answer, and the turn is about to park again with nothing on screen. An update
// to a card still up only refreshes what the next decision echoes.
func TestMuseApprovalUpdatedReemitsOnlyAnAnsweredAsk(t *testing.T) {
	newDriver := func(answered bool) *MuseDriver {
		driver := &MuseDriver{asks: museAsks{pending: map[string]*MuseAsk{}}}
		ask := &harnessapi.HarnessAsk{ID: MuseAskApprovalPrefix + "apv-1", Tool: "shell"}
		driver.asks.pending[ask.ID] = &MuseAsk{Ask: ask, ApprovalID: "apv-1", Answered: answered,
			Requirement: map[string]any{"approvalId": "apv-1", "sourceIndex": 0}}
		return driver
	}
	updated := map[string]any{
		"approvalId":           "apv-1",
		"currentRequirementId": map[string]any{"approvalId": "apv-1", "sourceIndex": 1},
		"availableChoices": []any{map[string]any{
			"choiceId": "c2", "decision": "approved", "scope": "once",
		}},
	}

	driver := newDriver(true)
	event, ok := driver.asks.updateApproval(updated)
	if !ok || event.Kind != harnessapi.EventAsk || event.Ask.ID != MuseAskApprovalPrefix+"apv-1" {
		t.Fatalf("updated answered ask = %+v/%v, want the ask re-emitted", event, ok)
	}
	stored := driver.asks.pending[MuseAskApprovalPrefix+"apv-1"]
	if stored.Answered {
		t.Error("the re-emitted ask must park again unanswered")
	}
	if len(stored.Choices) != 1 || stored.Choices[0].ChoiceID != "c2" {
		t.Errorf("choices = %+v, want the refreshed ones", stored.Choices)
	}

	if event, ok := newDriver(false).asks.updateApproval(updated); ok {
		t.Errorf("updated unanswered ask = %+v, want silence: the card is still up", event)
	}
}

// A settlement of the hub's own decision is the answer landing; anything else — the judge, a
// timeout, another client — withdraws the card.
func TestMuseSettlementsWithdrawOnlyWhatTheHubDidNotDecide(t *testing.T) {
	driver := &MuseDriver{asks: museAsks{pending: map[string]*MuseAsk{}}}
	mine := &harnessapi.HarnessAsk{ID: MuseAskApprovalPrefix + "a1", Tool: "shell"}
	driver.asks.pending[mine.ID] = &MuseAsk{Ask: mine, ApprovalID: "a1",
		Answered: true, DecidedBy: map[string]bool{"cmd-1": true}}
	theirs := &harnessapi.HarnessAsk{ID: MuseAskApprovalPrefix + "a2", Tool: "shell"}
	driver.asks.pending[theirs.ID] = &MuseAsk{Ask: theirs, ApprovalID: "a2"}

	if event, ok := driver.asks.settleApproval(map[string]any{
		"approvalId": "a1", "decidedByCommandId": "cmd-1",
	}); ok {
		t.Errorf("own settlement = %+v, want silence: the card is already gone", event)
	}
	event, ok := driver.asks.settleApproval(map[string]any{
		"approvalId": "a2", "decidedByCommandId": "cmd-9",
	})
	if !ok || event.Kind != harnessapi.EventWithdraw || event.AskID != theirs.ID {
		t.Fatalf("foreign settlement = %+v/%v, want the ask withdrawn", event, ok)
	}
	if _, ok := driver.asks.pending[theirs.ID]; ok {
		t.Error("a withdrawn ask must leave the pending set")
	}
	if event, ok := driver.asks.settleApproval(map[string]any{"approvalId": "a3"}); ok {
		t.Errorf("unknown settlement = %+v, want silence", event)
	}

	driver.asks.pending[MuseAskQuestionPrefix+"u1"] = &MuseAsk{
		Ask: &harnessapi.HarnessAsk{ID: MuseAskQuestionPrefix + "u1"}, UserInputID: "u1",
		Answered: true, DecidedBy: map[string]bool{"cmd-2": true},
	}
	if event, ok := driver.asks.settleQuestion(map[string]any{
		"userInputId": "u1", "decidedByCommandId": "cmd-2",
	}); ok {
		t.Errorf("own question settlement = %+v, want silence", event)
	}
}

// Parked is waiting on something only a person can answer: an ask the hub has not decided. A
// decided one is the host's to settle, and a settled one is gone — neither holds the idle wait.
func TestMuseDriverParkedOnUnansweredAsks(t *testing.T) {
	driver := &MuseDriver{}
	if driver.asks.parked() {
		t.Error("no asks: not parked")
	}
	driver.asks.pending = map[string]*MuseAsk{
		MuseAskApprovalPrefix + "a1": {Ask: &harnessapi.HarnessAsk{ID: MuseAskApprovalPrefix + "a1"}},
	}
	if !driver.asks.parked() {
		t.Error("unanswered ask: parked")
	}
	driver.asks.pending[MuseAskApprovalPrefix+"a1"].Answered = true
	if driver.asks.parked() {
		t.Error("answered ask: not parked")
	}
	delete(driver.asks.pending, MuseAskApprovalPrefix+"a1")
	if driver.asks.parked() {
		t.Error("settled ask: not parked")
	}
}

// Staging points the host at the turn's own configuration: the ledger's servers with the token
// written in, beside the staged skills and the login it is still the user's own. A turn handed no
// servers stages nothing and runs the CLI the deployment configured by hand.
func TestMuseStageConfigWritesTheTurnItsOwn(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	authDir := filepath.Join(home, "xdg", "muse")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(authDir, "auth.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	userSkills := filepath.Join(home, "xdg", "muse", "skills", "mine")
	mustWriteBytes(t, filepath.Join(userSkills, "SKILL.md"), []byte("the user's own"))
	// os.UserHomeDir reads $HOME on unix, which is what the staging reads the user skills and
	// the login from.
	t.Setenv("HOME", home)
	store := t.TempDir()
	mustWriteBytes(t, filepath.Join(store, ".agents", "skills", "graph", ".kiao-skill"), []byte("digest=previous"))
	mustWriteBytes(t, filepath.Join(store, ".agents", "skills", "graph", "SKILL.md"), []byte("previously managed"))
	mustWriteBytes(t, filepath.Join(store, ".agents", "skills", "verify", "SKILL.md"), []byte("the store's own"))

	staging, env, err := stageMuseConfig(MuseRun{
		McpConfig: `{"kiao-files":{"transport":"stdio","env":{"T":"${KIAO_MCP_TURN_TOKEN}"}}}`,
		McpToken:  "turn-token",
		StoreRoot: store,
	})
	if err != nil {
		t.Fatalf("stageConfig = %v", err)
	}
	defer os.RemoveAll(staging)
	configDir := filepath.Join(staging, "config", "muse")

	settings, err := os.ReadFile(filepath.Join(configDir, "settings.json"))
	if err != nil {
		t.Fatalf("settings.json: %v", err)
	}
	var staged struct {
		SchemaVersion int            `json:"schema_version"`
		Servers       map[string]any `json:"mcp_servers"`
	}
	if err := json.Unmarshal(settings, &staged); err != nil {
		t.Fatalf("settings.json = %s: %v", settings, err)
	}
	if staged.SchemaVersion != 1 || len(staged.Servers) != 1 {
		t.Errorf("settings.json = %s, want the schema version and the ledger's servers", settings)
	}
	if !strings.Contains(string(settings), "turn-token") {
		t.Errorf("settings.json = %s, want the token written in", settings)
	}
	if info, err := os.Stat(filepath.Join(configDir, "settings.json")); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("settings.json mode = %v, want 0600: it holds the turn's credential", info.Mode())
	}
	stagedSkills := filepath.Join(configDir, "skills")
	if _, err := os.Lstat(filepath.Join(stagedSkills, "graph")); !os.IsNotExist(err) {
		t.Errorf("a previously managed store skill was staged (%v)", err)
	}
	if target, err := os.Readlink(filepath.Join(stagedSkills, "mine")); err != nil ||
		target != filepath.Join(home, "xdg", "muse", "skills", "mine") {
		t.Errorf("mine link = %q/%v, want the user's skill read through", target, err)
	}
	if _, err := os.Lstat(filepath.Join(stagedSkills, "verify")); !os.IsNotExist(err) {
		t.Errorf("the store's own skill was staged (%v)", err)
	}
	if _, err := os.Lstat(filepath.Join(configDir, "auth.json")); err != nil {
		t.Errorf("auth.json link: %v, want the user's login read through", err)
	}
	if _, err := os.Lstat(filepath.Join(configDir, "trust.json")); !os.IsNotExist(err) {
		t.Error("trust.json must not be staged: no trust is what keeps project code unloaded")
	}
	found := false
	for _, entry := range env {
		if entry == "XDG_CONFIG_HOME="+filepath.Join(staging, "config") {
			found = true
		}
		if strings.HasPrefix(entry, "XDG_CONFIG_HOME=") && !strings.HasPrefix(entry,
			"XDG_CONFIG_HOME="+staging) {
			t.Errorf("env carries %q beside the staged one: the key must be replaced, not doubled", entry)
		}
	}
	if !found {
		t.Error("env must point XDG_CONFIG_HOME at the staged configuration")
	}

	if staging, env, err := stageMuseConfig(MuseRun{}); err != nil || staging != "" || env != nil {
		t.Errorf("stageConfig with no servers = %q/%q/%v, want nothing staged", staging, env, err)
	}
}

func TestStageMuseUserSkillsSkipsEmptySource(t *testing.T) {
	staged := filepath.Join(t.TempDir(), "skills")
	if err := stageMuseUserSkills(staged, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(staged); !os.IsNotExist(err) {
		t.Errorf("an empty skills directory was staged (%v)", err)
	}
}

// museStubDriver spawns the stub host for one scripted turn: the test binary as the CLI, the
// script and the log named in the environment the host inherits.
func museStubDriver(t *testing.T, script string) (*MuseDriver, string) {
	t.Helper()
	logPath := filepath.Join(t.TempDir(), "stub.log")
	t.Setenv("GO_WANT_MUSE_STUB", "1")
	t.Setenv("MUSE_STUB_SCRIPT", script)
	t.Setenv("MUSE_STUB_LOG", logPath)
	return &MuseDriver{
		Binary:      os.Args[0],
		EventStream: make(chan harnessapi.HarnessEvent),
		Cfg:         &runnerconfig.Config{},
	}, logPath
}

// museTrace opens a bare turn trace for a driver built by hand: the file and nothing else,
// which is all the driver's notes need.
func museTrace(t *testing.T) (*turntrace.TurnTrace, string) {
	t.Helper()
	tracePath := filepath.Join(t.TempDir(), "trace.jsonl")
	traceFile, err := os.Create(tracePath)
	if err != nil {
		t.Fatalf("trace file: %v", err)
	}
	t.Cleanup(func() { traceFile.Close() })
	return &turntrace.TurnTrace{File: traceFile}, tracePath
}

// museTraceText reads a trace back for its notes.
func museTraceText(t *testing.T, tracePath string) string {
	t.Helper()
	content, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("trace file: %v", err)
	}
	return string(content)
}

// drainMuse collects a turn's events to its end, or fails the test on a turn that never ends.
func drainMuse(t *testing.T, driver *MuseDriver) []harnessapi.HarnessEvent {
	t.Helper()
	return drainDriverEvents(t, driver, 15*time.Second)
}

// museStubCalls reads what the stub was asked, in order.
func museStubCalls(t *testing.T, logPath string) []museStubLog {
	t.Helper()
	content, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("stub log: %v", err)
	}
	var calls []museStubLog
	for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
		var call museStubLog
		if err := json.Unmarshal([]byte(line), &call); err != nil {
			t.Fatalf("stub log line %q: %v", line, err)
		}
		calls = append(calls, call)
	}
	return calls
}

// museStubCall finds what the stub was asked under one method, or fails the test.
func museStubCall(t *testing.T, calls []museStubLog, method string) map[string]any {
	t.Helper()
	for _, call := range calls {
		if call.Method == method {
			if call.Params == nil {
				return map[string]any{}
			}
			return call.Params
		}
	}
	t.Fatalf("the stub was never asked %s", method)
	return nil
}

// museNext reads one event, or fails the test on a turn that says nothing more.
func museNext(t *testing.T, events <-chan harnessapi.HarnessEvent) harnessapi.HarnessEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("the stream ended where another event was expected")
		}
		return event
	case <-time.After(15 * time.Second):
		t.Fatal("the turn said nothing more")
		return harnessapi.HarnessEvent{}
	}
}

// A fresh turn opens a session on the whole store, asks about every tool call, and carries the
// briefing in its input: MSP has no per-turn system prompt to hang it on. A turn naming no model
// and no effort asks for neither — the host's own defaults.
func TestMuseDriverRunsAWholeTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[0].Kind != harnessapi.EventSession || got[0].SessionID != "ses-1" {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != harnessapi.EventBlock || got[1].Block.Text != "hello from stub" {
		t.Errorf("second event = %+v, want the reply", got[1])
	}
	if got[1].MessageID == "" {
		t.Error("the block must carry the turn id: it is where a fork picks the session up")
	}
	if got[2].Kind != harnessapi.EventDone || got[2].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", got[2])
	}

	calls := museStubCalls(t, logPath)
	start := museStubCall(t, calls, "session/start")
	if start["workspaceRoot"] != dir {
		t.Errorf("workspaceRoot = %v, want the whole store", start["workspaceRoot"])
	}
	if start["approvalMode"] != "onRequest" {
		t.Errorf("approvalMode = %v, want a manual turn to ask about every tool call", start["approvalMode"])
	}
	for _, method := range []string{"session/setModel", "session/resume", "session/fork"} {
		for _, call := range calls {
			if call.Method == method {
				t.Errorf("the stub was asked %s on a turn naming nothing to set", method)
			}
		}
	}
	turn := museStubCall(t, calls, "turn/start")
	if turn["ifBusy"] != "replace" {
		t.Errorf("ifBusy = %v, want a busy session reclaimed rather than queued behind", turn["ifBusy"])
	}
	if _, has := turn["reasoningEffort"]; has {
		t.Errorf("turn/start = %v, want no effort: the host's default", turn)
	}
	input, _ := turn["input"].([]any)
	if len(input) != 1 {
		t.Fatalf("turn/start input = %v, want the prompt as one text part", turn["input"])
	}
	part, _ := input[0].(map[string]any)
	text, _ := part["text"].(string)
	if !strings.Contains(text, "say hello") || !strings.Contains(text, "Dashboard") {
		t.Errorf("turn/start text = %q, want the prompt with the briefing prepended", text)
	}
}

// A turn played by a managed harness carries the harness's standing instructions in the same text,
// with the briefing: MSP has no per-turn system prompt to hang either on.
func TestMuseDriverPrependsStandingInstructions(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir, Instructions: "Be terse.",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	drainMuse(t, driver)

	turn := museStubCall(t, museStubCalls(t, logPath), "turn/start")
	input, _ := turn["input"].([]any)
	if len(input) != 1 {
		t.Fatalf("turn/start input = %v, want the prompt as one text part", turn["input"])
	}
	part, _ := input[0].(map[string]any)
	text, _ := part["text"].(string)
	if !strings.Contains(text, "Dashboard") || !strings.Contains(text, "Be terse.") ||
		!strings.Contains(text, "say hello") {
		t.Errorf("turn/start text = %q, want the briefing, the instructions and the prompt", text)
	}
}

// A continued turn resumes the conversation's session, selects the model and the mode for this
// turn, and runs at the conversation's effort: the mode is selected on every turn rather than only
// at creation, because a prompt may override it.
func TestMuseDriverResumesAndSelectsModelModeAndEffort(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "again", WorkDir: dir, StoreRoot: dir, SessionID: "ses-9",
		Model: "meta/muse-spark-1.2", Effort: "ultra",
		PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != harnessapi.EventSession || got[0].SessionID != "ses-9" {
		t.Fatalf("events = %+v, want the resumed session announced", got)
	}

	calls := museStubCalls(t, logPath)
	if resume := museStubCall(t, calls, "session/resume"); resume["sessionId"] != "ses-9" {
		t.Errorf("resume = %v, want the conversation's session", resume)
	}
	setModel := museStubCall(t, calls, "session/setModel")
	model, _ := setModel["model"].(map[string]any)
	if model["modelId"] != "meta/muse-spark-1.2" {
		t.Errorf("setModel = %v, want the turn's model", setModel)
	}
	if mode := museStubCall(t, calls, "session/setApprovalMode"); mode["mode"] != "allowAll" {
		t.Errorf("setApprovalMode = %v, want a bypass turn to ask about nothing", mode)
	}
	if turn := museStubCall(t, calls, "turn/start"); turn["reasoningEffort"] != "ultra" {
		t.Errorf("turn/start = %v, want the conversation's effort", turn)
	}
}

// A fork's first turn branches off the copied session at the copied history's end: the turn runs
// on the branch, and announces the branch's own id.
func TestMuseDriverForksSessions(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "fork")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "on the branch", WorkDir: dir, StoreRoot: dir,
		SessionID: "ses-9", ForkSession: true, ResumeAt: "turn-7",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != harnessapi.EventSession || got[0].SessionID != "ses-fork" {
		t.Fatalf("events = %+v, want the branch announced", got)
	}
	calls := museStubCalls(t, logPath)
	fork := museStubCall(t, calls, "session/fork")
	if fork["sessionId"] != "ses-9" {
		t.Errorf("fork = %v, want the copied session as the source", fork)
	}
	cut, _ := fork["cutPoint"].(map[string]any)
	if cut["lastTurnId"] != "turn-7" {
		t.Errorf("fork = %v, want the copy cut at the copied history's end", fork)
	}
}

// The host's birth-time refusal names the muse command's bug, with no host internals.
func TestMuseDriverNamesTheMuseBugWhenForkHasNoBirthTime(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "fork-no-birth-time")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "on the branch", WorkDir: dir, StoreRoot: dir,
		SessionID: "ses-9", ForkSession: true,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 || got[0].Kind != harnessapi.EventFailure || got[1].Kind != harnessapi.EventDone || got[1].ExitCode != 1 {
		t.Fatalf("events = %+v, want a failure and a non-zero end, and no session", got)
	}
	if msg := got[0].Message; !strings.Contains(msg, "bug in the muse command") ||
		!strings.Contains(msg, "session/fork") || !strings.Contains(msg, "birth time") ||
		strings.Contains(msg, "internal error") {
		t.Errorf("failure = %q, want the muse bug named with session/fork and birth time only", msg)
	}
}

// A session the host would not open is not a turn that never ran: the failure and a non-zero end
// with no session announced is what the hub reads as a lost session, and the next turn starts
// fresh instead of asking again.
func TestMuseDriverTreatsARefusedResumeAsALostSession(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "resume-fail")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "again", WorkDir: dir, StoreRoot: dir, SessionID: "ses-gone",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 {
		t.Fatalf("events = %+v, want a failure and a done, and no session", got)
	}
	if got[0].Kind != harnessapi.EventFailure || !strings.Contains(got[0].Message, "resumed") {
		t.Errorf("first event = %+v, want the resume refusal as a sentence", got[0])
	}
	if got[1].Kind != harnessapi.EventDone || got[1].ExitCode != 1 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[1])
	}
}

// An approval parks the turn on a card naming the call, and the decision echoes the requirement
// the ask opened with: the multi-stage race guard. An allow answers the call's own choice —
// never the session-scoped one — and a deny carries the reason as feedback.
func TestMuseDriverAsksAndIsAnswered(t *testing.T) {
	for _, tc := range []struct {
		name     string
		allow    bool
		choiceID string
	}{
		{"allow", true, "allow-once"},
		{"deny", false, "deny"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			driver, logPath := museStubDriver(t, "ask")
			if err := driver.Spawn(harnessapi.HarnessRun{
				Prompt: "list things", WorkDir: dir, StoreRoot: dir,
				PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
			}); err != nil {
				t.Fatalf("Spawn = %v", err)
			}
			events := driver.Events()
			if first := museNext(t, events); first.Kind != harnessapi.EventSession {
				t.Fatalf("first event = %+v, want the session", first)
			}
			asked := museNext(t, events)
			if asked.Kind != harnessapi.EventAsk {
				t.Fatalf("second event = %+v, want the ask", asked)
			}
			ask := asked.Ask
			if ask.Tool != "shell" || !strings.Contains(ask.Description, "ls /tmp") {
				t.Errorf("ask = %+v, want the call named by its target", ask)
			}
			if !strings.Contains(ask.InputSummary, "ls /tmp") {
				t.Errorf("ask summary = %q, want the input rendered for deciding on", ask.InputSummary)
			}
			decision := harnessapi.AskDecision{Allow: tc.allow, Input: ask.Input}
			if !tc.allow {
				decision.Message = "not now"
			}
			if err := driver.Answer(ask.ID, decision); err != nil {
				t.Fatalf("Answer = %v", err)
			}
			var rest []harnessapi.HarnessEvent
			timeout := time.After(15 * time.Second)
		collect:
			for {
				select {
				case event, ok := <-events:
					if !ok {
						break collect
					}
					rest = append(rest, event)
				case <-timeout:
					t.Fatal("the turn never ended")
				}
			}
			if len(rest) != 2 || rest[0].Kind != harnessapi.EventBlock || rest[1].Kind != harnessapi.EventDone {
				t.Fatalf("rest = %+v, want the reply and the end", rest)
			}

			decide := museStubCall(t, museStubCalls(t, logPath), "approval/decide")
			if decide["approvalId"] != "apv-1" || decide["choiceId"] != tc.choiceID {
				t.Errorf("decide = %v, want the approval decided with %s", decide, tc.choiceID)
			}
			requirement, _ := decide["requirementId"].(map[string]any)
			if requirement["approvalId"] != "apv-1" {
				t.Errorf("decide = %v, want the echoed requirement", decide)
			}
			if tc.allow {
				if _, has := decide["feedback"]; has {
					t.Errorf("decide = %v, want no feedback on an allow", decide)
				}
				return
			}
			if decide["feedback"] != "not now" {
				t.Errorf("decide = %v, want the reason carried as feedback", decide)
			}
		})
	}
}

// An approval settled without the hub — the judge, a timeout, another client — withdraws the card
// instead of leaving a choice that no longer has anywhere to go.
func TestMuseDriverWithdrawsForeignSettlements(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "ask-external")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "list things", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, an ask, a withdrawal and the end", got)
	}
	if got[0].Kind != harnessapi.EventSession || got[1].Kind != harnessapi.EventAsk {
		t.Fatalf("events = %+v, want the session and the ask first", got)
	}
	if got[2].Kind != harnessapi.EventWithdraw || got[2].AskID != got[1].Ask.ID {
		t.Errorf("third event = %+v, want the ask withdrawn", got[2])
	}
	if got[3].Kind != harnessapi.EventDone {
		t.Errorf("last event = %+v, want the end", got[3])
	}
}

// A question parks the turn on a card of its own, answered per question: an answer naming one of
// the question's options goes back as the selection, anything else as free text, and a card of
// nothing but blanks is declined outright.
func TestMuseDriverAsksQuestionsAndIsAnswered(t *testing.T) {
	for _, tc := range []struct {
		name    string
		answers map[string]any
		method  string
		check   func(t *testing.T, params map[string]any)
	}{
		{
			name:    "selections",
			answers: map[string]any{"First?": "Blue", "Pick?": "A, C"},
			method:  "userInput/answer",
			check: func(t *testing.T, params map[string]any) {
				entries, _ := params["answers"].([]any)
				if len(entries) != 2 {
					t.Fatalf("answers = %v, want one entry per question", params["answers"])
				}
				first, _ := entries[0].(map[string]any)
				if first["questionId"] != "q1" || first["selectedLabel"] != "Blue" {
					t.Errorf("first = %v, want the named option selected", first)
				}
				second, _ := entries[1].(map[string]any)
				labels, _ := second["selectedLabels"].([]any)
				if second["questionId"] != "q2" || len(labels) != 2 {
					t.Errorf("second = %v, want the two named labels", second)
				}
			},
		},
		{
			name:    "free text",
			answers: map[string]any{"First?": "Something else", "Pick?": ""},
			method:  "userInput/answer",
			check: func(t *testing.T, params map[string]any) {
				entries, _ := params["answers"].([]any)
				first, _ := entries[0].(map[string]any)
				if first["freeText"] != "Something else" {
					t.Errorf("first = %v, want the off-list answer as free text", first)
				}
				second, _ := entries[1].(map[string]any)
				if text, _ := second["freeText"].(string); text != "" {
					t.Errorf("second = %v, want the blank answered with no text", second)
				}
			},
		},
		{
			name:    "dismissed",
			answers: map[string]any{},
			method:  "userInput/cancel",
			check: func(t *testing.T, params map[string]any) {
				if params["userInputId"] != "u-1" {
					t.Errorf("cancel = %v, want the prompt declined", params)
				}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			driver, logPath := museStubDriver(t, "question")
			if err := driver.Spawn(harnessapi.HarnessRun{
				Prompt: "ask me", WorkDir: dir, StoreRoot: dir,
				PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true, AllowBypass: true,
			}); err != nil {
				t.Fatalf("Spawn = %v", err)
			}
			events := driver.Events()
			if first := museNext(t, events); first.Kind != harnessapi.EventSession {
				t.Fatalf("first event = %+v, want the session", first)
			}
			asked := museNext(t, events)
			if asked.Kind != harnessapi.EventAsk || !asked.Ask.IsQuestion() {
				t.Fatalf("second event = %+v, want the question", asked)
			}
			// A question in bypass mode: the mode governs tool calls, and a question put to the
			// user is not one of them — the driver asks it like any other.
			if len(asked.Ask.Questions) != 2 || len(asked.Ask.QuestionKeys) != 2 {
				t.Fatalf("ask = %+v, want the two questions with their keys", asked.Ask)
			}
			if asked.Ask.Questions[1]["multiSelect"] != true {
				t.Errorf("questions = %v, want the multi-select marked", asked.Ask.Questions)
			}
			updated := map[string]any{"userInputId": "u-1", "answers": tc.answers}
			if err := driver.Answer(asked.Ask.ID, harnessapi.AskDecision{Allow: true, Input: updated}); err != nil {
				t.Fatalf("Answer = %v", err)
			}
			timeout := time.After(15 * time.Second)
		collect:
			for {
				select {
				case event, ok := <-events:
					if !ok {
						break collect
					}
					if event.Kind != harnessapi.EventDone {
						t.Errorf("event = %+v, want the turn to end after the answers", event)
					}
				case <-timeout:
					t.Fatal("the turn never ended")
				}
			}
			tc.check(t, museStubCall(t, museStubCalls(t, logPath), tc.method))
		})
	}
}

// Say speaks into the running turn, and the reply it changes is the one already streaming:
// nothing is spawned, and no second turn starts.
func TestMuseDriverSteersARunningTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "steer")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "take your time", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	if err := driver.Say("meanwhile"); err != nil {
		t.Fatalf("Say = %v", err)
	}
	var rest []harnessapi.HarnessEvent
	timeout := time.After(15 * time.Second)
collect:
	for {
		select {
		case event, ok := <-events:
			if !ok {
				break collect
			}
			rest = append(rest, event)
		case <-timeout:
			t.Fatal("the turn never ended")
		}
	}
	if len(rest) != 2 || rest[0].Kind != harnessapi.EventBlock || rest[0].Block.Text != "steered: meanwhile" {
		t.Fatalf("rest = %+v, want the steered reply and the end", rest)
	}
	if rest[1].Kind != harnessapi.EventDone || rest[1].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", rest[1])
	}
	steer := museStubCall(t, museStubCalls(t, logPath), "turn/steer")
	input, _ := steer["input"].([]any)
	part, _ := input[0].(map[string]any)
	if part["text"] != "meanwhile" {
		t.Errorf("steer = %v, want the text folded into the running turn", steer)
	}
	if steer["expectedTurnId"] == "" {
		t.Errorf("steer = %v, want the turn named so input cannot leak into another", steer)
	}
	// The turn is over: speaking now is an error, and the message goes back to the box it was
	// typed in.
	if err := driver.Say("too late"); err == nil {
		t.Error("Say after the end must fail: there is no turn left to speak to")
	}
}

// A turn that failed reports the host's sentence and ends non-zero — after the blocks it did
// produce, which are still the turn's account of itself.
func TestMuseDriverFailsATurnWithTheHostSentence(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "fail")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "fail me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a block, a failure and a done", got)
	}
	if got[1].Kind != harnessapi.EventBlock || got[1].Block.Text != "partial" {
		t.Errorf("second event = %+v, want the block from before the failure", got[1])
	}
	if got[2].Kind != harnessapi.EventFailure || got[2].Message != "boom" {
		t.Errorf("third event = %+v, want the host's sentence", got[2])
	}
	if got[3].Kind != harnessapi.EventDone || got[3].ExitCode != 1 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[3])
	}
}

// A turn the host reclaims before running still ends: the schema emits no turn/completed for it,
// and SDK turn-waits settle on turn/unqueued too. Waiting for the completion that never comes is a
// turn that never ends.
func TestMuseDriverSettlesAnUnqueuedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "unqueued")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a failure and a done", got)
	}
	if got[1].Kind != harnessapi.EventFailure || got[1].Message == "" {
		t.Errorf("second event = %+v, want the sentence saying the turn never ran", got[1])
	}
	if got[2].Kind != harnessapi.EventDone || got[2].ExitCode != 1 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[2])
	}
}

// A host that stays blocked without ending its turn is resumed once, then ended: the first
// idle wait stops the turn and asks it to pick itself back up, the second one fails it with
// the sentence the chain runner forks on — instead of holding the conversation busy
// forever.
func TestMuseDriverEndsATurnGoneQuiet(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "silent")
	driver.IdleTimeout = 50 * time.Millisecond
	tracePath := filepath.Join(t.TempDir(), "trace.jsonl")
	traceFile, err := os.Create(tracePath)
	if err != nil {
		t.Fatalf("trace file: %v", err)
	}
	defer traceFile.Close()
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: &turntrace.TurnTrace{File: traceFile},
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a resume notice, a failure and a done", got)
	}
	if got[1].Kind != harnessapi.EventNotice || !strings.Contains(got[1].Message, "resumes where it stood") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != harnessapi.EventFailure || got[2].Message != harnessfaults.MuseBlockedTwiceMessage {
		t.Errorf("third event = %+v, want the sentence saying the host blocked twice", got[2])
	}
	if got[3].Kind != harnessapi.EventDone || got[3].ExitCode != 1 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[3])
	}
	content, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("trace file: %v", err)
	}
	if !strings.Contains(string(content), `"kind":"note"`) ||
		!strings.Contains(string(content), "blocked twice") {
		t.Errorf("trace = %q, want the note saying the idle wait ended the turn", content)
	}
	if !strings.Contains(string(content), "the host sent nothing") {
		t.Errorf("trace = %q, want the note saying nothing arrived before the silence", content)
	}
}

// A blocked turn that answers after its resume ends as one answered turn: the resume goes out
// on the same session asking to pick the work back up, and whatever the resumed turn says is
// the turn's own — the run waiting on it never sees the blockage as a failure.
func TestMuseDriverResumesABlockedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "silent-then-blocks")
	driver.IdleTimeout = 100 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a resume notice, a block and a done", got)
	}
	if got[0].Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != harnessapi.EventNotice || !strings.Contains(got[1].Message, "relance 1") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != harnessapi.EventBlock || got[2].Block.Text != "hello from stub" {
		t.Errorf("third event = %+v, want the resumed turn's reply", got[2])
	}
	if last := got[3]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
	var starts []museStubLog
	for _, call := range museStubCalls(t, logPath) {
		if call.Method == "turn/start" {
			starts = append(starts, call)
		}
	}
	if len(starts) != 2 {
		t.Fatalf("turn/start calls = %d, want the blocked turn and its resume", len(starts))
	}
	input, _ := starts[1].Params["input"].([]any)
	if len(input) == 0 {
		t.Fatalf("resume turn/start = %v, want the resume prompt as its input", starts[1].Params)
	}
	part, _ := input[0].(map[string]any)
	if text, _ := part["text"].(string); !strings.Contains(text, MuseBlockedResumePrompt) {
		t.Errorf("resume input = %q, want %q", text, MuseBlockedResumePrompt)
	}
	cancels := 0
	for _, call := range museStubCalls(t, logPath) {
		if call.Method == "turn/cancel" {
			cancels++
		}
	}
	if cancels != 1 {
		t.Errorf("turn/cancel calls = %d, want the blocked turn stopped once", cancels)
	}
}

func TestMuseUsageRetainsTheBlockedNativeTurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "usage-then-resume")
	driver.IdleTimeout, driver.NoticeTimeout = 100*time.Millisecond, time.Hour
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatal(err)
	}
	events := drainMuse(t, driver)
	var usage *harnessapi.TurnUsage
	for _, event := range events {
		if event.Kind == harnessapi.EventUsage {
			usage = event.Usage
		}
	}
	if usage == nil || usage.InputTokens != 300 || usage.OutputTokens != 30 {
		t.Fatalf("usage = %+v, want both native turns in the task bill", usage)
	}
	if last := events[len(events)-1]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Fatalf("last event = %+v, want successful recovery", last)
	}
}

// A turn silent for the whole idle wait is polled before it is concluded: the session view
// replays the end the dead stream dropped, so a turn that finished ends clean — its late
// block lands as its own and no resume starts, no blockage is forked.
func TestMuseDriverResyncsAQuietTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "resync-end")
	driver.IdleTimeout = 50 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	driver.ResyncTimeout = 5 * time.Second
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, the replayed block and a done", got)
	}
	if got[0].Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != harnessapi.EventBlock || got[1].Block.Text != "late hello from the view" {
		t.Errorf("second event = %+v, want the block replayed from the session view", got[1])
	}
	if last := got[2]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
	for _, event := range got {
		if event.Kind == harnessapi.EventFailure {
			t.Errorf("event = %+v, want no failure on a turn that finished", event)
		}
	}
	starts := 0
	for _, call := range museStubCalls(t, logPath) {
		if call.Method == "turn/start" {
			starts++
		}
	}
	if starts != 1 {
		t.Errorf("turn/start calls = %d, want the one blocked turn and no resume", starts)
	}
}

// A turn parked on asks the stream never delivered waits on instead of concluding a
// blockage: the first resync names the blind park and restarts the wait, and only the
// blockage after it resumes — into a turn that answers.
func TestMuseDriverResyncsABlindPark(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "resync-parked")
	driver.IdleTimeout = 50 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	driver.ResyncTimeout = 5 * time.Second
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 5 {
		t.Fatalf("events = %+v, want a session, a blind-park notice, a resume, a block and a done", got)
	}
	if got[1].Kind != harnessapi.EventNotice || !strings.Contains(got[1].Message, "never arrived") {
		t.Errorf("second event = %+v, want the notice naming the unseen asks", got[1])
	}
	if got[2].Kind != harnessapi.EventNotice || !strings.Contains(got[2].Message, "relance 1") {
		t.Errorf("third event = %+v, want the resume notice", got[2])
	}
	if got[3].Kind != harnessapi.EventBlock || got[3].Block.Text != "hello from stub" {
		t.Errorf("fourth event = %+v, want the resumed turn's reply", got[3])
	}
	if last := got[4]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
}

// A session read the status vocabulary has moved past concludes nothing: unloaded is
// neither idle nor running, so the blockage runs its course to the resume and the fork
// instead of ending a turn that may still run as cleanly finished.
func TestMuseDriverResyncIgnoresUnknownStatus(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "resync-notloaded")
	driver.IdleTimeout = 50 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	driver.ResyncTimeout = 5 * time.Second
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a resume notice, a failure and a done", got)
	}
	if got[1].Kind != harnessapi.EventNotice || !strings.Contains(got[1].Message, "relance 1") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != harnessapi.EventFailure || got[2].Message != harnessfaults.MuseBlockedTwiceMessage {
		t.Errorf("third event = %+v, want the sentence saying the host blocked twice", got[2])
	}
	if last := got[3]; last.Kind != harnessapi.EventDone || last.ExitCode == 0 {
		t.Errorf("last event = %+v, want a non-zero agentDone, not a recovered end", last)
	}
}

// A turn parked on an ask the hub already holds is not a blind park: the approval was
// answered live and only its settlement never arrived, so the resync waits on without
// the "never arrived" notice — and the replayed block lands as the turn's own.
func TestMuseDriverResyncWaitsOnKnownAsks(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "ask-then-silent")
	driver.IdleTimeout = 50 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	driver.ResyncTimeout = 5 * time.Second
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	asked := museNext(t, events)
	if asked.Kind != harnessapi.EventAsk {
		t.Fatalf("second event = %+v, want the live ask", asked)
	}
	if err := driver.Answer(asked.Ask.ID, harnessapi.AskDecision{Allow: true, Input: asked.Ask.Input}); err != nil {
		t.Fatalf("Answer = %v", err)
	}
	// Past the idle wait the resync replays the late block and waits on: the pending
	// ask is the one just answered, so no blind-park notice names it.
	replayed := museNext(t, events)
	if replayed.Kind != harnessapi.EventBlock || replayed.Block.Text != "late hello from the view" {
		t.Fatalf("third event = %+v, want the block replayed from the session view", replayed)
	}
	notice := museNext(t, events)
	if notice.Kind != harnessapi.EventNotice || !strings.Contains(notice.Message, "replayed") {
		t.Fatalf("fourth event = %+v, want the notice naming the replay", notice)
	}
	if strings.Contains(notice.Message, "never arrived") {
		t.Errorf("notice = %q, want no blind-park claim about an answered ask", notice.Message)
	}
	driver.Stop()
	drainMuse(t, driver)
	starts := 0
	for _, call := range museStubCalls(t, logPath) {
		if call.Method == "turn/start" {
			starts++
		}
	}
	if starts != 1 {
		t.Errorf("turn/start calls = %d, want the one turn and no resume", starts)
	}
}

// The host's own verdict on its live view goes out once, on the transition: from here the
// turn is polled rather than followed, and whatever it still says lands as its own.
func TestMuseDriverNamesADeadView(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "view-down")
	driver.NoticeTimeout = time.Hour
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, the view notice, a block and a done", got)
	}
	if got[1].Kind != harnessapi.EventNotice || got[1].Message != MuseViewDownMessage {
		t.Errorf("second event = %+v, want the notice saying the live view is down", got[1])
	}
	if got[2].Kind != harnessapi.EventBlock || got[2].Block.Text != "hello from stub" {
		t.Errorf("third event = %+v, want the turn's own reply after the verdict", got[2])
	}
	if last := got[3]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
}

// Once resumed, the silence keeps naming itself every minute and says how many resumes the
// turn holds — so a turn blocked again reads as waiting on its second blockage, not its
// first.
func TestMuseDriverNoticeNamesRelaunches(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "silent")
	driver.NoticeTimeout = 50 * time.Millisecond
	driver.IdleTimeout = 175 * time.Millisecond
	trace, _ := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	// A turn without a blockage shows no retry counter.
	nudge := museNext(t, events)
	if nudge.Kind != harnessapi.EventNotice || strings.Contains(nudge.Message, "relance") {
		t.Fatalf("first notice = %+v, want the bare silence with no counter", nudge)
	}
	// Past the resume every naming of the silence carries the count.
	for {
		event := museNext(t, events)
		if event.Kind == harnessapi.EventNotice && strings.Contains(event.Message, "(relance 1)") {
			break
		}
		if event.Kind == harnessapi.EventDone {
			t.Fatalf("turn ended before naming the silence with its relance: %+v", event)
		}
	}
	driver.Stop()
	drainMuse(t, driver)
}

// A turn files the run's own ids as the host answered them: the trace's run record names
// this turn, and the note names the run the host executes for it — the id a post-mortem
// joins the host's own journal on.
func TestMuseDriverNotesItsSessionAndTurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "blocks")
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	drainMuse(t, driver)
	content := museTraceText(t, tracePath)
	if !strings.Contains(content, "muse turn ") || !strings.Contains(content, "on session ses-1") {
		t.Errorf("trace = %q, want the note naming the host's turn and session", content)
	}
}

// Every end files what the host sent along the way: counted by method, the last one named —
// the record a turn that never ended is read for.
func TestMuseDriverNotesItsNotificationCensus(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "blocks")
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	drainMuse(t, driver)
	content := museTraceText(t, tracePath)
	want := `muse turn completed; 6 events (item/completed=5 turn/completed=1), last turn/completed`
	if !strings.Contains(content, want) {
		t.Errorf("trace = %q, want the census %q", content, want)
	}
}

// A stopped turn says so in the trace, with what had arrived before the stop — rather than a
// pipe that simply ended with no word on why.
func TestMuseDriverNotesAStoppedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "cancel")
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "never mind", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	driver.Stop()
	drainMuse(t, driver)
	content := museTraceText(t, tracePath)
	want := "muse turn stopped by the service; the host sent nothing"
	if !strings.Contains(content, want) {
		t.Errorf("trace = %q, want %q", content, want)
	}
}

// A gap the host admits — events it could not deliver — goes in the trace with what the host
// said about it, not only in the service log.
func TestMuseDriverNotesAViewGap(t *testing.T) {
	trace, tracePath := museTrace(t)
	driver := &MuseDriver{
		EventStream: make(chan harnessapi.HarnessEvent),
		Run:         harnessapi.HarnessRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	done, _, _ := driver.relayOne(MspNotification{
		Method: "view/gap", Params: json.RawMessage(`{"cursor":"v9"}`),
	})
	if done {
		t.Fatal("relayOne(view/gap) ended the turn")
	}
	content := museTraceText(t, tracePath)
	// The file holds the note as JSON, so the params arrive escaped — the assertion reads
	// through the escaping rather than around it.
	want := `muse view gap; the turn lost events: {\"cursor\":\"v9\"}`
	if !strings.Contains(content, want) {
		t.Errorf("trace = %q, want %q", content, want)
	}
}

// A host that answers its turn but never the harvest's quota question still ends it: the usage
// read times out, the quota keeps its last figures, and the turn settles clean.
func TestMuseDriverHarvestTimeoutStillEndsTheTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "usage-silent")
	driver.UsageTimeout = 50 * time.Millisecond
	// A driver built by hand harvests nothing: the usage service is what sends the turn's
	// end to ask the host what it observed.
	driver.Usage = NewMuseUsageService()
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[2].Kind != harnessapi.EventDone || got[2].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", got[2])
	}
	museStubCall(t, museStubCalls(t, logPath), "usage/read")
}

// A turn that ends with a background workflow still running drains it before
// ending: the host stays up past the turn's end, the run's completion lands as
// the turn's own block, and only then does the turn settle — on the end it
// deferred, not on a new one. Killing the host at the turn's end instead would
// orphan the run with it.
func TestMuseDriverDrainsABackgroundWorkflow(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "drain")
	driver.Usage = NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run the inventory", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 9 {
		t.Fatalf("events = %+v, want a session, the roster opening, a block, a drain notice, two roster updates, the run's block, an end notice and a done", got)
	}
	if got[0].Kind != harnessapi.EventSession {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	roster := func(event harnessapi.HarnessEvent, where string) harnessapi.BackgroundTask {
		t.Helper()
		if event.Kind != harnessapi.EventBackground || len(event.Background) != 1 {
			t.Fatalf("%s = %+v, want the roster carrying the workflow alone", where, event)
		}
		return event.Background[0]
	}
	opened := roster(got[1], "second event")
	if opened.Kind != "workflow" || opened.State != harnessapi.BackgroundRunning || len(opened.Children) != 0 {
		t.Errorf("opened roster = %+v, want the workflow running with no children yet", opened)
	}
	if got[2].Kind != harnessapi.EventBlock || got[2].Block.Text != "launched" {
		t.Errorf("third event = %+v, want the turn's reply", got[2])
	}
	if got[3].Kind != harnessapi.EventNotice || !strings.Contains(got[3].Message, "still running") {
		t.Errorf("fourth event = %+v, want the notice saying the turn waits on background work", got[3])
	}
	updated := roster(got[4], "fifth event")
	if len(updated.Children) != 2 {
		t.Fatalf("updated roster = %+v, want the workflow's two children", updated)
	}
	if first, second := updated.Children[0], updated.Children[1]; first.ChildID != "research" ||
		first.State != harnessapi.BackgroundFinished || second.ChildID != "synthesis" || second.State != harnessapi.BackgroundRunning {
		t.Errorf("children = %+v, want research finished and synthesis running", updated.Children)
	}
	landed := roster(got[5], "sixth event")
	if landed.State != harnessapi.BackgroundFinished || landed.Status != "completed" {
		t.Errorf("landed roster = %+v, want the workflow finished on its verdict", landed)
	}
	if got[6].Kind != harnessapi.EventBlock || got[6].Block.Text != "inventory done" {
		t.Errorf("seventh event = %+v, want the workflow's completion as the turn's own block", got[6])
	}
	if got[6].MessageID == "" {
		t.Error("the drained block must carry the turn id: it is where a fork picks the session up")
	}
	if got[7].Kind != harnessapi.EventNotice {
		t.Errorf("eighth event = %+v, want the notice closing the drain", got[7])
	}
	if last := got[8]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 || last.Terminal != "completed" {
		t.Errorf("last event = %+v, want a clean done on the deferred end", last)
	}
	// The host outlived the turn's end: the reconcile and the harvest both ran
	// against it, in that order — the quota the turn brings back covers the
	// drained work too.
	var sawReconcile, sawHarvestAfter bool
	for _, call := range museStubCalls(t, logPath) {
		switch call.Method {
		case "session/read":
			sawReconcile = true
		case "usage/read":
			sawHarvestAfter = sawReconcile
		}
	}
	if !sawReconcile {
		t.Error("the stub was never asked session/read: the drain reconciled nothing")
	}
	if !sawHarvestAfter {
		t.Error("usage/read did not run after the reconcile: the host did not outlive the turn's end")
	}
	content := museTraceText(t, tracePath)
	if !strings.Contains(content, "draining before ending") {
		t.Errorf("trace = %q, want the note saying the turn drains before ending", content)
	}
	if !strings.Contains(content, "after draining 1 background task") {
		t.Errorf("trace = %q, want the end note naming the drained work", content)
	}
}

// A drain that outlasts its bound ends anyway: the turn settles on the end it
// deferred, and the work still out is named as abandoned — the close that
// follows stops it with its host — rather than holding the conversation busy
// past any scrutiny.
func TestMuseDriverDrainTimesOutAndNamesAbandonedWork(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "drain-stuck")
	driver.DrainTimeout = 50 * time.Millisecond
	driver.Usage = NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run the inventory", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 6 {
		t.Fatalf("events = %+v, want a session, the roster opening, a block, a drain notice, a timeout notice and a done", got)
	}
	if got[1].Kind != harnessapi.EventBackground || len(got[1].Background) != 1 ||
		got[1].Background[0].State != harnessapi.BackgroundRunning {
		t.Errorf("second event = %+v, want the roster carrying the workflow running", got[1])
	}
	if got[3].Kind != harnessapi.EventNotice || !strings.Contains(got[3].Message, "still running") {
		t.Errorf("fourth event = %+v, want the notice saying the turn waits on background work", got[3])
	}
	if got[4].Kind != harnessapi.EventNotice || !strings.Contains(got[4].Message, "ending the turn without") {
		t.Errorf("fifth event = %+v, want the notice saying the drain timed out", got[4])
	}
	if last := got[5]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 || last.Terminal != "completed" {
		t.Errorf("last event = %+v, want a clean done on the deferred end", last)
	}
	content := museTraceText(t, tracePath)
	if !strings.Contains(content, "drain timed out") || !strings.Contains(content, "abandoned") {
		t.Errorf("trace = %q, want the note naming the abandoned work", content)
	}
	// The file holds the notes as JSON: decode them and read the abandoned
	// workflow's label through the escaping rather than around it.
	var namesWorkflow bool
	for _, line := range strings.Split(strings.TrimSpace(content), "\n") {
		var note struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(line), &note); err != nil {
			continue
		}
		if strings.Contains(note.Text, `workflow "inventory"`) {
			namesWorkflow = true
		}
	}
	if !namesWorkflow {
		t.Errorf("trace = %q, want the abandoned workflow named", content)
	}
}

// The drain reconciles session state before waiting, so a missed completion
// leaves no outstanding work and the turn ends immediately.
func TestMuseDriverDrainSkipsWorkTheSessionShowsFinished(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "drain-stale")
	driver.Usage = NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run the inventory", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 5 {
		t.Fatalf("events = %+v, want a session, the roster opening, a block, the reconcile settling the roster and a done, with no drain notices", got)
	}
	for _, event := range got {
		if event.Kind == harnessapi.EventNotice {
			t.Errorf("event = %+v, want no drain notice for finished work", event)
		}
	}
	if got[1].Kind != harnessapi.EventBackground || len(got[1].Background) != 1 ||
		got[1].Background[0].State != harnessapi.BackgroundRunning {
		t.Errorf("second event = %+v, want the roster carrying the workflow running", got[1])
	}
	// The reconcile found the completion the stream dropped: the roster it
	// settles is what the drain skips waiting on, so the event lands between
	// the reply and the done.
	if got[3].Kind != harnessapi.EventBackground || len(got[3].Background) != 1 ||
		got[3].Background[0].State != harnessapi.BackgroundFinished {
		t.Errorf("fourth event = %+v, want the reconcile settling the roster finished", got[3])
	}
	if last := got[4]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
	content := museTraceText(t, tracePath)
	if !strings.Contains(content, "reconciled") {
		t.Errorf("trace = %q, want the note saying the live set was reconciled", content)
	}
}

// Only work that may outlive its turn holds the drain: a workflow run, a
// subagent delegation, a backgrounded tool call. Everything else — a foreground
// call, the host's own housekeeping, a turn's own words — never does.
func TestMuseBackgroundKind(t *testing.T) {
	cases := []struct {
		name string
		item map[string]any
		want bool
	}{
		{"workflow", map[string]any{"kind": "workflow"}, true},
		{"subagent", map[string]any{"kind": "subagent"}, true},
		{"backgrounded tool call", map[string]any{"kind": "toolCall", "background": true}, true},
		{"foreground tool call", map[string]any{"kind": "toolCall"}, false},
		{"harness message", map[string]any{"kind": "agentMessage"}, false},
		{"reasoning", map[string]any{"kind": "reasoning"}, false},
		{"reminder child", map[string]any{"kind": "reminderChild"}, false},
		{"user shell", map[string]any{"kind": "userShell"}, false},
		{"compaction", map[string]any{"kind": "compaction"}, false},
		{"unknown kind", map[string]any{"kind": "something-new"}, false},
		{"no kind", map[string]any{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MuseBackgroundKind(tc.item); got != tc.want {
				t.Errorf("background kind = %v, want %v", got, tc.want)
			}
		})
	}
}

// Background items opening and updating are tracked while they run, forgotten
// when they finish — and only this turn's: a dead turn's work must never hold
// this one's end.
func TestMuseDriverTracksOnlyItsOwnBackgroundWork(t *testing.T) {
	trace, _ := museTrace(t)
	driver := &MuseDriver{
		EventStream: make(chan harnessapi.HarnessEvent, 8),
		Run:         harnessapi.HarnessRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	driver.host.turnID = "turn-1"
	feed := func(method, itemID, kind, status, turn string) {
		t.Helper()
		params, _ := json.Marshal(map[string]any{
			"sessionId": "ses-1",
			"item": map[string]any{"kind": kind, "itemId": itemID,
				"turnId": turn, "status": status, "entryId": "inventory"},
		})
		if done, _, _ := driver.relayOne(MspNotification{Method: method, Params: params}); done {
			t.Fatalf("relayOne(%s) ended the turn", method)
		}
	}
	feed("item/started", "item-wf", "workflow", "inProgress", "turn-1")
	feed("item/started", "item-fg", "toolCall", "inProgress", "turn-1")
	feed("item/started", "item-old", "workflow", "inProgress", "turn-0")
	if got := driver.openWorkCount(); got != 1 {
		t.Fatalf("open work = %d, want the turn's workflow alone", got)
	}
	// An update re-files the same work rather than doubling it; a terminal
	// update forgets it outright.
	feed("item/updated", "item-wf", "workflow", "inProgress", "turn-1")
	if got := driver.openWorkCount(); got != 1 {
		t.Fatalf("open work after an update = %d, want 1", got)
	}
	feed("item/updated", "item-wf", "workflow", "completed", "turn-1")
	if got := driver.openWorkCount(); got != 0 {
		t.Fatalf("open work after a terminal update = %d, want 0", got)
	}
}

// A completion untracks background work whatever turn it names — and work of
// the turn that just ended still files its block under that turn's id, which
// is what the drain reads back.
func TestMuseCompletedItemUntracksAndKeepsTheDrainedTurn(t *testing.T) {
	trace, _ := museTrace(t)
	driver := &MuseDriver{
		EventStream: make(chan harnessapi.HarnessEvent, 8),
		Run:         harnessapi.HarnessRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	driver.host.turnID = ""
	driver.host.lastTurnID = "turn-9"
	driver.background.open = map[string]MuseWorkItem{"item-wf": {Kind: "workflow", Label: `workflow "inventory"`}}
	params := map[string]any{
		"sessionId": "ses-1",
		"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
			"turnId": "turn-9", "status": "completed", "fallbackText": "inventory done"},
	}
	events := driver.completedItem(params)
	if len(events) != 2 || events[0].Kind != harnessapi.EventBackground || events[1].Kind != harnessapi.EventBlock {
		t.Fatalf("completedItem = %+v, want the roster settling first and the drained block after", events)
	}
	if len(events[0].Background) != 1 || events[0].Background[0].State != harnessapi.BackgroundFinished {
		t.Errorf("roster = %+v, want the workflow finished", events[0].Background)
	}
	if events[1].MessageID != "turn-9" {
		t.Errorf("MessageID = %q, want the ended turn's id", events[1].MessageID)
	}
	if got := driver.openWorkCount(); got != 0 {
		t.Errorf("open work = %d, want the completion untracked", got)
	}
}

// Parked on something only a person can answer, a silent turn is waiting rather than wedged: the
// idle wait starts over for as long as the ask stands, and the turn ends when it is stopped.
func TestMuseDriverParkedTurnSurvivesQuiet(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "ask")
	driver.IdleTimeout = 50 * time.Millisecond
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "list the files", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	if second := museNext(t, events); second.Kind != harnessapi.EventAsk {
		t.Fatalf("second event = %+v, want the ask", second)
	}
	select {
	case event := <-events:
		t.Fatalf("parked turn ended while waiting: %+v", event)
	case <-time.After(6 * 50 * time.Millisecond):
	}
	driver.Stop()
	var rest []harnessapi.HarnessEvent
	timeout := time.After(15 * time.Second)
collect:
	for {
		select {
		case event, ok := <-events:
			if !ok {
				break collect
			}
			rest = append(rest, event)
		case <-timeout:
			t.Fatal("the turn never ended")
		}
	}
	if len(rest) != 1 || rest[0].Kind != harnessapi.EventDone || rest[0].ExitCode != -1 {
		t.Errorf("rest = %+v, want the service-ended done and nothing else", rest)
	}
}

// A stopped turn ends as one this service ended, whatever the host still held.
func TestMuseDriverStopsATurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "cancel")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "never mind", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	driver.Stop()
	driver.Stop() // idempotent: the second one is silence
	var rest []harnessapi.HarnessEvent
	timeout := time.After(15 * time.Second)
collect:
	for {
		select {
		case event, ok := <-events:
			if !ok {
				break collect
			}
			rest = append(rest, event)
		case <-timeout:
			t.Fatal("the turn never ended")
		}
	}
	if len(rest) != 1 || rest[0].Kind != harnessapi.EventDone || rest[0].ExitCode != -1 {
		t.Errorf("rest = %+v, want the service-ended done and nothing else", rest)
	}
}

// `/compact` shortens the session instead of starting a turn: no prompt goes anywhere, and the
// turn ends on the compaction landing. With no session there is nothing to shorten, and no host
// is spawned at all.
func TestMuseDriverCompactsSessions(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "compact")
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "/compact", WorkDir: dir, StoreRoot: dir, SessionID: "ses-1",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != harnessapi.EventSession {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[1].Kind != harnessapi.EventBlock || !strings.Contains(got[1].Block.Text, "compacted") {
		t.Errorf("second event = %+v, want the compaction said in the transcript", got[1])
	}
	if got[2].Kind != harnessapi.EventDone || got[2].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", got[2])
	}
	calls := museStubCalls(t, logPath)
	compact := museStubCall(t, calls, "session/compact")
	if compact["sessionId"] != "ses-1" {
		t.Errorf("compact = %v, want the conversation's session shortened", compact)
	}
	for _, call := range calls {
		if call.Method == "turn/start" {
			t.Error("a compaction must start no turn")
		}
	}
}

// Nothing to shorten, and provably no host: the binary does not exist, and the turn says so
// without ever reaching for it.
func TestMuseDriverCompactWithNoSessionSpawnsNothing(t *testing.T) {
	dir := t.TempDir()
	driver := &MuseDriver{
		Binary:      filepath.Join(dir, "no-such-host"),
		EventStream: make(chan harnessapi.HarnessEvent),
		Cfg:         &runnerconfig.Config{},
	}
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "  /compact  ", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 || got[0].Kind != harnessapi.EventBlock || got[1].Kind != harnessapi.EventDone {
		t.Fatalf("events = %+v, want the notice and a clean done", got)
	}
}

// A turn handed servers runs pointed at its own staged configuration: the ledger's servers with
// the token written in. The staging is gone by the time the turn ends — it held the credential.
func TestMuseDriverRunsAStagedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	fragment := BuildMuseMCPConfig(mcpServersFixture())
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "with tools", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		MCPConfig: fragment, MCPToken: "turn-token",
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[2].Kind != harnessapi.EventDone || got[2].ExitCode != 0 {
		t.Fatalf("events = %+v, want the turn to run cleanly", got)
	}
	calls := museStubCalls(t, logPath)
	staged, _ := museStubCall(t, calls, "env")["XDG_CONFIG_HOME"].(string)
	if staged == "" || !strings.Contains(staged, "muse-turn-") {
		t.Fatalf("env = %v, want the host pointed at a staged configuration", calls)
	}
	settings, _ := museStubCall(t, calls, "settings")["content"].(string)
	if !strings.Contains(settings, `"schema_version":1`) || !strings.Contains(settings, "turn-token") {
		t.Errorf("settings.json = %s, want the staged servers with the token written in", settings)
	}
	if !strings.Contains(settings, "kiao-files") {
		t.Errorf("settings.json = %s, want the ledger's servers staged for the turn", settings)
	}
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Errorf("staging = %s, want it removed with the turn's end: it held the credential", staged)
	}
}

// The stub proves the driver speaks the protocol; this proves the protocol is the CLI's. It
// drives the real `muse serve` through every call the driver makes that costs no login — the
// handshake, the catalogue, opening a session three ways — and nothing that would spend: no turn
// ever starts here. The sessions land in a worker-local store rather than the user's own, and the
// whole thing is skipped where the CLI is not installed.
func TestMuseServeLiveHandshake(t *testing.T) {
	if _, err := pkgExec.LookPath(MuseBinaryName); err != nil {
		t.Skip("no muse on PATH")
	}
	dir := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(dir, "data"))
	t.Setenv("XDG_STATE_HOME", filepath.Join(dir, "state"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, "config"))
	t.Setenv("HOME", dir)
	// Fully isolated: sessions, state and configuration all land under the worker's own
	// directory, and nothing is read from or written to the user's. Without a login the host
	// offers no model — which is fine, because no turn ever starts here; every call below is
	// local and costs nothing.

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	conn, err := SpawnMSP(ctx, MuseBinaryName, MuseServeArgs(), dir, os.Environ(), nil)
	if err != nil {
		t.Fatalf("handshake = %v", err)
	}
	defer conn.Close()

	raw, err := conn.Call("model/list", map[string]any{})
	if err != nil {
		t.Fatalf("model/list = %v", err)
	}
	var catalogue struct {
		Models []struct {
			ModelID string `json:"modelId"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		t.Fatalf("model/list = %s: %v", raw, err)
	}
	t.Logf("the host offers %d models", len(catalogue.Models))

	raw, err = conn.Call("session/start", map[string]any{
		"commandId": MspCommandID(), "workspaceRoot": dir, "approvalMode": "onRequest",
	})
	if err != nil {
		t.Fatalf("session/start = %v", err)
	}
	var started struct {
		Session struct {
			SessionID string `json:"sessionId"`
		} `json:"session"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.Session.SessionID == "" {
		t.Fatalf("session/start = %s: %v", raw, err)
	}
	raw, err = conn.Call("session/resume", map[string]any{
		"commandId": MspCommandID(), "sessionId": started.Session.SessionID,
		"excludeItems": true,
	})
	if err != nil {
		t.Fatalf("session/resume = %v", err)
	}
	raw, err = conn.Call("session/fork", map[string]any{
		"commandId": MspCommandID(), "sessionId": started.Session.SessionID,
	})
	if err != nil && !strings.Contains(err.Error(), "file birth time is unavailable") {
		t.Fatalf("session/fork = %v", err)
	}
	if err != nil {
		// The host has no file birth time on this harness, so it cannot fork.
		t.Logf("session/fork refused: %v", err)
	} else {
		var forked struct {
			Session struct {
				SessionID string `json:"sessionId"`
			} `json:"session"`
		}
		if err := json.Unmarshal(raw, &forked); err != nil {
			t.Fatalf("session/fork = %s: %v", raw, err)
		}
		if forked.Session.SessionID == "" || forked.Session.SessionID == started.Session.SessionID {
			t.Errorf("fork = %s, want a branch under an id of its own", raw)
		}
	}
	if _, err := conn.Call("session/setApprovalMode", map[string]any{
		"commandId": MspCommandID(), "sessionId": started.Session.SessionID,
		"mode": "allowAll",
	}); err != nil {
		t.Errorf("session/setApprovalMode = %v", err)
	}
}

// A host that would not start is the sentence the user is shown — and nothing is staged, streamed
// or left behind.
func TestMuseDriverSpawnFailureIsTheSentenceTheUserSees(t *testing.T) {
	dir := t.TempDir()
	driver := &MuseDriver{
		Binary:      filepath.Join(dir, "no-such-host"),
		EventStream: make(chan harnessapi.HarnessEvent),
		Cfg:         &runnerconfig.Config{},
	}
	err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	})
	if err == nil || !strings.Contains(err.Error(), "Muse") {
		t.Fatalf("Spawn = %v, want the Muse sentence", err)
	}
}

// As its turn ends, the driver asks the still-living host what it observed of the account, and
// the harness's quota answers it from then on: a refresh after a Muse turn is the last turn's
// figures. The turn's own events are untouched by the extra question.
func TestMuseDriverHarvestsTheQuotaAsTheTurnEnds(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	usage := NewMuseUsageService()
	driver.Usage = usage
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if last := got[len(got)-1]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Fatalf("last event = %+v, want a clean agentDone", last)
	}
	calls := museStubCalls(t, logPath)
	museStubCall(t, calls, "usage/read")
	dto, err := usage.GetUsage()
	if err != nil {
		t.Fatalf("the harvested quota should be answerable: %v", err)
	}
	want := []harnessapi.HarnessWindow{
		{WindowMinutes: 300, PercentUsed: 5, ResetAtEpochSeconds: 1789499596},
		{WindowMinutes: 10080, PercentUsed: 30, ResetAtEpochSeconds: 1789948800},
	}
	if !reflect.DeepEqual(dto.Windows, want) {
		t.Errorf("harvested windows = %+v, want %+v", dto.Windows, want)
	}
}

// A harvest that fails leaves the turn exactly as it was: the quota keeps whatever an older turn
// recorded, and the end is still the end.
func TestMuseDriverHarvestFailureLeavesTheTurnAlone(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "usage-fail")
	usage := NewMuseUsageService()
	older := harnessapi.HarnessUsageDto{Windows: []harnessapi.HarnessWindow{
		{WindowMinutes: 300, PercentUsed: 41, ResetAtEpochSeconds: 1789499596}}}
	usage.Note(older, 1789482441110)
	driver.Usage = usage
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if last := got[len(got)-1]; last.Kind != harnessapi.EventDone || last.ExitCode != 0 {
		t.Fatalf("last event = %+v, want a clean agentDone", last)
	}
	kept, err := usage.GetUsage()
	if err != nil {
		t.Fatalf("the older figures should still be answerable: %v", err)
	}
	if !reflect.DeepEqual(kept, older) {
		t.Errorf("quota = %+v, want the older turn's figures kept", kept)
	}
}

// The host's account figures moving mid-turn are recorded as they land, and emit nothing: a
// refresh answers the recorded figures. A notification the driver cannot understand is stepped
// over rather than failing anything.
func TestMuseDriverRecordsUsageChangedAsItLands(t *testing.T) {
	usage := NewMuseUsageService()
	driver := &MuseDriver{Usage: usage}

	changed := struct {
		Usage MuseSubscriptionUsage `json:"usage"`
	}{}
	if err := json.Unmarshal([]byte(museObservedUsage), &changed); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	params, err := json.Marshal(changed.Usage)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if done, _, _ := driver.relayOne(MspNotification{Method: "usage/changed", Params: params}); done {
		t.Error("usage/changed ends nothing")
	}
	dto, err := usage.GetUsage()
	if err != nil {
		t.Fatalf("the notified quota should be answerable: %v", err)
	}
	if len(dto.Windows) != 2 || dto.Windows[0].PercentUsed != 5 || dto.Windows[1].PercentUsed != 30 {
		t.Errorf("notified windows = %+v, want the observation's", dto.Windows)
	}

	// Malformed, and empty: heard, and kept out of the figures.
	before, _ := usage.GetUsage()
	if done, _, _ := driver.relayOne(MspNotification{Method: "usage/changed", Params: json.RawMessage(`{no`)}); done {
		t.Error("a malformed usage/changed ends nothing")
	}
	driver.relayOne(MspNotification{Method: "usage/changed", Params: json.RawMessage(`{}`)})
	after, _ := usage.GetUsage()
	if !reflect.DeepEqual(before, after) {
		t.Errorf("unreadable figures moved the quota: %+v vs %+v", before, after)
	}
}

// The census includes the elapsed silence in its last-event report.
// An interval under one second is omitted.
func TestMuseDriverCensusDatesTheSilence(t *testing.T) {
	quiet := &MuseDriver{}
	quiet.activity.note("item/completed")

	quiet.activity.at = time.Now().Add(-8*time.Minute - 12*time.Second)

	if got := quiet.activity.summary(); !strings.Contains(got, "; quiet for 8m12s") {
		t.Errorf("census = %q, want the eight-minute silence dated", got)
	}

	empty := &MuseDriver{}

	empty.activity.at = time.Now().Add(-90 * time.Second)

	if got := empty.activity.summary(); got != "the host sent nothing; quiet for 1m30s" {
		t.Errorf("empty census = %q, want the silence dated", got)
	}

	fresh := &MuseDriver{}
	fresh.activity.note("item/completed")
	if got := fresh.activity.summary(); strings.Contains(got, "quiet for") {
		t.Errorf("fresh census = %q, want no silence named", got)
	}

	never := &MuseDriver{}
	if got := never.activity.summary(); got != "the host sent nothing" {
		t.Errorf("unrelayed census = %q, want the bare sentence", got)
	}
}

// A silence past the notice wait names itself while it is still a turn: a notice to the user
// and a note in the trace, and then the wait starts over. The turn itself is untouched —
// ending one is the idle wait's job, not this one's.
func TestMuseDriverNudgeNamesASilence(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "silent")
	driver.NoticeTimeout = 50 * time.Millisecond
	driver.IdleTimeout = time.Hour
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	for i := 1; i <= 2; i++ {
		nudge := museNext(t, events)
		if nudge.Kind != harnessapi.EventNotice ||
			!strings.HasPrefix(nudge.Message, "Muse has been quiet for ") ||
			!strings.HasSuffix(nudge.Message, "; the turn is still running.") {
			t.Fatalf("notice %d = %+v, want the silence named", i, nudge)
		}
	}
	driver.Stop()
	rest := drainMuse(t, driver)
	if len(rest) != 1 || rest[0].Kind != harnessapi.EventDone || rest[0].ExitCode != -1 {
		t.Errorf("tail = %+v, want the stop's done alone", rest)
	}
	if content := museTraceText(t, tracePath); !strings.Contains(content, "still waiting on the host") {
		t.Errorf("trace = %q, want the note naming the silence", content)
	}
}

// Parked on something only a person can answer, the silence is the user's own deliberation —
// which needs no announcement, however long it runs.
func TestMuseDriverParkedTurnNudgesNothing(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "ask")
	driver.NoticeTimeout = 50 * time.Millisecond
	driver.IdleTimeout = time.Hour
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "list the files", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	for {
		event := museNext(t, events)
		if event.Kind == harnessapi.EventAsk {
			break
		}
		if event.Kind != harnessapi.EventNotice {
			t.Fatalf("event = %+v, want the ask or a notice before it arrives", event)
		}
	}
	beforeAsk := museTraceText(t, tracePath)
	select {
	case event := <-events:
		t.Fatalf("parked turn spoke while waiting: %+v", event)
	case <-time.After(6 * 50 * time.Millisecond):
	}
	driver.Stop()
	drainMuse(t, driver)
	if content := strings.TrimPrefix(museTraceText(t, tracePath), beforeAsk); strings.Contains(content, "still waiting on the host") {
		t.Errorf("trace = %q, want no silence named for a parked turn", content)
	}
}

// The host's own journal, found by session id: under today's date first, under any date second,
// and nowhere when there is nothing — or when the id is not one.
func TestMuseHostSessionLog(t *testing.T) {
	dataHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", dataHome)
	stage := func(date, session string) string {
		path := filepath.Join(dataHome, "muse", "sessions", date, session, "session.jsonl")
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("stage: %v", err)
		}
		if err := os.WriteFile(path, []byte("{}\n"), 0o600); err != nil {
			t.Fatalf("stage: %v", err)
		}
		return path
	}

	today := stage(time.Now().Format("2006/01/02"), "ses-today")
	if got := MuseHostSessionLog("ses-today"); got != today {
		t.Errorf("dated = %q, want %q", got, today)
	}
	older := stage("2020/05/06", "ses-older")
	if got := MuseHostSessionLog("ses-older"); got != older {
		t.Errorf("undated = %q, want %q", got, older)
	}
	if got := MuseHostSessionLog("ses-nobody"); got != "" {
		t.Errorf("missing = %q, want nothing", got)
	}
	for _, id := range []string{"", "ses/../escape", "ses/child", `ses\child`, ".."} {
		if got := MuseHostSessionLog(id); got != "" {
			t.Errorf("hostile %q = %q, want nothing", id, got)
		}
	}
	// A same-named directory is stepped over rather than pointed at.
	dirPath := filepath.Join(dataHome, "muse", "sessions", "2021/07/08", "ses-dir", "session.jsonl")
	if err := os.MkdirAll(dirPath, 0o700); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if got := MuseHostSessionLog("ses-dir"); got != "" {
		t.Errorf("directory = %q, want nothing", got)
	}
}

// Every end points at the host's own journal for the session — the per-attempt record, down to
// the provider retries the host never announces — so a post-mortem starts from a file.
func TestMuseDriverEndNotePointsAtTheHostLog(t *testing.T) {
	dataHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", dataHome)
	staged := filepath.Join(dataHome, "muse", "sessions", "2020/05/06", "ses-1", "session.jsonl")
	if err := os.MkdirAll(filepath.Dir(staged), 0o700); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if err := os.WriteFile(staged, []byte("{}\n"), 0o600); err != nil {
		t.Fatalf("stage: %v", err)
	}

	dir := t.TempDir()
	driver, _ := museStubDriver(t, "blocks")
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	drainMuse(t, driver)
	content := museTraceText(t, tracePath)
	if want := "host session log " + staged; !strings.Contains(content, want) {
		t.Errorf("trace = %q, want %q", content, want)
	}
}
