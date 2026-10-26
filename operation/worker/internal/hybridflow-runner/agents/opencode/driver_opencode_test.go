package opencode

import (
	"encoding/json"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// opencodeAgentAt is the OpenCode agent pointed at a binary of the test's choosing — the same seam
// codexAgentAt is, and for the same reason.
func opencodeAgentAt(cfg *runnerconfig.Config, binary string) *OpencodeAgent {
	agent := &OpencodeAgent{Cfg: cfg, Binary: binary, OptionsService: NewOpenCodeOptionsService(cfg)}
	agent.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte("opencode/big-pickle\n"), nil
	}
	return agent
}

// opencodeStream is one turn's stream as a test feeds it: the session announced once, the bill
// folded across its steps.
type opencodeStream struct {
	driver    *opencodeDriver
	announced bool
	billed    agentapi.TurnUsage
	billOpen  bool
}

func opencodeEvents(t *testing.T, stream *opencodeStream, event map[string]any) []agentapi.AgentEvent {
	t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	return stream.driver.readEvent(string(raw), &stream.announced, &stream.billed, &stream.billOpen)
}

func freshOpenCodeStream() *opencodeStream {
	return &opencodeStream{driver: &opencodeDriver{}}
}

// A fresh turn is `opencode run`, a continued one adds `--session <id>`, and a forked one `--fork`
// beside it. The prompt travels on stdin in all three, so nothing about it is on the argument
// list.
func TestOpenCodeArgsFreshResumedAndForked(t *testing.T) {
	fresh, err := opencodeArgs(opencodeRun{
		model: "deepseek/deepseek-v4-pro", effort: "high", permissionMode: runnerconfig.PermissionModeBypass,
		thinking: true, allowBypass: true,
	})
	if err != nil {
		t.Fatalf("opencodeArgs = %v", err)
	}
	if fresh[0] != "run" || !hasArg(fresh, "--format") {
		t.Errorf("args = %q, want `run --format json` with no session", fresh)
	}
	if hasArg(fresh, "-s") || hasArg(fresh, "--fork") {
		t.Errorf("args = %q, want no session on a turn with none", fresh)
	}
	if got := argsAfter(t, fresh, "-m"); len(got) != 1 || got[0] != "deepseek/deepseek-v4-pro" {
		t.Errorf("-m = %q, want the turn's model", got)
	}
	if got := argsAfter(t, fresh, "--variant"); len(got) != 1 || got[0] != "high" {
		t.Errorf("--variant = %q, want the effort verbatim", got)
	}
	if !hasArg(fresh, "--thinking") {
		t.Errorf("args = %q, want --thinking where the turn asked to think", fresh)
	}

	resumed, err := opencodeArgs(opencodeRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true,
		sessionID: "ses_01a066e5",
	})
	if err != nil {
		t.Fatalf("opencodeArgs = %v", err)
	}
	if got := argsAfter(t, resumed, "-s"); len(got) != 1 || got[0] != "ses_01a066e5" {
		t.Errorf("-s = %q, want the session id", got)
	}
	if hasArg(resumed, "--fork") {
		t.Errorf("args = %q, want no fork on a plain continuation", resumed)
	}
	if hasArg(resumed, "--thinking") {
		t.Errorf("args = %q, want no --thinking where the turn asked for none", resumed)
	}

	forked, err := opencodeArgs(opencodeRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true,
		sessionID: "ses_01a066e5", forkSession: true,
	})
	if err != nil {
		t.Fatalf("opencodeArgs = %v", err)
	}
	if !hasArg(forked, "--fork") {
		t.Errorf("args = %q, want --fork on the first turn of a forked conversation", forked)
	}
}

// Bypass is the only mode there is, and the flag that spells it is refused rather than spelled
// where the deployment forbids it. Both refusals are sentences: the hub shows what a driver
// answers.
func TestOpenCodeArgsRefuseAnythingButBypass(t *testing.T) {
	if _, err := opencodeArgs(opencodeRun{permissionMode: runnerconfig.PermissionModeManual, allowBypass: true}); err == nil {
		t.Error("a manual turn must be refused: `opencode run` has no channel to ask on")
	}
	if _, err := opencodeArgs(opencodeRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: false}); err == nil {
		t.Error("a bypass turn must be refused where the deployment does not allow bypass")
	}
	args, err := opencodeArgs(opencodeRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true})
	if err != nil {
		t.Fatalf("opencodeArgs = %v", err)
	}
	if !hasArg(args, "--auto") {
		t.Errorf("args = %q, want --auto on the one mode this driver has", args)
	}
}

