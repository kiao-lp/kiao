package codex

import (
	"encoding/json"
	"kiao/worker/internal/core/equipment"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// codexAgentAt is the Codex agent pointed at a binary of the test's choosing — the same seam
// claudeAgentAt is, and for the same reason.
func codexAgentAt(cfg *runnerconfig.Config, binary string) *CodexAgent {
	agent := NewCodexAgent(cfg)
	agent.Binary = binary
	agent.Login.Binary = binary
	agent.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"slug":"gpt-5.1-codex","display_name":"GPT-5.1 Codex",` +
			`"visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]}]}`), nil
	}
	return agent
}

func argsAfter(t *testing.T, args []string, flag string) []string {
	t.Helper()
	var values []string
	for i, arg := range args {
		if arg == flag && i+1 < len(args) {
			values = append(values, args[i+1])
		}
	}
	return values
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

// A fresh turn is `codex exec`, a continued one is `codex exec resume <session>`, and both end with
// `-`: the prompt is read from stdin so that a long one is neither published to every `ps` on the
// host nor capped by the kernel's argument limit.
func TestCodexArgsFreshAndResumed(t *testing.T) {
	fresh, err := codexArgs(codexRun{
		model: "gpt-5.1-codex", effort: "high", permissionMode: runnerconfig.PermissionModeBypass,
		thinking: true, allowBypass: true,
	})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	if fresh[0] != "exec" || fresh[1] != "--json" {
		t.Errorf("args = %q, want them to open with `exec --json`", fresh)
	}
	if fresh[len(fresh)-1] != "-" {
		t.Errorf("args = %q, want the prompt read from stdin", fresh)
	}
	if hasArg(fresh, "resume") {
		t.Errorf("args = %q, want no resume on a turn with no session", fresh)
	}
	if got := argsAfter(t, fresh, "-m"); len(got) != 1 || got[0] != "gpt-5.1-codex" {
		t.Errorf("-m = %q, want the turn's model", got)
	}
	if !hasArg(fresh, `model_reasoning_effort="high"`) {
		t.Errorf("args = %q, want the effort as a config override", fresh)
	}

	resumed, err := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, thinking: true, allowBypass: true,
		sessionID: "01a066e5-0403-79d1-a14e-b40f49bd4250",
	})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	// `resume` is a subcommand with an option list of its own, so it comes directly after `exec` and
	// every flag after it. The session id is the last argument before the prompt.
	if resumed[0] != "exec" || resumed[1] != "resume" {
		t.Fatalf("args = %q, want `exec resume` to open a continued turn", resumed)
	}
	if resumed[len(resumed)-2] != "01a066e5-0403-79d1-a14e-b40f49bd4250" {
		t.Errorf("args = %q, want the session id just before the prompt", resumed)
	}
}

// Bypass is the only mode there is, and the flag that spells it is refused rather than spelled where
// the deployment forbids it. Both refusals are sentences: the hub shows what a driver answers.
func TestCodexArgsRefuseAnythingButBypass(t *testing.T) {
	if _, err := codexArgs(codexRun{permissionMode: runnerconfig.PermissionModeManual, allowBypass: true}); err == nil {
		t.Error("a manual turn must be refused: `codex exec` has no channel to ask on")
	}
	if _, err := codexArgs(codexRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: false}); err == nil {
		t.Error("a bypass turn must be refused where the deployment does not allow bypass")
	}
	args, err := codexArgs(codexRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	if !hasArg(args, "--dangerously-bypass-approvals-and-sandbox") {
		t.Errorf("args = %q, want the bypass flag on the one mode this driver has", args)
	}
}

