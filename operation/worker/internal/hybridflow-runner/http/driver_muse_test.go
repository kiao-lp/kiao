package runnerhttp

import (
	"context"
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"kiao/worker/internal/hybridflow-runner/skills"
	"os"
	pkgExec "os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// museAgentAt is the Muse agent pointed at a binary of the test's choosing — the same seam
// codexAgentAt is, and for the same reason.
func museAgentAt(cfg *runnerconfig.Config, binary string) *musecli.MuseAgent {
	agent := &musecli.MuseAgent{Cfg: cfg, Binary: binary,
		OptionsService: musecli.NewMuseOptionsService(cfg), Quota: musecli.NewMuseUsageService(),
		Login: musecli.NewMuseLoginService(cfg)}
	agent.OptionsService.Binary = binary
	agent.Login.Binary = binary
	agent.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"modelId":"meta/muse-spark-1.2","displayLabel":"Muse Spark 1.2"}]}`), nil
	}
	agent.Quota.Binary = binary
	return agent
}

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
			if got := musecli.MuseApprovalMode(tc.mode, tc.allowBypass); got != tc.want {
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
			if got := musecli.MuseReasoningEffort(tc.thinking, tc.effort); got != tc.want {
				t.Errorf("reasoning effort = %q, want %q", got, tc.want)
			}
		})
	}
}

// An allow answers the once-scoped approval; a deny the once-scoped denial. Anything of the right
// outcome beats nothing — except a policy amendment, which rewrites the rules rather than deciding
// the call.
func TestMuseChoiceForPrefersTheCallItsOwn(t *testing.T) {
	choices := []musecli.MuseChoice{
		{ChoiceID: "session", Decision: "approved", Scope: "session"},
		{ChoiceID: "once", Decision: "approved", Scope: "once"},
		{ChoiceID: "no", Decision: "denied", Scope: "once"},
	}
	withoutOnce := []musecli.MuseChoice{{ChoiceID: "session", Decision: "approved", Scope: "session"}}
	for _, tc := range []struct {
		name    string
		choices []musecli.MuseChoice
		allow   bool
		want    string
	}{
		{"allow takes the once-scoped approval", choices, true, "once"},
		{"deny takes the once-scoped denial", choices, false, "no"},
		{"allow falls back to the session", withoutOnce, true, "session"},
		{"deny with no denial takes nothing", withoutOnce, false, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := musecli.MuseChoiceFor(tc.choices, tc.allow)
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
	single := musecli.MuseQuestion{Id: "q1", Labels: []string{"Red", "Blue"}}
	multi := musecli.MuseQuestion{Id: "q2", Multiple: true, Labels: []string{"A", "B", "C"}}
	for _, tc := range []struct {
		name     string
		question musecli.MuseQuestion
		answer   string
		want     []string
	}{
		{"single names an option", single, "Blue", []string{"Blue"}},
		{"single off-list stays free text", single, "Green", nil},
		{"multi keeps the named labels in order", multi, "A, C", []string{"A", "C"}},
		{"multi keeps only labels that are options", multi, "A, Z", []string{"A"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := musecli.MuseSelectedLabels(tc.question, tc.answer); !reflect.DeepEqual(got, tc.want) {
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
			if got := musecli.MuseSubjectLine(tc.subject); got != tc.want {
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
		want           agentapi.TurnBlock
		wantOK         bool
		detailContains string
	}{
		{
			name: "agent message is a paragraph",
			item: map[string]any{"kind": "agentMessage", "text": "hello"},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "hello"}, wantOK: true,
		},
		{
			name: "reasoning is a thinking block",
			item: map[string]any{"kind": "reasoning", "text": "hmm"},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindThinking, Text: "hmm"}, wantOK: true,
		},
		{
			name: "summarised reasoning joins its parts",
			item: map[string]any{"kind": "reasoning", "summary": []any{"first", "second"}},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindThinking, Text: "first\n\nsecond"}, wantOK: true,
		},
		{
			name: "tool call keeps the whole input for the audit",
			item: map[string]any{"kind": "toolCall", "tool": "Edit", "args": `{"file":"a.md"}`},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindToolUse, Name: "Edit"}, wantOK: true,
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
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "user shell uses the host's summary",
			item: map[string]any{"kind": "userShell", "fallbackText": "did a thing"},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "workflow uses the host's summary",
			item: map[string]any{"kind": "workflow", "fallbackText": "did a thing"},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "did a thing"}, wantOK: true,
		},
		{
			name: "compaction uses the host's summary",
			item: map[string]any{"kind": "compaction", "fallbackText": "did a thing"},
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "did a thing"}, wantOK: true,
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
			want: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "a line"}, wantOK: true,
		},
		{
			name: "unknown kind with no summary is skipped",
			item: map[string]any{"kind": "something-new"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := musecli.MuseBlock(tc.item)
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
// account the other agents give, rather than a call with nothing said about whether it worked.
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
			got, ok := musecli.MuseBlock(tc.item)
			if !ok || got.Kind != agentapi.BlockKindToolUse {
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
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	done, code, terminal, events := driver.TurnCompleted(map[string]any{
		"terminal": "completed",
		"usage":    map[string]any{"inputTokens": float64(300), "outputTokens": float64(60)},
	})
	if !done || code != 0 || terminal != "completed" {
		t.Fatalf("end = %v/%d/%q, want the turn ended cleanly", done, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage {
		t.Fatalf("events = %+v, want the turn usage first", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 300 || usage.OutputTokens != 60 ||
		usage.Scope != agentapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the host's figures as a turn total", usage)
	}
}

// The host omits the aggregate from the end more often than not: the bill is then
// the fold of the turn's session/tokenUsage, one per model completion, summed as
// they landed — including the TokenUsage cache spellings.
func TestMuseTurnCompletedFoldsTokenUsage(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1", EventStream: make(chan agentapi.AgentEvent, 8)}
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
		if done, _, _ := driver.RelayOne(musecli.MspNotification{
			Method: "session/tokenUsage", Params: params,
		}); done {
			t.Fatal("a completion's usage ends nothing")
		}
	}
	done, code, terminal, events := driver.TurnCompleted(map[string]any{
		"turnId": "turn-1", "terminal": "completed",
	})
	if !done || code != 0 || terminal != "completed" {
		t.Fatalf("end = %v/%d/%q, want the turn ended cleanly", done, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage {
		t.Fatalf("events = %+v, want the folded bill", events)
	}
	usage := events[0].Usage
	if usage.InputTokens != 21918 || usage.OutputTokens != 126 ||
		usage.CacheReadTokens != 200 || usage.CacheWriteTokens != 10 ||
		usage.Scope != agentapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the two completions summed as a turn total", usage)
	}
	if driver.TakeTurnUsage() != nil {
		t.Error("the fold must be cleared once taken")
	}
}

// Where the end carries the aggregate and completions were folded too, the
// aggregate wins: one bill, the host's sum rather than the fold.
func TestMuseTurnCompletedPrefersItsOwnAggregate(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(1000), "outputTokens": float64(50),
	}})
	_, _, _, events := driver.TurnCompleted(map[string]any{
		"turnId": "turn-1", "terminal": "completed",
		"usage": map[string]any{"inputTokens": float64(300), "outputTokens": float64(60)},
	})
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage {
		t.Fatalf("events = %+v, want one bill", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 300 || usage.OutputTokens != 60 {
		t.Errorf("usage = %+v, want the end's aggregate rather than the fold", usage)
	}
	if driver.TakeTurnUsage() != nil {
		t.Error("the dropped fold must not survive the end")
	}
}

// A completion naming another turn is a replaced turn's straggler, one naming
// none is billed to nobody, and a compaction folds nothing at all.
func TestMuseTokenUsageKeepsOnlyItsOwnTurn(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-0", "usage": map[string]any{
		"inputTokens": float64(99999), "outputTokens": float64(99999),
	}})
	driver.NoteTokenUsage(map[string]any{"usage": map[string]any{
		"inputTokens": float64(99999), "outputTokens": float64(99999),
	}})
	if driver.TakeTurnUsage() != nil {
		t.Fatal("stragglers must not bill the running turn")
	}
	driver.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(100), "outputTokens": float64(10),
	}})
	if billed := driver.TakeTurnUsage(); billed == nil ||
		billed.InputTokens != 100 || billed.OutputTokens != 10 {
		t.Fatalf("billed = %+v, want this turn's own completion", billed)
	}

	compacting := &musecli.MuseDriver{TurnID: "turn-1", Compacting: true}
	compacting.NoteTokenUsage(map[string]any{"turnId": "turn-1", "usage": map[string]any{
		"inputTokens": float64(100), "outputTokens": float64(10),
	}})
	if compacting.TakeTurnUsage() != nil {
		t.Error("a compaction must fold nothing")
	}
}

// A terminal naming another turn ends nothing — it is a replaced turn's straggler. A terminal the
// vocabulary has moved past fails the turn rather than reporting an end nobody asked for.
func TestMuseTurnCompletedEndsOnlyItsOwnTurn(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	if done, _, _, _ := driver.TurnCompleted(map[string]any{
		"turnId": "turn-0", "terminal": "completed",
	}); done {
		t.Error("a terminal for another turn must end nothing")
	}
	done, code, terminal, events := driver.TurnCompleted(map[string]any{"terminal": "completed"})
	if !done || code != 0 || terminal != "completed" || len(events) != 0 {
		t.Errorf("completed = %v/%d/%q/%+v, want the turn ended cleanly on its own word", done, code, terminal, events)
	}
	driver.TurnID = "turn-1"
	failed, code, terminal, events := driver.TurnCompleted(map[string]any{
		"terminal": "failed", "error": map[string]any{"message": "boom"},
	})
	if !failed || code != 1 || terminal != "failed" {
		t.Fatalf("failed = %v/%d/%q, want the turn failed on its own word", failed, code, terminal)
	}
	if len(events) != 1 || events[0].Kind != agentapi.EventFailure || events[0].Message != "boom" {
		t.Errorf("failed events = %+v, want the host's sentence first", events)
	}
	driver.TurnID = "turn-1"
	if done, code, terminal, _ := driver.TurnCompleted(map[string]any{"terminal": "cancelled"}); !done || code != -1 || terminal != "cancelled" {
		t.Errorf("cancelled = %v/%d/%q, want the service-ended shape on its own word", done, code, terminal)
	}
	driver.TurnID = "turn-1"
	if done, code, _, _ := driver.TurnCompleted(map[string]any{"terminal": "vaporised"}); !done || code != 1 {
		t.Errorf("unknown terminal = %v/%d, want the turn failed closed", done, code)
	}
}

// A turn refused for want of credentials says so structurally: the schema's `authRequired` kind
// is what the hub reports under the sign-in's own error code, whatever sentence the CLI put
// beside it. Any other failure — or none named at all — stays an ordinary mid-turn complaint.
func TestMuseTurnCompletedMarksTheSignInFailure(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	done, code, _, events := driver.TurnCompleted(map[string]any{
		"terminal": "failed",
		"error": map[string]any{
			"kind":    "authRequired",
			"message": "not logged in: run /login to add an API key",
		},
	})
	if !done || code != 1 {
		t.Fatalf("end = %v/%d, want the turn failed", done, code)
	}
	if len(events) != 1 || events[0].Kind != agentapi.EventFailure || !events[0].AuthRequired {
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
		driver.TurnID = "turn-1"
		_, _, _, events := driver.TurnCompleted(params)
		if len(events) != 1 || events[0].Kind != agentapi.EventFailure || events[0].AuthRequired {
			t.Errorf("events for %+v = %+v, want an unmarked failure", params, events)
		}
	}
}

// A reclaim ends the turn it names with the sentence saying it never ran — and nothing else: one
// naming another turn is a replaced turn's straggler, as a terminal for one would be.
func TestMuseTurnUnqueuedEndsOnlyItsOwnTurn(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	if done, _, _ := driver.TurnUnqueued(map[string]any{"turnId": "turn-0"}); done {
		t.Error("a reclaim for another turn must end nothing")
	}
	done, code, failure := driver.TurnUnqueued(map[string]any{"turnId": "turn-1"})
	if !done || code != 1 || failure == nil || failure.Message == "" {
		t.Errorf("reclaim = %v/%d/%+v, want the turn ended with a sentence", done, code, failure)
	}
}

// An item completing under another turn's id is a replaced turn's straggler: heard, and kept out
// of this turn's account.
func TestMuseCompletedItemKeepsOnlyItsOwnTurn(t *testing.T) {
	driver := &musecli.MuseDriver{TurnID: "turn-1"}
	if events := driver.CompletedItem(map[string]any{
		"item": map[string]any{"kind": "agentMessage", "turnId": "turn-0", "text": "elsewhere"},
	}); events != nil {
		t.Errorf("foreign item = %+v, want it dropped", events)
	}
	events := driver.CompletedItem(map[string]any{
		"item": map[string]any{"kind": "agentMessage", "turnId": "turn-1", "text": "here"},
	})
	if len(events) != 1 || events[0].Kind != agentapi.EventBlock || events[0].Block.Text != "here" {
		t.Errorf("own item = %+v, want the block", events)
	}
}

// An approval the hub has already answered is re-emitted when a further stage updates it: the card
// went down with the answer, and the turn is about to park again with nothing on screen. An update
// to a card still up only refreshes what the next decision echoes.
func TestMuseApprovalUpdatedReemitsOnlyAnAnsweredAsk(t *testing.T) {
	newDriver := func(answered bool) *musecli.MuseDriver {
		driver := &musecli.MuseDriver{Asks: map[string]*musecli.MuseAsk{}}
		ask := &agentapi.AgentAsk{ID: musecli.MuseAskApprovalPrefix + "apv-1", Tool: "shell"}
		driver.Asks[ask.ID] = &musecli.MuseAsk{Ask: ask, ApprovalID: "apv-1", Answered: answered,
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
	event, ok := driver.ApprovalUpdated(updated)
	if !ok || event.Kind != agentapi.EventAsk || event.Ask.ID != musecli.MuseAskApprovalPrefix+"apv-1" {
		t.Fatalf("updated answered ask = %+v/%v, want the ask re-emitted", event, ok)
	}
	stored := driver.Asks[musecli.MuseAskApprovalPrefix+"apv-1"]
	if stored.Answered {
		t.Error("the re-emitted ask must park again unanswered")
	}
	if len(stored.Choices) != 1 || stored.Choices[0].ChoiceID != "c2" {
		t.Errorf("choices = %+v, want the refreshed ones", stored.Choices)
	}

	if event, ok := newDriver(false).ApprovalUpdated(updated); ok {
		t.Errorf("updated unanswered ask = %+v, want silence: the card is still up", event)
	}
}

// A settlement of the hub's own decision is the answer landing; anything else — the judge, a
// timeout, another client — withdraws the card.
func TestMuseSettlementsWithdrawOnlyWhatTheHubDidNotDecide(t *testing.T) {
	driver := &musecli.MuseDriver{Asks: map[string]*musecli.MuseAsk{}}
	mine := &agentapi.AgentAsk{ID: musecli.MuseAskApprovalPrefix + "a1", Tool: "shell"}
	driver.Asks[mine.ID] = &musecli.MuseAsk{Ask: mine, ApprovalID: "a1",
		Answered: true, DecidedBy: map[string]bool{"cmd-1": true}}
	theirs := &agentapi.AgentAsk{ID: musecli.MuseAskApprovalPrefix + "a2", Tool: "shell"}
	driver.Asks[theirs.ID] = &musecli.MuseAsk{Ask: theirs, ApprovalID: "a2"}

	if event, ok := driver.ApprovalSettled(map[string]any{
		"approvalId": "a1", "decidedByCommandId": "cmd-1",
	}); ok {
		t.Errorf("own settlement = %+v, want silence: the card is already gone", event)
	}
	event, ok := driver.ApprovalSettled(map[string]any{
		"approvalId": "a2", "decidedByCommandId": "cmd-9",
	})
	if !ok || event.Kind != agentapi.EventWithdraw || event.AskID != theirs.ID {
		t.Fatalf("foreign settlement = %+v/%v, want the ask withdrawn", event, ok)
	}
	if _, ok := driver.Asks[theirs.ID]; ok {
		t.Error("a withdrawn ask must leave the pending set")
	}
	if event, ok := driver.ApprovalSettled(map[string]any{"approvalId": "a3"}); ok {
		t.Errorf("unknown settlement = %+v, want silence", event)
	}

	driver.Asks[musecli.MuseAskQuestionPrefix+"u1"] = &musecli.MuseAsk{
		Ask: &agentapi.AgentAsk{ID: musecli.MuseAskQuestionPrefix + "u1"}, UserInputID: "u1",
		Answered: true, DecidedBy: map[string]bool{"cmd-2": true},
	}
	if event, ok := driver.QuestionSettled(map[string]any{
		"userInputId": "u1", "decidedByCommandId": "cmd-2",
	}); ok {
		t.Errorf("own question settlement = %+v, want silence", event)
	}
}

// Parked is waiting on something only a person can answer: an ask the hub has not decided. A
// decided one is the host's to settle, and a settled one is gone — neither holds the idle wait.
func TestMuseDriverParkedOnUnansweredAsks(t *testing.T) {
	driver := &musecli.MuseDriver{}
	if driver.ParkedOnAsk() {
		t.Error("no asks: not parked")
	}
	driver.Asks = map[string]*musecli.MuseAsk{
		musecli.MuseAskApprovalPrefix + "a1": {Ask: &agentapi.AgentAsk{ID: musecli.MuseAskApprovalPrefix + "a1"}},
	}
	if !driver.ParkedOnAsk() {
		t.Error("unanswered ask: parked")
	}
	driver.Asks[musecli.MuseAskApprovalPrefix+"a1"].Answered = true
	if driver.ParkedOnAsk() {
		t.Error("answered ask: not parked")
	}
	delete(driver.Asks, musecli.MuseAskApprovalPrefix+"a1")
	if driver.ParkedOnAsk() {
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
	mustInstall(t, skills.StoreAgentsSkills(store), bundleOf("graph", map[string]string{"SKILL.md": "ours"}))
	mustWriteBytes(t, filepath.Join(skills.StoreAgentsSkills(store), "verify", "SKILL.md"), []byte("the store's own"))

	driver := &musecli.MuseDriver{Cfg: &runnerconfig.Config{}}
	staging, env, err := driver.StageConfig(musecli.MuseRun{
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
	// The staged skills are a directory of links: the DCMS skill from the store, read through to
	// the store, and the user's own from their config home — but not the store's own skill, which
	// the untrusted workspace must not hand over.
	stagedSkills := filepath.Join(configDir, "skills")
	if target, err := os.Readlink(filepath.Join(stagedSkills, "graph")); err != nil ||
		target != filepath.Join(skills.StoreAgentsSkills(store), "graph") {
		t.Errorf("graph link = %q/%v, want the store skill read through", target, err)
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

	if staging, env, err := driver.StageConfig(musecli.MuseRun{}); err != nil || staging != "" || env != nil {
		t.Errorf("stageConfig with no servers = %q/%q/%v, want nothing staged", staging, env, err)
	}
}

// Where both halves name a skill, the user's own wins: it is the skill nobody here wrote, and the
// staged turn must not undo the foreign rule that protects it everywhere else.
func TestStageMuseSkillsPrefersTheUsersOwn(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	t.Setenv("HOME", home)
	mustWriteBytes(t, filepath.Join(home, "xdg", "muse", "skills", "graph", "SKILL.md"), []byte("theirs"))
	store := t.TempDir()
	mustInstall(t, skills.StoreAgentsSkills(store), bundleOf("graph", map[string]string{"SKILL.md": "ours"}))

	staged := filepath.Join(t.TempDir(), "skills")
	if err := musecli.StageMuseSkills(staged, store); err != nil {
		t.Fatal(err)
	}

	if target, err := os.Readlink(filepath.Join(staged, "graph")); err != nil ||
		target != filepath.Join(home, "xdg", "muse", "skills", "graph") {
		t.Errorf("graph link = %q/%v, want the user's own skill", target, err)
	}
}

// No store skills, no user skills, no directory — like the login when there is none.
func TestStageMuseSkillsIsLeftOutWhenThereIsNothing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	t.Setenv("HOME", home)

	staged := filepath.Join(t.TempDir(), "skills")
	if err := musecli.StageMuseSkills(staged, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(staged); !os.IsNotExist(err) {
		t.Errorf("an empty skills directory was staged (%v)", err)
	}
}

// museStubLog is one request the stub received: the method and its params verbatim.
type museStubLog struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

func museStubMain() int {
	// A stub that outlives its test is a failure's ghost: never more than a minute, whatever the
	// test forgot to end.
	time.AfterFunc(time.Minute, func() { os.Exit(1) })

	script := os.Getenv("MUSE_STUB_SCRIPT")
	logPath := os.Getenv("MUSE_STUB_LOG")
	logFile, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 1
	}
	defer logFile.Close()
	record := func(method string, params map[string]any) {
		line, _ := json.Marshal(museStubLog{Method: method, Params: params})
		logFile.Write(append(line, '\n'))
	}
	record("env", map[string]any{"XDG_CONFIG_HOME": os.Getenv("XDG_CONFIG_HOME")})
	// What the host was pointed at: a staged turn carries its servers and its token here, and a
	// test asserting on it has to read it through the stub — the staging is gone by the time the
	// turn ends.
	if configHome := os.Getenv("XDG_CONFIG_HOME"); configHome != "" {
		if settings, err := os.ReadFile(configHome + "/muse/settings.json"); err == nil {
			record("settings", map[string]any{"content": string(settings)})
		} else {
			record("settings", map[string]any{"missing": err.Error()})
		}
	}

	in := json.NewDecoder(os.Stdin)
	out := json.NewEncoder(os.Stdout)
	answer := func(id any, result any) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	fail := func(id any, message string) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "id": id,
			"error": map[string]any{"code": -32000, "message": message,
				"data": map[string]any{"kind": "stubRefused"}}})
	}
	notify := func(method string, params map[string]any) {
		_ = out.Encode(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	}

	turnID := ""
	starts := 0
	pages := 0
	awaiting := ""
	emitTurn := func() {
		notify("item/completed", map[string]any{
			"sessionId": "ses-1",
			"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
				"turnId": turnID, "text": "hello from stub"},
		})
		notify("turn/completed", map[string]any{
			"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
		})
	}
	for {
		var frame struct {
			ID     *int           `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if err := in.Decode(&frame); err != nil {
			return 0 // stdin closed: the turn is over
		}
		if frame.ID == nil {
			continue // a notification of the client's own (the handshake's `initialized`)
		}
		id := *frame.ID
		if frame.Params == nil {
			frame.Params = map[string]any{}
		}
		record(frame.Method, frame.Params)
		switch frame.Method {
		case "initialize":
			answer(id, map[string]any{"serverInfo": map[string]any{"name": "stub"}})
		case "model/list":
			answer(id, map[string]any{"models": []any{
				map[string]any{"modelId": "stub-model", "displayLabel": "Stub"},
			}})
		case "session/start":
			answer(id, map[string]any{
				"session": map[string]any{"sessionId": "ses-1"}, "viewCursor": ""})
		case "session/resume":
			if script == "resume-fail" {
				fail(id, "session not found")
				continue
			}
			answer(id, map[string]any{
				"session": map[string]any{
					"sessionId": frame.Params["sessionId"]},
				"history": map[string]any{}, "pendingRequests": []any{},
				"viewCursor": ""})
		case "session/fork":
			if script == "fork-no-birth-time" {
				fail(id, "internal error: resolve branch creation time: "+
					"file birth time is unavailable: creation time is not available on this platform currently")
				continue
			}
			answer(id, map[string]any{
				"session": map[string]any{"sessionId": "ses-fork"},
				"history": map[string]any{}, "pendingRequests": []any{},
				"viewCursor": ""})
		case "session/setModel", "session/setApprovalMode":
			answer(id, map[string]any{
				"commandId": frame.Params["commandId"], "status": "accepted"})
		case "session/compact":
			if script == "compact-noop" {
				answer(id, map[string]any{
					"commandId": frame.Params["commandId"], "status": "noop",
					"reason": "no_compactable_history"})
				continue
			}
			answer(id, map[string]any{
				"commandId": frame.Params["commandId"], "status": "accepted"})
			notify("item/completed", map[string]any{
				"sessionId": "ses-1",
				"item":      map[string]any{"kind": "compaction", "itemId": "item-c"},
			})
		case "turn/start":
			turnID, _ = frame.Params["commandId"].(string)
			starts++
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"disposition": "started", "startedNewTurn": true,
				"status": "accepted", "turnId": turnID})
			switch script {
			case "ask":
				awaiting = "decide"
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"toolName": "shell", "toolCallId": "call-1", "itemId": "item-1",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-1", "sourceIndex": 0},
					"availableChoices": []any{
						map[string]any{"choiceId": "allow-once",
							"decision": "approved", "scope": "once", "label": "Yes"},
						map[string]any{"choiceId": "allow-session",
							"decision": "approved", "scope": "session", "label": "Always"},
						map[string]any{"choiceId": "deny",
							"decision": "denied", "scope": "once",
							"label": "No", "acceptsFeedback": true},
					},
					"subject": map[string]any{"kind": "shell", "command": "ls /tmp"},
					"rawArgs": `{"command":"ls /tmp"}`, "viewCursor": "v1",
				})
			case "ask-external":
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-9",
					"toolName": "shell",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-9", "sourceIndex": 0},
					"availableChoices": []any{},
					"subject":          map[string]any{"kind": "shell", "command": "ls"},
					"rawArgs":          `{"command":"ls"}`, "viewCursor": "v1",
				})
				notify("approval/resolved", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-9",
					"decision": "approved", "decidedByCommandId": "cmd-foreign",
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "question":
				awaiting = "answer"
				notify("userInput/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "userInputId": "u-1",
					"toolName": "request_user_input", "toolCallId": "call-2",
					"itemId":     "item-2",
					"viewCursor": "v1",
					"questions": []any{
						map[string]any{"id": "q1", "header": "Colour",
							"question":  "First?",
							"selection": map[string]any{"mode": "single"},
							"options": []any{
								map[string]any{"label": "Red"},
								map[string]any{"label": "Blue", "description": "the sad one"},
							}},
						map[string]any{"id": "q2", "header": "Letters",
							"question":  "Pick?",
							"selection": map[string]any{"mode": "multiple"},
							"options": []any{
								map[string]any{"label": "A"},
								map[string]any{"label": "B"},
								map[string]any{"label": "C"},
							}},
					},
				})
			case "steer":
				awaiting = "steer"
			case "fail":
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
						"turnId": turnID, "text": "partial"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "failed",
					"error": map[string]any{"kind": "kebab", "message": "boom",
						"retryable": false},
				})
			case "blocks":
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "reasoning", "itemId": "item-1",
						"turnId": turnID, "summary": []any{"s1", "s2"}},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "toolCall", "itemId": "item-2",
						"turnId": turnID, "tool": "Read", "args": `{"file":"x"}`},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "userMessage", "itemId": "item-3",
						"turnId": turnID, "text": "the echo"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "subagent", "itemId": "item-4",
						"turnId": turnID, "fallbackText": "child did things"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-5",
						"turnId": turnID, "text": "tail"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "subagent", "subagent-fail":
				// One delegation, naming its child's own session: the driver reads that
				// session back and files what the child thought and did beneath the
				// parent's line. The fail script's read is refused, and the line alone
				// is what is filed.
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "subagent", "itemId": "item-4",
						"turnId": turnID, "fallbackText": "child did things",
						"subagentId": "sub-1", "childSessionId": "ses-child",
						"role": "researcher", "objective": "find the bug",
						"status": "completed",
						"result": map[string]any{"summary": "it was the cache"}},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			case "cancel":
				// Nothing: the test stops the turn, and the kill ends the stream.
			case "silent":
				// Nothing at all: no items, no end. The idle wait is what ends the turn.
			case "silent-then-blocks":
				// The first turn blocks; the resume after it answers like a plain turn.
				if starts > 1 {
					emitTurn()
				}
			case "resync-end":
				// Silent throughout: the resync's page carries the turn's end, so no
				// resume ever starts.
			case "resync-notloaded":
				// Silent throughout: the session reads as unloaded, which concludes
				// nothing — the blockage runs its course to the resume and the fork.
			case "ask-then-silent":
				// One live approval, then silence past the decision: the settlement
				// never arrives, so the resync finds the turn parked on an ask the
				// hub already holds.
				notify("approval/requested", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"toolName": "shell", "toolCallId": "call-1", "itemId": "item-1",
					"currentRequirementId": map[string]any{
						"approvalId": "apv-1", "sourceIndex": 0},
					"availableChoices": []any{
						map[string]any{"choiceId": "allow-once",
							"decision": "approved", "scope": "once", "label": "Yes"},
						map[string]any{"choiceId": "deny",
							"decision": "denied", "scope": "once",
							"label": "No", "acceptsFeedback": true},
					},
					"subject": map[string]any{"kind": "shell", "command": "ls /tmp"},
					"rawArgs": `{"command":"ls /tmp"}`, "viewCursor": "v1",
				})
			case "resync-parked":
				// Silent until resumed: the resync finds the blind park first, waits
				// on, and only the blockage after it resumes into an answering turn.
				if starts > 1 {
					emitTurn()
				}
			case "view-down":
				// The live view dies mid-turn, then the turn answers over the dead
				// stream like nothing happened.
				notify("session/viewHealthChanged", map[string]any{
					"sessionId": "ses-1", "health": "unavailable",
				})
				emitTurn()
			case "unqueued":
				// Nothing runs and nothing completes: per the schema no turn/started and no
				// turn/completed is ever emitted for the reclaimed turn.
				notify("turn/unqueued", map[string]any{
					"sessionId": "ses-1", "turnId": turnID,
					"commandId": frame.Params["commandId"],
				})
			case "drain", "drain-stuck", "drain-stale":
				// One background workflow still running when the turn ends: the
				// driver waits for its completion instead of killing the host
				// with the turn. What the reconcile finds, and whether the run
				// ever lands, is per script — see the session/read arms below.
				notify("item/started", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v1",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "inProgress", "revision": 1,
						"entryId": "inventory"},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v2",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-1",
						"turnId": turnID, "text": "launched"},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
					"viewCursor": "v3",
				})
			default:
				emitTurn()
			}
		case "approval/decide":
			answer(id, map[string]any{"approvalId": frame.Params["approvalId"],
				"commandId": frame.Params["commandId"], "status": "accepted",
				"terminal": true})
			if awaiting == "decide" {
				awaiting = ""
				notify("approval/resolved", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "approvalId": "apv-1",
					"decision":           "approved",
					"decidedByCommandId": frame.Params["commandId"],
				})
				emitTurn()
			}
		case "userInput/answer", "userInput/cancel":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted", "userInputId": frame.Params["userInputId"]})
			if awaiting == "answer" {
				awaiting = ""
				notify("userInput/settled", map[string]any{
					"sessionId": "ses-1", "userInputId": "u-1",
					"outcome":            "answered",
					"decidedByCommandId": frame.Params["commandId"],
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			}
		case "turn/steer":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted", "turnId": turnID})
			if awaiting == "steer" {
				awaiting = ""
				text := "unsteered"
				if input, ok := frame.Params["input"].([]any); ok && len(input) > 0 {
					if part, ok := input[0].(map[string]any); ok {
						if said, ok := part["text"].(string); ok {
							text = "steered: " + said
						}
					}
				}
				notify("item/completed", map[string]any{
					"sessionId": "ses-1",
					"item": map[string]any{"kind": "agentMessage", "itemId": "item-9",
						"turnId": turnID, "text": text},
				})
				notify("turn/completed", map[string]any{
					"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
				})
			}
		case "turn/cancel":
			answer(id, map[string]any{"commandId": frame.Params["commandId"],
				"status": "accepted"})
		case "view/page":
			// The resync's catch-up read. Scripted per test: the dead view's missed
			// tail, or nothing missed at all. Unknown to the stub otherwise, like a
			// host too wedged to answer.
			switch script {
			case "resync-end":
				// The end the dead stream dropped: one late block and the turn's own
				// completion, for the turn the stub started.
				answer(id, map[string]any{
					"events": []any{
						map[string]any{"method": "item/completed", "params": map[string]any{
							"sessionId": "ses-1",
							"item": map[string]any{"kind": "agentMessage", "itemId": "item-late",
								"turnId": turnID, "text": "late hello from the view"},
							"viewCursor": "v9",
						}},
						map[string]any{"method": "turn/completed", "params": map[string]any{
							"sessionId": "ses-1", "turnId": turnID, "terminal": "completed",
							"viewCursor": "v10",
						}},
					},
					"nextCursor": nil,
				})
			case "resync-parked":
				answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
			case "resync-notloaded":
				answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
			case "ask-then-silent":
				// One late block on the first page, nothing after: the cursor the
				// replay advanced past is what a real host would page after.
				pages++
				if pages > 1 {
					answer(id, map[string]any{"events": []any{}, "nextCursor": nil})
					continue
				}
				answer(id, map[string]any{
					"events": []any{
						map[string]any{"method": "item/completed", "params": map[string]any{
							"sessionId": "ses-1",
							"item": map[string]any{"kind": "agentMessage", "itemId": "item-late",
								"turnId": turnID, "text": "late hello from the view"},
							"viewCursor": "v9",
						}},
					},
					"nextCursor": nil,
				})
			default:
				fail(id, "the stub has never heard of "+frame.Method)
			}
		case "session/read":
			// The resync's point-in-time look at whether the turn still runs —
			// and the drain's reconcile of what background work is still open.
			switch script {
			case "drain", "drain-stuck":
				// The fold agrees with the live stream: the workflow is still
				// open. The drain script's run then lands — an update and its
				// completion — while the stuck one never does.
				answer(id, map[string]any{
					"session": map[string]any{"status": "idle", "activeTurnId": nil},
					"history": map[string]any{"mode": "inline", "snapshot": nil,
						"items": []any{
							map[string]any{"kind": "workflow", "itemId": "item-wf",
								"turnId": turnID, "status": "inProgress",
								"revision": 1, "entryId": "inventory"},
						}},
					"pendingRequests": []any{}, "viewCursor": "v3",
				})
				if script != "drain" {
					continue
				}
				notify("item/updated", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v4",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "inProgress", "revision": 2,
						"entryId": "inventory",
						"children": []any{
							map[string]any{"childId": "research", "attempt": 1,
								"status": "completed", "label": "research"},
							map[string]any{"childId": "synthesis", "attempt": 1,
								"status": "running", "label": "synthesis"},
						}},
				})
				notify("item/completed", map[string]any{
					"sessionId": "ses-1", "viewCursor": "v5",
					"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
						"turnId": turnID, "status": "completed", "revision": 3,
						"entryId":      "inventory",
						"fallbackText": "inventory done"},
				})
			case "drain-stale":
				// The fold disagrees with the live stream: the workflow the
				// stream saw opening already completed — its completion was
				// dropped — so there is nothing to drain.
				answer(id, map[string]any{
					"session": map[string]any{"status": "idle", "activeTurnId": nil},
					"history": map[string]any{"mode": "inline", "snapshot": nil,
						"items": []any{
							map[string]any{"kind": "workflow", "itemId": "item-wf",
								"turnId": turnID, "status": "completed",
								"revision": 3, "entryId": "inventory"},
						}},
					"pendingRequests": []any{}, "viewCursor": "v3",
				})
			case "resync-end":
				answer(id, map[string]any{
					"session":         map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{},
					"history":         map[string]any{}, "viewCursor": "",
				})
			case "resync-parked":
				answer(id, map[string]any{
					"session": map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{
						map[string]any{"kind": "approval", "viewCursor": "v1"},
					},
					"history": map[string]any{}, "viewCursor": "",
				})
			case "resync-notloaded":
				answer(id, map[string]any{
					"session":         map[string]any{"status": "notLoaded", "activeTurnId": nil},
					"pendingRequests": []any{},
					"history":         map[string]any{}, "viewCursor": "",
				})
			case "ask-then-silent":
				answer(id, map[string]any{
					"session": map[string]any{"status": "running", "activeTurnId": turnID},
					"pendingRequests": []any{
						map[string]any{"kind": "approval", "approvalId": "apv-1", "viewCursor": "v1"},
					},
					"history": map[string]any{}, "viewCursor": "",
				})
			case "subagent":
				// The delegation's child, and its own child beneath it: what the driver
				// reads back through the delegation's handle.
				switch frame.Params["sessionId"] {
				case "ses-child":
					answer(id, map[string]any{
						"session": map[string]any{"sessionId": "ses-child"},
						"history": map[string]any{"items": []any{
							map[string]any{"kind": "agentMessage", "itemId": "c-1",
								"text": "child here"},
							map[string]any{"kind": "reasoning", "itemId": "c-2",
								"summary": []any{"a plan"}},
							map[string]any{"kind": "toolCall", "itemId": "c-3",
								"tool": "Read", "args": `{"file":"x"}`},
							map[string]any{"kind": "subagent", "itemId": "c-4",
								"fallbackText": "grandchild did things",
								"subagentId":   "sub-2", "childSessionId": "ses-grandchild",
								"role": "helper", "objective": "fetch one fact",
								"status": "completed",
								"result": map[string]any{"summary": "the fact"}},
						}},
						"pendingRequests": []any{}, "viewCursor": "",
					})
				case "ses-grandchild":
					answer(id, map[string]any{
						"session": map[string]any{"sessionId": "ses-grandchild"},
						"history": map[string]any{"items": []any{
							map[string]any{"kind": "agentMessage", "itemId": "g-1",
								"text": "grandchild here"},
						}},
						"pendingRequests": []any{}, "viewCursor": "",
					})
				default:
					fail(id, "no such session")
				}
			case "subagent-fail":
				fail(id, "the child is gone")
			default:
				fail(id, "the stub has never heard of "+frame.Method)
			}
		case "usage/read":
			// The host's last observation: the same answer a real host gives after a turn,
			// shared with the parse tests so the two can never drift apart.
			if script == "usage-silent" {
				continue // never answered: the harvest must time out, not hold the turn's end
			}
			if script == "usage-fail" {
				fail(id, "nothing observed")
				continue
			}
			var result any
			_ = json.Unmarshal([]byte(museObservedUsage), &result)
			answer(id, result)
		default:
			fail(id, "the stub has never heard of "+frame.Method)
		}
	}
}