// The session id *is* on every event, and the first sighting is what the conversation is recorded
// under: it is announced once, before whatever else the line meant, because the end of the turn is
// what an interrupted one never reaches.
func TestOpenCodeAnnouncesTheSessionOnce(t *testing.T) {
	stream := freshOpenCodeStream()
	events := opencodeEvents(t, stream, map[string]any{
		"type": "text", "sessionID": "ses_01a0",
		"part": map[string]any{"type": "text", "text": "hi"},
	})
	if len(events) != 2 || events[0].Kind != agentapi.EventSession || events[0].SessionID != "ses_01a0" {
		t.Fatalf("events = %+v, want the session announced ahead of the block", events)
	}
	if events[1].Kind != agentapi.EventBlock {
		t.Fatalf("events = %+v, want the block after the session", events)
	}
	later := opencodeEvents(t, stream, map[string]any{
		"type": "text", "sessionID": "ses_01a0",
		"part": map[string]any{"type": "text", "text": "again"},
	})
	if len(later) != 1 || later[0].Kind != agentapi.EventBlock {
		t.Errorf("events = %+v, want the session announced exactly once", later)
	}
}

// Every event kind this CLI produces, and what each becomes. A text is text, a reasoning is
// thinking, and everything the turn *did* is a tool call under the CLI's own name for it.
func TestOpenCodePartsBecomeBlocks(t *testing.T) {
	for _, tc := range []struct {
		name      string
		eventType string
		part      map[string]any
		kind      string
		blockName string
	}{
		{name: "text", eventType: "text",
			part: map[string]any{"type": "text", "text": "done"},
			kind: agentapi.BlockKindText},
		{name: "reasoning", eventType: "reasoning",
			part: map[string]any{"type": "reasoning", "text": "weighing it up"},
			kind: agentapi.BlockKindThinking},
		{name: "tool", eventType: "tool_use",
			part: map[string]any{"type": "tool", "tool": "bash",
				"state": map[string]any{"status": "completed", "input": map[string]any{}, "output": "ok"}},
			kind: agentapi.BlockKindToolUse, blockName: "bash"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stream := freshOpenCodeStream()
			events := opencodeEvents(t, stream, map[string]any{
				"type": tc.eventType, "sessionID": "ses_1", "part": tc.part,
			})
			// The session announcement heads the first line's events; the block follows it.
			if len(events) != 2 || events[1].Kind != agentapi.EventBlock {
				t.Fatalf("events = %+v, want a session and a block", events)
			}
			block := events[1].Block
			if block.Kind != tc.kind {
				t.Errorf("kind = %q, want %q", block.Kind, tc.kind)
			}
			if tc.blockName != "" && block.Name != tc.blockName {
				t.Errorf("name = %q, want %q", block.Name, tc.blockName)
			}
			// No MessageID ever: a fork copies the session whole and takes no cut point, so an
			// anchor taken from a part id would name nothing to cut at.
			if events[1].MessageID != "" {
				t.Errorf("messageID = %q, want none from an agent that forks whole sessions", events[1].MessageID)
			}
		})
	}
}