// The briefing travels on `developer_instructions`, which is this CLI's `--append-system-prompt`:
// what it says is *added* to the instructions the model already has. `model_instructions_file` would
// replace them, which is a different thing entirely.
func TestCodexArgsCarriesBriefing(t *testing.T) {
	args, err := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true, storeRoot: "/srv/store",
	})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	for _, override := range argsAfter(t, args, "-c") {
		if !strings.HasPrefix(override, "developer_instructions=") {
			continue
		}
		// The value is a TOML basic string, so it is quoted and its newlines are escaped — a raw
		// briefing would not parse and would be taken as a literal by accident rather than by design.
		if !strings.Contains(override, `\n`) || !strings.HasSuffix(override, `"`) {
			t.Errorf("developer_instructions = %q, want a quoted TOML string", override)
		}
		if !strings.Contains(override, "mermaid") || !strings.Contains(override, "/srv/store") {
			t.Errorf("developer_instructions = %q, want the briefing for this store root", override)
		}
		return
	}
	t.Errorf("args = %q, want the briefing on developer_instructions", args)
}

// A turn played by a managed agent carries the agent's standing instructions in the same
// override, under the briefing.
func TestCodexArgsAppendsStandingInstructions(t *testing.T) {
	args, err := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true,
		storeRoot: "/srv/store", instructions: "Be terse.",
	})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	for _, override := range argsAfter(t, args, "-c") {
		if !strings.HasPrefix(override, "developer_instructions=") {
			continue
		}
		if !strings.Contains(override, "mermaid") || !strings.Contains(override, "Be terse.") {
			t.Errorf("developer_instructions = %q, want the briefing with the instructions under it", override)
		}
		return
	}
	t.Errorf("args = %q, want the standing instructions on developer_instructions", args)
}

// Thinking off is the nearest true thing this CLI has: the reasoning summaries stop being emitted,
// so the turn carries no thinking block. Thinking on leaves the CLI's own default alone.
func TestCodexArgsThinking(t *testing.T) {
	off, _ := codexArgs(codexRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true})
	if !hasArg(off, `model_reasoning_summary="none"`) {
		t.Errorf("args = %q, want the reasoning summaries switched off", off)
	}
	on, _ := codexArgs(codexRun{permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true})
	if hasArg(on, `model_reasoning_summary="none"`) {
		t.Errorf("args = %q, want the CLI's own default left alone", on)
	}
}

// The turn's credential is written into the `mcp_servers` override, because Codex expands nothing
// and inherits nothing — see codex_mcp.go. What matters here is that the placeholder never survives
// into the argument list, which would hand the servers a literal `${...}` to authenticate with.
func TestCodexArgsSubstitutesTheTurnToken(t *testing.T) {
	table := buildCodexMCPConfig(mcpServersFixture())
	args, err := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true,
		mcpConfig: table, mcpToken: "turn-token-42",
	})
	if err != nil {
		t.Fatalf("codexArgs = %v", err)
	}
	for _, override := range argsAfter(t, args, "-c") {
		if !strings.HasPrefix(override, "mcp_servers=") {
			continue
		}
		if strings.Contains(override, equipment.MCPTokenPlaceholder) {
			t.Errorf("mcp_servers = %q, want the placeholder replaced by the turn's token", override)
		}
		if !strings.Contains(override, "turn-token-42") {
			t.Errorf("mcp_servers = %q, want the turn's token in it", override)
		}
		return
	}
	t.Errorf("args = %q, want the servers on an mcp_servers override", args)
}

// --ignore-user-config is off by default and rides with the servers when it is on, exactly as
// --strict-mcp-config rides with --mcp-config on the other agent. A turn handed no servers is
// spawned with neither, whatever the deployment says.
func TestCodexArgsIgnoreUserConfigRidesWithTheServers(t *testing.T) {
	table := buildCodexMCPConfig(mcpServersFixture())
	with, _ := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true,
		mcpConfig: table, ignoreUserConfig: true,
	})
	if !hasArg(with, "--ignore-user-config") {
		t.Errorf("args = %q, want the flag where the deployment asked for it", with)
	}
	without, _ := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true, ignoreUserConfig: true,
	})
	if hasArg(without, "--ignore-user-config") {
		t.Errorf("args = %q, want no flag on a turn with no servers to protect", without)
	}
	off, _ := codexArgs(codexRun{
		permissionMode: runnerconfig.PermissionModeBypass, allowBypass: true, thinking: true, mcpConfig: table,
	})
	if hasArg(off, "--ignore-user-config") {
		t.Errorf("args = %q, want the flag off by default: it drops the whole user configuration", off)
	}
}