// museStubDriver spawns the stub host for one scripted turn: the test binary as the CLI, the
// script and the log named in the environment the host inherits.
func museStubDriver(t *testing.T, script string) (*musecli.MuseDriver, string) {
	t.Helper()
	logPath := filepath.Join(t.TempDir(), "stub.log")
	t.Setenv("GO_WANT_MUSE_STUB", "1")
	t.Setenv("MUSE_STUB_SCRIPT", script)
	t.Setenv("MUSE_STUB_LOG", logPath)
	return &musecli.MuseDriver{
		Binary:      os.Args[0],
		EventStream: make(chan agentapi.AgentEvent),
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
func drainMuse(t *testing.T, driver *musecli.MuseDriver) []agentapi.AgentEvent {
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
func museNext(t *testing.T, events <-chan agentapi.AgentEvent) agentapi.AgentEvent {
	t.Helper()
	select {
	case event, ok := <-events:
		if !ok {
			t.Fatal("the stream ended where another event was expected")
		}
		return event
	case <-time.After(15 * time.Second):
		t.Fatal("the turn said nothing more")
		return agentapi.AgentEvent{}
	}
}

// A fresh turn opens a session on the whole store, asks about every tool call, and carries the
// briefing in its input: MSP has no per-turn system prompt to hang it on. A turn naming no model
// and no effort asks for neither — the host's own defaults.
func TestMuseDriverRunsAWholeTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[0].Kind != agentapi.EventSession || got[0].SessionID != "ses-1" {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != agentapi.EventBlock || got[1].Block.Text != "hello from stub" {
		t.Errorf("second event = %+v, want the reply", got[1])
	}
	if got[1].MessageID == "" {
		t.Error("the block must carry the turn id: it is where a fork picks the session up")
	}
	if got[2].Kind != agentapi.EventDone || got[2].ExitCode != 0 {
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

// A turn played by a managed agent carries the agent's standing instructions in the same text,
// with the briefing: MSP has no per-turn system prompt to hang either on.
func TestMuseDriverPrependsStandingInstructions(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	if err := driver.Spawn(agentapi.AgentRun{
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "again", WorkDir: dir, StoreRoot: dir, SessionID: "ses-9",
		Model: "meta/muse-spark-1.2", Effort: "ultra",
		PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != agentapi.EventSession || got[0].SessionID != "ses-9" {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "on the branch", WorkDir: dir, StoreRoot: dir,
		SessionID: "ses-9", ForkSession: true, ResumeAt: "turn-7",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != agentapi.EventSession || got[0].SessionID != "ses-fork" {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "on the branch", WorkDir: dir, StoreRoot: dir,
		SessionID: "ses-9", ForkSession: true,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 || got[0].Kind != agentapi.EventFailure || got[1].Kind != agentapi.EventDone || got[1].ExitCode != 1 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "again", WorkDir: dir, StoreRoot: dir, SessionID: "ses-gone",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 {
		t.Fatalf("events = %+v, want a failure and a done, and no session", got)
	}
	if got[0].Kind != agentapi.EventFailure || !strings.Contains(got[0].Message, "resumed") {
		t.Errorf("first event = %+v, want the resume refusal as a sentence", got[0])
	}
	if got[1].Kind != agentapi.EventDone || got[1].ExitCode != 1 {
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
			if err := driver.Spawn(agentapi.AgentRun{
				Prompt: "list things", WorkDir: dir, StoreRoot: dir,
				PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
			}); err != nil {
				t.Fatalf("Spawn = %v", err)
			}
			events := driver.Events()
			if first := museNext(t, events); first.Kind != agentapi.EventSession {
				t.Fatalf("first event = %+v, want the session", first)
			}
			asked := museNext(t, events)
			if asked.Kind != agentapi.EventAsk {
				t.Fatalf("second event = %+v, want the ask", asked)
			}
			ask := asked.Ask
			if ask.Tool != "shell" || !strings.Contains(ask.Description, "ls /tmp") {
				t.Errorf("ask = %+v, want the call named by its target", ask)
			}
			if !strings.Contains(ask.InputSummary, "ls /tmp") {
				t.Errorf("ask summary = %q, want the input rendered for deciding on", ask.InputSummary)
			}
			decision := agentapi.AskDecision{Allow: tc.allow, Input: ask.Input}
			if !tc.allow {
				decision.Message = "not now"
			}
			if err := driver.Answer(ask.ID, decision); err != nil {
				t.Fatalf("Answer = %v", err)
			}
			var rest []agentapi.AgentEvent
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
			if len(rest) != 2 || rest[0].Kind != agentapi.EventBlock || rest[1].Kind != agentapi.EventDone {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "list things", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, an ask, a withdrawal and the end", got)
	}
	if got[0].Kind != agentapi.EventSession || got[1].Kind != agentapi.EventAsk {
		t.Fatalf("events = %+v, want the session and the ask first", got)
	}
	if got[2].Kind != agentapi.EventWithdraw || got[2].AskID != got[1].Ask.ID {
		t.Errorf("third event = %+v, want the ask withdrawn", got[2])
	}
	if got[3].Kind != agentapi.EventDone {
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
			if err := driver.Spawn(agentapi.AgentRun{
				Prompt: "ask me", WorkDir: dir, StoreRoot: dir,
				PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true, AllowBypass: true,
			}); err != nil {
				t.Fatalf("Spawn = %v", err)
			}
			events := driver.Events()
			if first := museNext(t, events); first.Kind != agentapi.EventSession {
				t.Fatalf("first event = %+v, want the session", first)
			}
			asked := museNext(t, events)
			if asked.Kind != agentapi.EventAsk || !asked.Ask.IsQuestion() {
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
			if err := driver.Answer(asked.Ask.ID, agentapi.AskDecision{Allow: true, Input: updated}); err != nil {
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
					if event.Kind != agentapi.EventDone {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "take your time", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	if err := driver.Say("meanwhile"); err != nil {
		t.Fatalf("Say = %v", err)
	}
	var rest []agentapi.AgentEvent
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
	if len(rest) != 2 || rest[0].Kind != agentapi.EventBlock || rest[0].Block.Text != "steered: meanwhile" {
		t.Fatalf("rest = %+v, want the steered reply and the end", rest)
	}
	if rest[1].Kind != agentapi.EventDone || rest[1].ExitCode != 0 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "fail me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a block, a failure and a done", got)
	}
	if got[1].Kind != agentapi.EventBlock || got[1].Block.Text != "partial" {
		t.Errorf("second event = %+v, want the block from before the failure", got[1])
	}
	if got[2].Kind != agentapi.EventFailure || got[2].Message != "boom" {
		t.Errorf("third event = %+v, want the host's sentence", got[2])
	}
	if got[3].Kind != agentapi.EventDone || got[3].ExitCode != 1 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[3])
	}
}

// A turn the host reclaims before running still ends: the schema emits no turn/completed for it,
// and SDK turn-waits settle on turn/unqueued too. Waiting for the completion that never comes is a
// turn that never ends.
func TestMuseDriverSettlesAnUnqueuedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "unqueued")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a failure and a done", got)
	}
	if got[1].Kind != agentapi.EventFailure || got[1].Message == "" {
		t.Errorf("second event = %+v, want the sentence saying the turn never ran", got[1])
	}
	if got[2].Kind != agentapi.EventDone || got[2].ExitCode != 1 {
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
	if err := driver.Spawn(agentapi.AgentRun{
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
	if got[1].Kind != agentapi.EventNotice || !strings.Contains(got[1].Message, "resumes where it stood") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != agentapi.EventFailure || got[2].Message != agentfaults.MuseBlockedTwiceMessage {
		t.Errorf("third event = %+v, want the sentence saying the host blocked twice", got[2])
	}
	if got[3].Kind != agentapi.EventDone || got[3].ExitCode != 1 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a resume notice, a block and a done", got)
	}
	if got[0].Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != agentapi.EventNotice || !strings.Contains(got[1].Message, "relance 1") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != agentapi.EventBlock || got[2].Block.Text != "hello from stub" {
		t.Errorf("third event = %+v, want the resumed turn's reply", got[2])
	}
	if last := got[3]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
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
	if text, _ := part["text"].(string); !strings.Contains(text, musecli.MuseBlockedResumePrompt) {
		t.Errorf("resume input = %q, want %q", text, musecli.MuseBlockedResumePrompt)
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

// A turn silent for the whole idle wait is polled before it is concluded: the session view
// replays the end the dead stream dropped, so a turn that finished ends clean — its late
// block lands as its own and no resume starts, no blockage is forked.
func TestMuseDriverResyncsAQuietTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "resync-end")
	driver.IdleTimeout = 50 * time.Millisecond
	driver.NoticeTimeout = time.Hour
	driver.ResyncTimeout = 5 * time.Second
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, the replayed block and a done", got)
	}
	if got[0].Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != agentapi.EventBlock || got[1].Block.Text != "late hello from the view" {
		t.Errorf("second event = %+v, want the block replayed from the session view", got[1])
	}
	if last := got[2]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", last)
	}
	for _, event := range got {
		if event.Kind == agentapi.EventFailure {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 5 {
		t.Fatalf("events = %+v, want a session, a blind-park notice, a resume, a block and a done", got)
	}
	if got[1].Kind != agentapi.EventNotice || !strings.Contains(got[1].Message, "never arrived") {
		t.Errorf("second event = %+v, want the notice naming the unseen asks", got[1])
	}
	if got[2].Kind != agentapi.EventNotice || !strings.Contains(got[2].Message, "relance 1") {
		t.Errorf("third event = %+v, want the resume notice", got[2])
	}
	if got[3].Kind != agentapi.EventBlock || got[3].Block.Text != "hello from stub" {
		t.Errorf("fourth event = %+v, want the resumed turn's reply", got[3])
	}
	if last := got[4]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a resume notice, a failure and a done", got)
	}
	if got[1].Kind != agentapi.EventNotice || !strings.Contains(got[1].Message, "relance 1") {
		t.Errorf("second event = %+v, want the resume notice", got[1])
	}
	if got[2].Kind != agentapi.EventFailure || got[2].Message != agentfaults.MuseBlockedTwiceMessage {
		t.Errorf("third event = %+v, want the sentence saying the host blocked twice", got[2])
	}
	if last := got[3]; last.Kind != agentapi.EventDone || last.ExitCode == 0 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	asked := museNext(t, events)
	if asked.Kind != agentapi.EventAsk {
		t.Fatalf("second event = %+v, want the live ask", asked)
	}
	if err := driver.Answer(asked.Ask.ID, agentapi.AskDecision{Allow: true, Input: asked.Ask.Input}); err != nil {
		t.Fatalf("Answer = %v", err)
	}
	// Past the idle wait the resync replays the late block and waits on: the pending
	// ask is the one just answered, so no blind-park notice names it.
	replayed := museNext(t, events)
	if replayed.Kind != agentapi.EventBlock || replayed.Block.Text != "late hello from the view" {
		t.Fatalf("third event = %+v, want the block replayed from the session view", replayed)
	}
	notice := museNext(t, events)
	if notice.Kind != agentapi.EventNotice || !strings.Contains(notice.Message, "replayed") {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, the view notice, a block and a done", got)
	}
	if got[1].Kind != agentapi.EventNotice || got[1].Message != musecli.MuseViewDownMessage {
		t.Errorf("second event = %+v, want the notice saying the live view is down", got[1])
	}
	if got[2].Kind != agentapi.EventBlock || got[2].Block.Text != "hello from stub" {
		t.Errorf("third event = %+v, want the turn's own reply after the verdict", got[2])
	}
	if last := got[3]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	// Before the resume the nudge reads as it always did: no counter on a turn that never
	// blocked.
	nudge := museNext(t, events)
	if nudge.Kind != agentapi.EventNotice || strings.Contains(nudge.Message, "relance") {
		t.Fatalf("first notice = %+v, want the bare silence with no counter", nudge)
	}
	// Past the resume every naming of the silence carries the count.
	for {
		event := museNext(t, events)
		if event.Kind == agentapi.EventNotice && strings.Contains(event.Message, "(relance 1)") {
			break
		}
		if event.Kind == agentapi.EventDone {
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
	if err := driver.Spawn(agentapi.AgentRun{
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
	if err := driver.Spawn(agentapi.AgentRun{
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "never mind", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
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
	driver := &musecli.MuseDriver{
		EventStream: make(chan agentapi.AgentEvent),
		Run:         agentapi.AgentRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	done, _, _ := driver.RelayOne(musecli.MspNotification{
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
	driver.Usage = musecli.NewMuseUsageService()
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[2].Kind != agentapi.EventDone || got[2].ExitCode != 0 {
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
	driver.Usage = musecli.NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(agentapi.AgentRun{
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
	if got[0].Kind != agentapi.EventSession {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	roster := func(event agentapi.AgentEvent, where string) agentapi.BackgroundTask {
		t.Helper()
		if event.Kind != agentapi.EventBackground || len(event.Background) != 1 {
			t.Fatalf("%s = %+v, want the roster carrying the workflow alone", where, event)
		}
		return event.Background[0]
	}
	opened := roster(got[1], "second event")
	if opened.Kind != "workflow" || opened.State != agentapi.BackgroundRunning || len(opened.Children) != 0 {
		t.Errorf("opened roster = %+v, want the workflow running with no children yet", opened)
	}
	if got[2].Kind != agentapi.EventBlock || got[2].Block.Text != "launched" {
		t.Errorf("third event = %+v, want the turn's reply", got[2])
	}
	if got[3].Kind != agentapi.EventNotice || !strings.Contains(got[3].Message, "still running") {
		t.Errorf("fourth event = %+v, want the notice saying the turn waits on background work", got[3])
	}
	updated := roster(got[4], "fifth event")
	if len(updated.Children) != 2 {
		t.Fatalf("updated roster = %+v, want the workflow's two children", updated)
	}
	if first, second := updated.Children[0], updated.Children[1]; first.ChildID != "research" ||
		first.State != agentapi.BackgroundFinished || second.ChildID != "synthesis" || second.State != agentapi.BackgroundRunning {
		t.Errorf("children = %+v, want research finished and synthesis running", updated.Children)
	}
	landed := roster(got[5], "sixth event")
	if landed.State != agentapi.BackgroundFinished || landed.Status != "completed" {
		t.Errorf("landed roster = %+v, want the workflow finished on its verdict", landed)
	}
	if got[6].Kind != agentapi.EventBlock || got[6].Block.Text != "inventory done" {
		t.Errorf("seventh event = %+v, want the workflow's completion as the turn's own block", got[6])
	}
	if got[6].MessageID == "" {
		t.Error("the drained block must carry the turn id: it is where a fork picks the session up")
	}
	if got[7].Kind != agentapi.EventNotice {
		t.Errorf("eighth event = %+v, want the notice closing the drain", got[7])
	}
	if last := got[8]; last.Kind != agentapi.EventDone || last.ExitCode != 0 || last.Terminal != "completed" {
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
	driver.Usage = musecli.NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(agentapi.AgentRun{
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
	if got[1].Kind != agentapi.EventBackground || len(got[1].Background) != 1 ||
		got[1].Background[0].State != agentapi.BackgroundRunning {
		t.Errorf("second event = %+v, want the roster carrying the workflow running", got[1])
	}
	if got[3].Kind != agentapi.EventNotice || !strings.Contains(got[3].Message, "still running") {
		t.Errorf("fourth event = %+v, want the notice saying the turn waits on background work", got[3])
	}
	if got[4].Kind != agentapi.EventNotice || !strings.Contains(got[4].Message, "ending the turn without") {
		t.Errorf("fifth event = %+v, want the notice saying the drain timed out", got[4])
	}
	if last := got[5]; last.Kind != agentapi.EventDone || last.ExitCode != 0 || last.Terminal != "completed" {
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

// The drain reconciles what the live stream saw against the session before
// waiting: a workflow whose completion the stream dropped is already finished,
// so there is nothing to wait on and the turn ends as it always did.
func TestMuseDriverDrainSkipsWorkTheSessionShowsFinished(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "drain-stale")
	driver.Usage = musecli.NewMuseUsageService()
	trace, tracePath := museTrace(t)
	if err := driver.Spawn(agentapi.AgentRun{
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
		if event.Kind == agentapi.EventNotice {
			t.Errorf("event = %+v, want no drain notice for finished work", event)
		}
	}
	if got[1].Kind != agentapi.EventBackground || len(got[1].Background) != 1 ||
		got[1].Background[0].State != agentapi.BackgroundRunning {
		t.Errorf("second event = %+v, want the roster carrying the workflow running", got[1])
	}
	// The reconcile found the completion the stream dropped: the roster it
	// settles is what the drain skips waiting on, so the event lands between
	// the reply and the done.
	if got[3].Kind != agentapi.EventBackground || len(got[3].Background) != 1 ||
		got[3].Background[0].State != agentapi.BackgroundFinished {
		t.Errorf("fourth event = %+v, want the reconcile settling the roster finished", got[3])
	}
	if last := got[4]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
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
		{"agent message", map[string]any{"kind": "agentMessage"}, false},
		{"reasoning", map[string]any{"kind": "reasoning"}, false},
		{"reminder child", map[string]any{"kind": "reminderChild"}, false},
		{"user shell", map[string]any{"kind": "userShell"}, false},
		{"compaction", map[string]any{"kind": "compaction"}, false},
		{"unknown kind", map[string]any{"kind": "something-new"}, false},
		{"no kind", map[string]any{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := musecli.MuseBackgroundKind(tc.item); got != tc.want {
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
	driver := &musecli.MuseDriver{
		EventStream: make(chan agentapi.AgentEvent, 8),
		Run:         agentapi.AgentRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	driver.TurnID = "turn-1"
	feed := func(method, itemID, kind, status, turn string) {
		t.Helper()
		params, _ := json.Marshal(map[string]any{
			"sessionId": "ses-1",
			"item": map[string]any{"kind": kind, "itemId": itemID,
				"turnId": turn, "status": status, "entryId": "inventory"},
		})
		if done, _, _ := driver.RelayOne(musecli.MspNotification{Method: method, Params: params}); done {
			t.Fatalf("relayOne(%s) ended the turn", method)
		}
	}
	feed("item/started", "item-wf", "workflow", "inProgress", "turn-1")
	feed("item/started", "item-fg", "toolCall", "inProgress", "turn-1")
	feed("item/started", "item-old", "workflow", "inProgress", "turn-0")
	if got := driver.OpenWorkCount(); got != 1 {
		t.Fatalf("open work = %d, want the turn's workflow alone", got)
	}
	// An update re-files the same work rather than doubling it; a terminal
	// update forgets it outright.
	feed("item/updated", "item-wf", "workflow", "inProgress", "turn-1")
	if got := driver.OpenWorkCount(); got != 1 {
		t.Fatalf("open work after an update = %d, want 1", got)
	}
	feed("item/updated", "item-wf", "workflow", "completed", "turn-1")
	if got := driver.OpenWorkCount(); got != 0 {
		t.Fatalf("open work after a terminal update = %d, want 0", got)
	}
}

// A completion untracks background work whatever turn it names — and work of
// the turn that just ended still files its block under that turn's id, which
// is what the drain reads back.
func TestMuseCompletedItemUntracksAndKeepsTheDrainedTurn(t *testing.T) {
	trace, _ := museTrace(t)
	driver := &musecli.MuseDriver{
		EventStream: make(chan agentapi.AgentEvent, 8),
		Run:         agentapi.AgentRun{Conversation: "conv-1", Turn: "turn-1", Trace: trace},
	}
	driver.TurnID = ""
	driver.LastTurnID = "turn-9"
	driver.OpenWork = map[string]musecli.MuseWorkItem{"item-wf": {Kind: "workflow", Label: `workflow "inventory"`}}
	params := map[string]any{
		"sessionId": "ses-1",
		"item": map[string]any{"kind": "workflow", "itemId": "item-wf",
			"turnId": "turn-9", "status": "completed", "fallbackText": "inventory done"},
	}
	events := driver.CompletedItem(params)
	if len(events) != 2 || events[0].Kind != agentapi.EventBackground || events[1].Kind != agentapi.EventBlock {
		t.Fatalf("completedItem = %+v, want the roster settling first and the drained block after", events)
	}
	if len(events[0].Background) != 1 || events[0].Background[0].State != agentapi.BackgroundFinished {
		t.Errorf("roster = %+v, want the workflow finished", events[0].Background)
	}
	if events[1].MessageID != "turn-9" {
		t.Errorf("MessageID = %q, want the ended turn's id", events[1].MessageID)
	}
	if got := driver.OpenWorkCount(); got != 0 {
		t.Errorf("open work = %d, want the completion untracked", got)
	}
}

// Parked on something only a person can answer, a silent turn is waiting rather than wedged: the
// idle wait starts over for as long as the ask stands, and the turn ends when it is stopped.
func TestMuseDriverParkedTurnSurvivesQuiet(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "ask")
	driver.IdleTimeout = 50 * time.Millisecond
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "list the files", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	if second := museNext(t, events); second.Kind != agentapi.EventAsk {
		t.Fatalf("second event = %+v, want the ask", second)
	}
	select {
	case event := <-events:
		t.Fatalf("parked turn ended while waiting: %+v", event)
	case <-time.After(6 * 50 * time.Millisecond):
	}
	driver.Stop()
	var rest []agentapi.AgentEvent
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
	if len(rest) != 1 || rest[0].Kind != agentapi.EventDone || rest[0].ExitCode != -1 {
		t.Errorf("rest = %+v, want the service-ended done and nothing else", rest)
	}
}

// A stopped turn ends as one this service ended, whatever the host still held.
func TestMuseDriverStopsATurn(t *testing.T) {
	dir := t.TempDir()
	driver, _ := museStubDriver(t, "cancel")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "never mind", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	driver.Stop()
	driver.Stop() // idempotent: the second one is silence
	var rest []agentapi.AgentEvent
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
	if len(rest) != 1 || rest[0].Kind != agentapi.EventDone || rest[0].ExitCode != -1 {
		t.Errorf("rest = %+v, want the service-ended done and nothing else", rest)
	}
}

// `/compact` shortens the session instead of starting a turn: no prompt goes anywhere, and the
// turn ends on the compaction landing. With no session there is nothing to shorten, and no host
// is spawned at all.
func TestMuseDriverCompactsSessions(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "compact")
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "/compact", WorkDir: dir, StoreRoot: dir, SessionID: "ses-1",
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[0].Kind != agentapi.EventSession {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[1].Kind != agentapi.EventBlock || !strings.Contains(got[1].Block.Text, "compacted") {
		t.Errorf("second event = %+v, want the compaction said in the transcript", got[1])
	}
	if got[2].Kind != agentapi.EventDone || got[2].ExitCode != 0 {
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
	driver := &musecli.MuseDriver{
		Binary:      filepath.Join(dir, "no-such-host"),
		EventStream: make(chan agentapi.AgentEvent),
		Cfg:         &runnerconfig.Config{},
	}
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "  /compact  ", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 2 || got[0].Kind != agentapi.EventBlock || got[1].Kind != agentapi.EventDone {
		t.Fatalf("events = %+v, want the notice and a clean done", got)
	}
}

// A turn handed servers runs pointed at its own staged configuration: the ledger's servers with
// the token written in. The staging is gone by the time the turn ends — it held the credential.
func TestMuseDriverRunsAStagedTurn(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	fragment := musecli.BuildMuseMCPConfig(mcpServersFixture())
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "with tools", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		MCPConfig: fragment, MCPToken: "turn-token",
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if len(got) != 3 || got[2].Kind != agentapi.EventDone || got[2].ExitCode != 0 {
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
	if _, err := pkgExec.LookPath(musecli.MuseBinaryName); err != nil {
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
	conn, err := musecli.SpawnMSP(ctx, musecli.MuseBinaryName, musecli.MuseServeArgs(), dir, os.Environ(), nil)
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
		"commandId": musecli.MspCommandID(), "workspaceRoot": dir, "approvalMode": "onRequest",
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
		"commandId": musecli.MspCommandID(), "sessionId": started.Session.SessionID,
		"excludeItems": true,
	})
	if err != nil {
		t.Fatalf("session/resume = %v", err)
	}
	raw, err = conn.Call("session/fork", map[string]any{
		"commandId": musecli.MspCommandID(), "sessionId": started.Session.SessionID,
	})
	if err != nil && !strings.Contains(err.Error(), "file birth time is unavailable") {
		t.Fatalf("session/fork = %v", err)
	}
	if err != nil {
		// The host has no file birth time on this platform, so it cannot fork.
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
		"commandId": musecli.MspCommandID(), "sessionId": started.Session.SessionID,
		"mode": "allowAll",
	}); err != nil {
		t.Errorf("session/setApprovalMode = %v", err)
	}
}

// A host that would not start is the sentence the user is shown — and nothing is staged, streamed
// or left behind.
func TestMuseDriverSpawnFailureIsTheSentenceTheUserSees(t *testing.T) {
	dir := t.TempDir()
	driver := &musecli.MuseDriver{
		Binary:      filepath.Join(dir, "no-such-host"),
		EventStream: make(chan agentapi.AgentEvent),
		Cfg:         &runnerconfig.Config{},
	}
	err := driver.Spawn(agentapi.AgentRun{
		Prompt: "hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	})
	if err == nil || !strings.Contains(err.Error(), "Muse") {
		t.Fatalf("Spawn = %v, want the Muse sentence", err)
	}
}

// As its turn ends, the driver asks the still-living host what it observed of the account, and
// the agent's quota answers it from then on: a refresh after a Muse turn is the last turn's
// figures. The turn's own events are untouched by the extra question.
func TestMuseDriverHarvestsTheQuotaAsTheTurnEnds(t *testing.T) {
	dir := t.TempDir()
	driver, logPath := museStubDriver(t, "turn")
	usage := musecli.NewMuseUsageService()
	driver.Usage = usage
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if last := got[len(got)-1]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
		t.Fatalf("last event = %+v, want a clean agentDone", last)
	}
	calls := museStubCalls(t, logPath)
	museStubCall(t, calls, "usage/read")
	dto, err := usage.GetUsage()
	if err != nil {
		t.Fatalf("the harvested quota should be answerable: %v", err)
	}
	want := []agentapi.AgentWindow{
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
	usage := musecli.NewMuseUsageService()
	older := agentapi.AgentUsageDto{Windows: []agentapi.AgentWindow{
		{WindowMinutes: 300, PercentUsed: 41, ResetAtEpochSeconds: 1789499596}}}
	usage.Note(older, 1789482441110)
	driver.Usage = usage
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say hello", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	got := drainMuse(t, driver)
	if last := got[len(got)-1]; last.Kind != agentapi.EventDone || last.ExitCode != 0 {
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
	usage := musecli.NewMuseUsageService()
	driver := &musecli.MuseDriver{Usage: usage}

	changed := struct {
		Usage musecli.MuseSubscriptionUsage `json:"usage"`
	}{}
	if err := json.Unmarshal([]byte(museObservedUsage), &changed); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	params, err := json.Marshal(changed.Usage)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	if done, _, _ := driver.RelayOne(musecli.MspNotification{Method: "usage/changed", Params: params}); done {
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
	if done, _, _ := driver.RelayOne(musecli.MspNotification{Method: "usage/changed", Params: json.RawMessage(`{no`)}); done {
		t.Error("a malformed usage/changed ends nothing")
	}
	driver.RelayOne(musecli.MspNotification{Method: "usage/changed", Params: json.RawMessage(`{}`)})
	after, _ := usage.GetUsage()
	if !reflect.DeepEqual(before, after) {
		t.Errorf("unreadable figures moved the quota: %+v vs %+v", before, after)
	}
}

// The census dates the silence behind it: a post-mortem reads how long ago the last word was
// spoken from the one line, instead of joining the trace to the transcript. A silence under a
// second is not a silence — an end that arrives on time reads exactly as before.
func TestMuseDriverCensusDatesTheSilence(t *testing.T) {
	quiet := &musecli.MuseDriver{}
	quiet.NoteNotif("item/completed")
	quiet.Mu.Lock()
	quiet.LastNotifAt = time.Now().Add(-8*time.Minute - 12*time.Second)
	quiet.Mu.Unlock()
	if got := quiet.EventSummary(); !strings.Contains(got, "; quiet for 8m12s") {
		t.Errorf("census = %q, want the eight-minute silence dated", got)
	}

	empty := &musecli.MuseDriver{}
	empty.Mu.Lock()
	empty.LastNotifAt = time.Now().Add(-90 * time.Second)
	empty.Mu.Unlock()
	if got := empty.EventSummary(); got != "the host sent nothing; quiet for 1m30s" {
		t.Errorf("empty census = %q, want the silence dated", got)
	}

	fresh := &musecli.MuseDriver{}
	fresh.NoteNotif("item/completed")
	if got := fresh.EventSummary(); strings.Contains(got, "quiet for") {
		t.Errorf("fresh census = %q, want no silence named", got)
	}

	never := &musecli.MuseDriver{}
	if got := never.EventSummary(); got != "the host sent nothing" {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "run me", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	for i := 1; i <= 2; i++ {
		nudge := museNext(t, events)
		if nudge.Kind != agentapi.EventNotice ||
			!strings.HasPrefix(nudge.Message, "Muse has been quiet for ") ||
			!strings.HasSuffix(nudge.Message, "; the turn is still running.") {
			t.Fatalf("notice %d = %+v, want the silence named", i, nudge)
		}
	}
	driver.Stop()
	rest := drainMuse(t, driver)
	if len(rest) != 1 || rest[0].Kind != agentapi.EventDone || rest[0].ExitCode != -1 {
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
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "list the files", WorkDir: dir, StoreRoot: dir,
		PermissionMode: runnerconfig.PermissionModeManual, Thinking: true, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	events := driver.Events()
	if first := museNext(t, events); first.Kind != agentapi.EventSession {
		t.Fatalf("first event = %+v, want the session", first)
	}
	if second := museNext(t, events); second.Kind != agentapi.EventAsk {
		t.Fatalf("second event = %+v, want the ask", second)
	}
	select {
	case event := <-events:
		t.Fatalf("parked turn spoke while waiting: %+v", event)
	case <-time.After(6 * 50 * time.Millisecond):
	}
	driver.Stop()
	drainMuse(t, driver)
	if content := museTraceText(t, tracePath); strings.Contains(content, "still waiting on the host") {
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
	if got := musecli.MuseHostSessionLog("ses-today"); got != today {
		t.Errorf("dated = %q, want %q", got, today)
	}
	older := stage("2020/05/06", "ses-older")
	if got := musecli.MuseHostSessionLog("ses-older"); got != older {
		t.Errorf("undated = %q, want %q", got, older)
	}
	if got := musecli.MuseHostSessionLog("ses-nobody"); got != "" {
		t.Errorf("missing = %q, want nothing", got)
	}
	for _, id := range []string{"", "ses/../escape", "ses/child", `ses\child`, ".."} {
		if got := musecli.MuseHostSessionLog(id); got != "" {
			t.Errorf("hostile %q = %q, want nothing", id, got)
		}
	}
	// A same-named directory is stepped over rather than pointed at.
	dirPath := filepath.Join(dataHome, "muse", "sessions", "2021/07/08", "ses-dir", "session.jsonl")
	if err := os.MkdirAll(dirPath, 0o700); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if got := musecli.MuseHostSessionLog("ses-dir"); got != "" {
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
	if err := driver.Spawn(agentapi.AgentRun{
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