// A tool part is finished, so its outcome travels on the block beside the call: what it returned,
// and whether that was an error. The call still reads as it always did — the tool's name is the
// chip, the outcome is new beside it.
func TestOpenCodeToolCarriesItsOutcome(t *testing.T) {
	completed := opencodeEvents(t, freshOpenCodeStream(), map[string]any{
		"type": "tool_use", "sessionID": "ses_1",
		"part": map[string]any{
			"type": "tool", "tool": "write", "callID": "call_1",
			"state": map[string]any{
				"status": "completed",
				"input":  map[string]any{"path": "a.md"},
				"output": "wrote 3 lines",
				"time":   map[string]any{"start": 1000, "end": 1250},
			},
		},
	})
	block := completed[len(completed)-1].Block
	if block.Result != "wrote 3 lines" || block.IsError {
		t.Errorf("block = %+v, want the output filed as a success", block)
	}
	if block.ToolUseID != "call_1" {
		t.Errorf("toolUseID = %q, want the call id", block.ToolUseID)
	}
	if block.DurationMs != 250 {
		t.Errorf("durationMs = %d, want the measured 250", block.DurationMs)
	}

	failed := opencodeEvents(t, freshOpenCodeStream(), map[string]any{
		"type": "tool_use", "sessionID": "ses_1",
		"part": map[string]any{
			"type": "tool", "tool": "bash",
			"state": map[string]any{
				"status": "error",
				"input":  map[string]any{"command": "exit 3"},
				"error":  "exit status 3",
			},
		},
	})
	block = failed[len(failed)-1].Block
	if block.Result != "exit status 3" || !block.IsError {
		t.Errorf("block = %+v, want the error filed as one", block)
	}
}

// `step_finish` only ever carries the cost: the steps' tokens fold into the turn's one bill, and
// a step that reported nothing but zeros is no bill at all rather than a free one.
func TestOpenCodeStepsFoldIntoOneBill(t *testing.T) {
	stream := freshOpenCodeStream()
	for _, tokens := range []map[string]any{
		{"input": 100, "output": 20, "cache": map[string]any{"read": 10, "write": 5}},
		{"input": 50, "output": 30, "cache": map[string]any{"read": 0, "write": 0}},
	} {
		events := opencodeEvents(t, stream, map[string]any{
			"type": "step_finish", "sessionID": "ses_1",
			"part": map[string]any{"type": "step-finish", "tokens": tokens, "cost": 0.001},
		})
		for _, event := range events {
			if event.Kind == agentapi.EventUsage {
				t.Fatalf("events = %+v, want the bill filed once, at the end", events)
			}
		}
	}
	if !stream.billOpen {
		t.Fatal("want the steps folded into an open bill")
	}
	bill := stream.billed
	if bill.InputTokens != 150 || bill.OutputTokens != 50 {
		t.Errorf("bill = %+v, want the folded tokens", bill)
	}
	if bill.CacheReadTokens != 10 || bill.CacheWriteTokens != 5 {
		t.Errorf("bill = %+v, want the folded cache", bill)
	}
	if bill.TotalCostUSD != 0.002 {
		t.Errorf("bill = %+v, want the folded cost", bill)
	}

	empty := freshOpenCodeStream()
	opencodeEvents(t, empty, map[string]any{
		"type": "step_finish", "sessionID": "ses_1",
		"part": map[string]any{"type": "step-finish",
			"tokens": map[string]any{"input": 0, "output": 0}}},
	)
	if empty.billOpen {
		t.Error("want no bill from a step that reported nothing but zeros")
	}
}

// An error reports; it does not end the turn. A turn refused for want of credentials travels
// under its own code, and anything else is shown as the sentence the CLI gave.
func TestOpenCodeErrorsReportWithoutEnding(t *testing.T) {
	stream := freshOpenCodeStream()
	events := opencodeEvents(t, stream, map[string]any{
		"type": "error", "sessionID": "ses_1",
		"error": map[string]any{"name": "ProviderAuthError",
			"data": map[string]any{"message": "no API key for deepseek"}},
	})
	last := events[len(events)-1]
	if last.Kind != agentapi.EventFailure || last.Message != "no API key for deepseek" || !last.AuthRequired {
		t.Errorf("events = %+v, want the auth failure under its own code", events)
	}

	plain := opencodeEvents(t, freshOpenCodeStream(), map[string]any{
		"type": "error", "sessionID": "ses_1",
		"error": map[string]any{"name": "UnknownError",
			"data": map[string]any{"message": "Unexpected server error. Check server logs for details."}},
	})
	last = plain[len(plain)-1]
	if last.Kind != agentapi.EventFailure || last.AuthRequired {
		t.Errorf("events = %+v, want a plain failure, not an auth one", plain)
	}
	for _, event := range append(events, plain...) {
		if event.Kind == agentapi.EventDone {
			t.Errorf("events = %+v, want no end from an error alone", event)
		}
	}
}