func codexEvents(t *testing.T, driver *CodexDriver, event map[string]any) []agentapi.AgentEvent {
	t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	return driver.readEvent(string(raw))
}

// The thread id *is* the session: `codex exec resume <id>` is what continues it, and it is recorded
// the moment it arrives because the end of the turn is what an interrupted one never reaches.
func TestCodexReadsTheThreadAsTheSession(t *testing.T) {
	driver := &CodexDriver{}
	events := codexEvents(t, driver, map[string]any{"type": "thread.started", "thread_id": "01a0-66e5"})
	if len(events) != 1 || events[0].Kind != agentapi.EventSession || events[0].SessionID != "01a0-66e5" {
		t.Fatalf("events = %+v, want one agentSession carrying the thread id", events)
	}
	if got := codexEvents(t, driver, map[string]any{"type": "thread.started"}); got != nil {
		t.Errorf("events = %+v, want nothing from a thread.started naming no thread", got)
	}
}

// Every item kind this CLI produces, and what each becomes. A message is text, reasoning is
// thinking, and everything the turn *did* is a tool call under the CLI's own name for it.
func TestCodexItemsBecomeBlocks(t *testing.T) {
	driver := &CodexDriver{}
	for _, tc := range []struct {
		name       string
		item       map[string]any
		kind       string
		blockName  string
		wantDetail string
	}{
		{name: "message", item: map[string]any{"type": "agent_message", "text": "done"},
			kind: agentapi.BlockKindText, wantDetail: ""},
		{name: "reasoning", item: map[string]any{"type": "reasoning", "text": "weighing it up"},
			kind: agentapi.BlockKindThinking},
		{name: "command", item: map[string]any{"type": "command_execution", "command": "/bin/bash -lc 'echo hi'"},
			kind: agentapi.BlockKindToolUse, blockName: "Shell", wantDetail: "/bin/bash -lc 'echo hi'"},
		{name: "search", item: map[string]any{"type": "web_search", "query": "go tool use"},
			kind: agentapi.BlockKindToolUse, blockName: "WebSearch", wantDetail: "go tool use"},
		{name: "mcp", item: map[string]any{"type": "mcp_tool_call", "server": "kiao-files", "tool": "files_read"},
			kind: agentapi.BlockKindToolUse, blockName: "mcp__kiao-files__files_read"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			events := codexEvents(t, driver, map[string]any{"type": "item.completed", "item": tc.item})
			if len(events) != 1 || events[0].Kind != agentapi.EventBlock {
				t.Fatalf("events = %+v, want one block", events)
			}
			block := events[0].Block
			if block.Kind != tc.kind {
				t.Errorf("kind = %q, want %q", block.Kind, tc.kind)
			}
			if tc.blockName != "" && block.Name != tc.blockName {
				t.Errorf("name = %q, want %q", block.Name, tc.blockName)
			}
			if tc.wantDetail != "" && block.Detail != tc.wantDetail {
				t.Errorf("detail = %q, want %q", block.Detail, tc.wantDetail)
			}
			// No MessageID ever: the ids here start again at every turn and this CLI cannot cut a
			// session at one, so an anchor taken from them would name nothing.
			if events[0].MessageID != "" {
				t.Errorf("messageID = %q, want none from an agent that cannot resume at one", events[0].MessageID)
			}
		})
	}
}

// A file change is one line per path, ordered — the CLI's map has no order of its own, and an
// unordered rendering would make two identical patches read as two different ones.
func TestCodexFileChangeReadsAsOneLinePerPath(t *testing.T) {
	driver := &CodexDriver{}
	events := codexEvents(t, driver, map[string]any{"type": "item.completed", "item": map[string]any{
		"type": "file_change", "changes": map[string]any{"z.md": "update", "a.md": "add"},
	}})
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one block", events)
	}
	if got := events[0].Block.Detail; got != "add a.md\nupdate z.md" {
		t.Errorf("detail = %q, want one ordered line per path", got)
	}
}

// A block is taken from `item.completed` and nowhere else: the port says a block is announced once
// and never revised, and what `item.started` carries is the same item with its output still empty.
func TestCodexIgnoresUnfinishedItems(t *testing.T) {
	driver := &CodexDriver{}
	for _, kind := range []string{"item.started", "item.updated", "turn.started", "turn.completed"} {
		got := codexEvents(t, driver, map[string]any{"type": kind, "item": map[string]any{
			"type": "command_execution", "command": "echo hi", "status": "in_progress",
		}})
		if got != nil {
			t.Errorf("%s produced %+v, want nothing: only a completed item is a block", kind, got)
		}
	}
}

// A failure reports and does not end the turn — agentDone does. The reconnection notices arrive as
// `error` events and the turn carries on, which is exactly what the distinction is for.
func TestCodexFailuresDoNotEndTheTurn(t *testing.T) {
	driver := &CodexDriver{}
	events := codexEvents(t, driver, map[string]any{"type": "error", "message": "Reconnecting... 1/5"})
	if len(events) != 1 || events[0].Kind != agentapi.EventFailure || events[0].Message != "Reconnecting... 1/5" {
		t.Fatalf("events = %+v, want one agentFailure carrying the message", events)
	}
	failed := codexEvents(t, driver, map[string]any{"type": "turn.failed",
		"error": map[string]any{"message": "stream disconnected"}})
	if len(failed) != 1 || failed[0].Kind != agentapi.EventFailure || failed[0].Message != "stream disconnected" {
		t.Fatalf("events = %+v, want the failure's own sentence", failed)
	}
	if got := driver.readEvent("not json at all"); got != nil {
		t.Errorf("events = %+v, want a malformed line dropped rather than relayed", got)
	}
}

// Two of the five verbs cannot be honoured, and both say so rather than failing silently: a between
// typed at a Codex turn has to go back to the box it was typed in.
func TestCodexRefusesTheVerbsItCannotHonour(t *testing.T) {
	driver := &CodexDriver{}
	if err := driver.Answer("req-1", agentapi.AskDecision{Allow: true}); err == nil {
		t.Error("Answer must fail: `codex exec` never asks, so nothing is ever waiting")
	}
	if err := driver.Say("one more thing"); err == nil {
		t.Error("Say must fail: stdin carried the prompt and was closed")
	}
}

// The sentence a Spawn answers when the CLI is not there is the contract: the hub relays it to the
// user verbatim rather than rewording it.
func TestCodexSpawnFailureIsTheSentenceTheUserSees(t *testing.T) {
	driver := &CodexDriver{Binary: "codex-does-not-exist-here", EventStream: make(chan agentapi.AgentEvent)}
	err := driver.Spawn(agentapi.AgentRun{
		Prompt: "hello", WorkDir: t.TempDir(),
		PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	})
	if err == nil {
		t.Fatal("Spawn must fail when the binary is not there")
	}
	if !strings.Contains(err.Error(), "Codex process could not be started") {
		t.Errorf("Spawn error = %q, want a sentence naming Codex", err)
	}
}