// The two verbs this CLI has no spelling for are refused in sentences: the hub shows what a
// driver answers, and shows it as it stands.
func TestOpenCodeRefusesTheVerbsItCannotHonour(t *testing.T) {
	driver := &opencodeDriver{}
	if err := driver.Answer("ask-1", agentapi.AskDecision{Allow: true}); err == nil {
		t.Error("Answer must be refused: nothing ever asks")
	}
	if err := driver.Say("later"); err == nil {
		t.Error("Say must be refused: stdin carried the prompt and was closed")
	}
}

// A turn refused before it started is the sentence the user is shown: it names OpenCode rather
// than a code.
func TestOpenCodeSpawnFailureIsTheSentenceTheUserSees(t *testing.T) {
	driver := &opencodeDriver{binary: "opencode-that-is-not-on-any-path"}
	err := driver.Spawn(agentapi.AgentRun{
		Prompt: "hi", WorkDir: t.TempDir(),
		PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	})
	if err == nil || !strings.Contains(err.Error(), "OpenCode") {
		t.Errorf("Spawn = %v, want the sentence naming OpenCode", err)
	}
}

// The whole turn through a stub CLI: the prompt on stdin with the briefing ahead of it, the
// session, the blocks, the folded bill, and the clean end.
func TestOpenCodeDriverRunsAWholeTurn(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"cat > \"" + filepath.Join(dir, "prompt.txt") + "\"\n" +
		"echo 'not JSON, and on stderr where it belongs' >&2\n" +
		`printf '%s\n' '{"type":"text","timestamp":1,"sessionID":"ses-1","part":{"type":"text","text":"ok"}}'` + "\n" +
		`printf '%s\n' '{"type":"step_finish","timestamp":2,"sessionID":"ses-1","part":{"type":"step-finish","tokens":{"input":10,"output":5},"cost":0.001}}'` + "\n"
	binary := stubHostBinary(t, dir, "opencode-stub", script)

	driver := &opencodeDriver{binary: binary, events: make(chan agentapi.AgentEvent)}
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say ok", WorkDir: dir, StoreRoot: "/srv/store",
		PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}

	got := drainDriverEvents(t, driver, 10*time.Second)

	if len(got) != 4 {
		t.Fatalf("events = %+v, want a session, a block, a bill and a done", got)
	}
	if got[0].Kind != agentapi.EventSession || got[0].SessionID != "ses-1" {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != agentapi.EventBlock || got[1].Block.Text != "ok" {
		t.Errorf("second event = %+v, want the reply", got[1])
	}
	if got[2].Kind != agentapi.EventUsage || got[2].Usage.InputTokens != 10 {
		t.Errorf("third event = %+v, want the folded bill", got[2])
	}
	if got[3].Kind != agentapi.EventDone || got[3].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", got[3])
	}
	// The prompt goes in on stdin, whole, with the briefing ahead of it — and never in the
	// argument list.
	prompt := mustRead(t, filepath.Join(dir, "prompt.txt"))
	if !strings.HasSuffix(prompt, "say ok") || !strings.Contains(prompt, "mermaid") {
		t.Errorf("prompt on stdin = %q, want the briefing ahead of the turn's prompt", prompt)
	}
}

// A turn that dies without saying why on its stream died of something it said on stderr. Relaying
// that one line is the difference between a failure a user can act on and a bare exit code.
func TestOpenCodeRelaysStderrWhenTheStreamSaidNothing(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\ncat > /dev/null\necho 'ProviderModelNotFoundError: Model not found: deepseek/x' >&2\nexit 1\n"
	binary := stubHostBinary(t, dir, "opencode-stub", script)
	driver := &opencodeDriver{binary: binary, events: make(chan agentapi.AgentEvent)}
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "hi", WorkDir: dir, PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	var got []agentapi.AgentEvent
	for event := range driver.Events() {
		got = append(got, event)
	}
	if len(got) != 2 || got[0].Kind != agentapi.EventFailure {
		t.Fatalf("events = %+v, want the stderr line reported before the end", got)
	}
	if !strings.Contains(got[0].Message, "Model not found") {
		t.Errorf("failure = %q, want the line the CLI actually wrote", got[0].Message)
	}
	if got[1].Kind != agentapi.EventDone || got[1].ExitCode == 0 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[1])
	}
}