// One whole turn through a stand-in for the CLI: the prompt written to stdin, the events read off
// stdout, the blocks in the order they happened, and exactly one agentDone at the end.
func TestCodexDriverRunsAWholeTurn(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo codex-fixture; exit 0; fi\n" +
		"cat > \"" + filepath.Join(dir, "prompt.txt") + "\"\n" +
		"echo 'not JSON, and on stderr where it belongs' >&2\n" +
		`printf '%s\n' '{"type":"thread.started","thread_id":"th-1"}'` + "\n" +
		`printf '%s\n' '{"type":"turn.started"}'` + "\n" +
		`printf '%s\n' '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}'` + "\n" +
		`printf '%s\n' '{"type":"turn.completed"}'` + "\n"
	binary := stubHostBinary(t, dir, "codex-stub", script)

	driver := &CodexDriver{Binary: binary, EventStream: make(chan agentapi.AgentEvent)}
	if err := driver.Spawn(agentapi.AgentRun{
		Prompt: "say ok", WorkDir: dir, PermissionMode: runnerconfig.PermissionModeBypass, AllowBypass: true,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}

	got := drainDriverEvents(t, driver, 10*time.Second)

	if len(got) != 3 {
		t.Fatalf("events = %+v, want a session, a block and a done", got)
	}
	if got[0].Kind != agentapi.EventSession || got[0].SessionID != "th-1" {
		t.Errorf("first event = %+v, want the session", got[0])
	}
	if got[1].Kind != agentapi.EventBlock || got[1].Block.Text != "ok" {
		t.Errorf("second event = %+v, want the reply", got[1])
	}
	if got[2].Kind != agentapi.EventDone || got[2].ExitCode != 0 {
		t.Errorf("last event = %+v, want a clean agentDone", got[2])
	}
	// The prompt goes in on stdin, whole, and never in the argument list.
	if prompt := mustRead(t, filepath.Join(dir, "prompt.txt")); prompt != "say ok" {
		t.Errorf("prompt on stdin = %q, want the turn's prompt", prompt)
	}
}

// A turn that dies without saying why on its stream died of something it said on stderr. Relaying
// that one line is the difference between a failure a user can act on and a bare exit code.
func TestCodexRelaysStderrWhenTheStreamSaidNothing(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\ncat > /dev/null\necho 'stream error: unexpected status 401' >&2\nexit 1\n"
	binary := stubHostBinary(t, dir, "codex-stub", script)
	driver := &CodexDriver{Binary: binary, EventStream: make(chan agentapi.AgentEvent)}
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
	if !strings.Contains(got[0].Message, "401") {
		t.Errorf("failure = %q, want the line the CLI actually wrote", got[0].Message)
	}
	if got[1].Kind != agentapi.EventDone || got[1].ExitCode == 0 {
		t.Errorf("last event = %+v, want a non-zero agentDone", got[1])
	}
}

// An item is completed, so its outcome travels on the block beside the call: what it returned,
// whether that was an error, and the exit status when the CLI gave one. The call still reads as
// it always did — the command is the detail, the outcome is new beside it.
func TestCodexCommandCarriesItsOutcome(t *testing.T) {
	driver := &CodexDriver{}
	events := codexEvents(t, driver, map[string]any{"type": "item.completed", "item": map[string]any{
		"type": "command_execution", "id": "item_3", "command": "ls",
		"output": "a.md\nb.md", "status": "completed", "exit_code": float64(0),
	}})
	if len(events) != 1 || events[0].Kind != agentapi.EventBlock {
		t.Fatalf("events = %+v, want one block", events)
	}
	block := events[0].Block
	if block.ToolUseID != "item_3" || block.Result != "a.md\nb.md" || block.IsError {
		t.Errorf("block = %+v, want the output filed under the call's id", block)
	}
	if block.ExitCode == nil || *block.ExitCode != 0 {
		t.Errorf("exitCode = %v, want the status the CLI reported", block.ExitCode)
	}
	if block.Detail != "ls" {
		t.Errorf("detail = %q, want the command still reading as the call", block.Detail)
	}

	failed := codexEvents(t, driver, map[string]any{"type": "item.completed", "item": map[string]any{
		"type": "command_execution", "id": "item_4", "command": "false",
		"status": "failed", "exit_code": float64(1),
	}})
	if len(failed) != 1 {
		t.Fatalf("events = %+v, want one block", failed)
	}
	if !failed[0].Block.IsError {
		t.Errorf("block = %+v, want a failed call marked as an error", failed[0].Block)
	}
	if code := failed[0].Block.ExitCode; code == nil || *code != 1 {
		t.Errorf("exitCode = %v, want 1", code)
	}
}

// `turn.completed` is the bill for the turn: the tokens it cost, which no account probe reports.
// The turn ending is still the process exiting — this event only ever carries the cost.
func TestCodexTurnCompletedReportsItsCost(t *testing.T) {
	driver := &CodexDriver{}
	events := codexEvents(t, driver, map[string]any{
		"type":  "turn.completed",
		"usage": map[string]any{"input_tokens": float64(200), "output_tokens": float64(40)},
	})
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage {
		t.Fatalf("events = %+v, want the turn's bill", events)
	}
	if usage := events[0].Usage; usage.InputTokens != 200 || usage.OutputTokens != 40 ||
		usage.Scope != agentapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the event's own figures as a turn total", usage)
	}
	if got := codexEvents(t, driver, map[string]any{"type": "turn.completed"}); got != nil {
		t.Errorf("bare turn.completed = %+v, want nothing from an event with no figures", got)
	}
}

func TestCodexArgsCarryServiceTiersOnFreshAndResumedTurns(t *testing.T) {
	for _, session := range []string{"", "thread-1"} {
		for _, tier := range []string{"priority", "fast", "ultrafast", "default"} {
			args, err := codexArgs(codexRun{
				model: "gpt-6.1-sol@" + tier, effort: "ultra", sessionID: session,
				allowBypass: true, permissionMode: runnerconfig.PermissionModeBypass,
			})
			if err != nil {
				t.Fatal(err)
			}
			models := argsAfter(t, args, "-m")
			if len(models) != 1 || models[0] != "gpt-6.1-sol" || !hasArg(args, "service_tier="+tomlString(tier)) {
				t.Errorf("args = %q, want a separate slug and %s tier", args, tier)
			}
			if !hasArg(args, `model_reasoning_effort="ultra"`) {
				t.Errorf("args = %q, want the new effort forwarded", args)
			}
			if (tier == "priority" || tier == "fast") != hasArg(args, "features.fast_mode=true") {
				t.Errorf("args = %q, want Fast's feature gate only for Fast", args)
			}
		}
	}
}

func TestCodexLatestUsageKeepsCacheAndReasoningBreakdowns(t *testing.T) {
	driver := &CodexDriver{}
	events := driver.readEvent(`{"type":"turn.completed","usage":{
	 "input_tokens":2000,"cached_input_tokens":1200,"cache_write_input_tokens":300,
	 "output_tokens":500,"reasoning_output_tokens":400}}`)
	if len(events) != 1 || events[0].Kind != agentapi.EventUsage {
		t.Fatalf("events = %+v, want one usage report", events)
	}
	bill := events[0].Usage
	if bill.InputTokens != 2000 || bill.OutputTokens != 500 || bill.CacheReadTokens != 1200 ||
		bill.CacheWriteTokens != 300 || bill.ReasoningTokens != 400 || bill.TotalCostUSD != 0 || bill.Scope != agentapi.UsageScopeTurn {
		t.Errorf("bill = %+v, want totals and their breakdowns with no invented price", bill)
	}
	for _, line := range []string{
		`{"type":"turn.completed","usage":{}}`,
		`{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}`,
	} {
		if got := driver.readEvent(line); got != nil {
			t.Errorf("empty usage = %+v, want no report", got)
		}
	}
}

func TestCodexUsageWithOnlyCacheCountersIsStillReported(t *testing.T) {
	usage, ok := ReadCodexUsage(map[string]any{"cached_input_tokens": float64(100), "cache_write_input_tokens": float64(20)}, nil)
	if !ok || usage.CacheReadTokens != 100 || usage.CacheWriteTokens != 20 {
		t.Fatalf("usage = %+v/%v", usage, ok)
	}
}
