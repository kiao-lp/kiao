package claude

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// TestClaudeArgs pins the CLI invocation per permission mode. Every mode has to be given a prompt
// surface (`--permission-prompt-tool stdio`): in manual it is what makes the CLI ask instead of
// auto-denying, and in bypass — where nothing is asked about tool calls — it is what keeps
// AskUserQuestion on the model's tool list, since a CLI with nowhere to ask does not offer it. It
// It also pins the two flags a working directory below the store root rests on: `--setting-sources`,
// without which a `.claude/settings.json` pulled into the store would run hooks as the service user,
// and `--add-dir` for the store root, which is what keeps the rest of the store reachable from a
// turn scoped to one folder of it.
func TestClaudeArgs(t *testing.T) {
	joined := func(args []string) string { return strings.Join(args, " ") }
	run := func(mode string) claudeRun {
		return claudeRun{model: "opus", effort: "high", permissionMode: mode, allowBypass: true}
	}

	manual := joined(claudeArgs(run(runnerconfig.PermissionModeManual)))
	if !strings.Contains(manual, "--permission-mode manual") || !strings.Contains(manual, "--permission-prompt-tool stdio") {
		t.Errorf("manual mode args = %q, want the manual mode and the stdio prompt surface", manual)
	}
	if strings.Contains(manual, "--dangerously-skip-permissions") {
		t.Errorf("manual mode args = %q, must not skip permission checks", manual)
	}

	// `manualLive` differs from `manual` only in what the client does with an unanswered card, so
	// the CLI must be spawned identically — and told `manual`, a mode name it actually knows.
	if live := joined(claudeArgs(run(runnerconfig.PermissionModeManualLive))); live != manual {
		t.Errorf("manualLive args = %q, want the manual args %q", live, manual)
	}

	bypass := joined(claudeArgs(run(runnerconfig.PermissionModeBypass)))
	if !strings.Contains(bypass, "--dangerously-skip-permissions") {
		t.Errorf("bypass args = %q, want --dangerously-skip-permissions", bypass)
	}
	// The prompt surface is on the bypass turn too, and it does not weaken it: the CLI allows a tool
	// call before it asks about one, so the only thing that still travels the control protocol is the
	// ask that needs a human by definition — a question put to the user.
	if !strings.Contains(bypass, "--permission-prompt-tool stdio") {
		t.Errorf("bypass args = %q, want the stdio prompt surface so questions can be asked", bypass)
	}
	if strings.Contains(bypass, "--permission-mode") {
		t.Errorf("bypass args = %q, must not also name a permission mode", bypass)
	}

	// The flag is spelled in exactly one place, and that place is also what refuses to spell it: a
	// service configured without bypass asks about every tool call instead, whatever mode a turn that
	// got this far claims to be in.
	withheld := run(runnerconfig.PermissionModeBypass)
	withheld.allowBypass = false
	if got := joined(claudeArgs(withheld)); strings.Contains(got, "--dangerously-skip-permissions") {
		t.Errorf("bypass args on a service that disallows it = %q, must not skip permission checks", got)
	} else if !strings.Contains(got, "--permission-prompt-tool stdio") {
		t.Errorf("bypass args on a service that disallows it = %q, want the manual prompt surface", got)
	}

	for name, args := range map[string]string{"manual": manual, "bypass": bypass} {
		// Both modes answer on stdin, so both read stream-json input.
		if !strings.Contains(args, "--input-format stream-json") {
			t.Errorf("%s args = %q, want stream-json input", name, args)
		}
	}

	resuming := run(runnerconfig.PermissionModeManual)
	resuming.sessionID = " sess-7 "
	// Deliberately untrimmed: whatever the registry stored is what the CLI is asked to resume, and
	// silently reshaping an id here would turn a stored value the CLI rejects into one it cannot even
	// be diagnosed from.
	if resumed := joined(claudeArgs(resuming)); !strings.Contains(resumed, "--resume  sess-7 ") {
		t.Errorf("resumed args = %q, want the session id passed to --resume", resumed)
	}
	blank := run(runnerconfig.PermissionModeManual)
	blank.sessionID = "  "
	if fresh := joined(claudeArgs(blank)); strings.Contains(fresh, "--resume") {
		t.Errorf("blank session id must not resume, got %q", fresh)
	}

	// A fork's first turn resumes a session that is still another conversation's, so it must branch
	// off it rather than continue it: without --fork-session the two conversations would be appending
	// to one session file from then on.
	if plain := joined(claudeArgs(resuming)); strings.Contains(plain, "--fork-session") {
		t.Errorf("an ordinary resume = %q, must not fork the session", plain)
	}
	forking := run(runnerconfig.PermissionModeManual)
	forking.sessionID, forking.forkSession = "sess-7", true
	if got := joined(claudeArgs(forking)); !strings.Contains(got, "--resume sess-7 --fork-session") {
		t.Errorf("fork args = %q, want --fork-session on the resumed session", got)
	}
	// The flag means nothing without a session to branch from, and a CLI given it alone would be
	// asked to fork what it is not resuming.
	forkNothing := run(runnerconfig.PermissionModeManual)
	forkNothing.forkSession = true
	if got := joined(claudeArgs(forkNothing)); strings.Contains(got, "--fork-session") {
		t.Errorf("args = %q, --fork-session must not be spelled without --resume", got)
	}

	// A fork from a point in the conversation cuts the replay where its copied history stops.
	// Without this the CLI replays the session whole, and the copy would show half a conversation
	// Claude remembers all of.
	forkAt := run(runnerconfig.PermissionModeManual)
	forkAt.sessionID, forkAt.forkSession, forkAt.resumeAt = "sess-7", true, "msg-uuid-9"
	if got := joined(claudeArgs(forkAt)); !strings.Contains(got, "--fork-session --resume-session-at=msg-uuid-9") {
		t.Errorf("fork-at args = %q, want the replay cut at the anchor", got)
	}
	// The anchor is a cut in a branch and nothing on its own: an ordinary resume carrying one would
	// be a conversation quietly rewinding itself every turn.
	resumeAt := run(runnerconfig.PermissionModeManual)
	resumeAt.sessionID, resumeAt.resumeAt = "sess-7", "msg-uuid-9"
	if got := joined(claudeArgs(resumeAt)); strings.Contains(got, "--resume-session-at") {
		t.Errorf("args = %q, an anchor must not be spelled without --fork-session", got)
	}

	if sourced := joined(claudeArgs(run(runnerconfig.PermissionModeBypass))); strings.Contains(sourced, "--setting-sources") {
		t.Errorf("args = %q, an empty setting-sources must omit the flag entirely", sourced)
	}
	withSources := run(runnerconfig.PermissionModeBypass)
	withSources.settingSources = "user"
	if sourced := joined(claudeArgs(withSources)); !strings.Contains(sourced, "--setting-sources user") {
		t.Errorf("args = %q, want the configured setting sources", sourced)
	}

	if rootless := joined(claudeArgs(run(runnerconfig.PermissionModeBypass))); strings.Contains(rootless, "--add-dir") {
		t.Errorf("args = %q, an unresolvable store root must omit the flag entirely", rootless)
	}
	withRoot := run(runnerconfig.PermissionModeBypass)
	withRoot.storeRoot = "/store"
	if got := joined(claudeArgs(withRoot)); !strings.Contains(got, "--add-dir /store") {
		t.Errorf("args = %q, want the whole store reachable from a turn scoped to one folder", got)
	}
}

// TestPermissionInputSummary covers what the user is shown to decide on, and the truncation that
// keeps a whole-file Write from being relayed verbatim.
func TestPermissionInputSummary(t *testing.T) {
	if got := protocol.PermissionInputSummary(nil); got != "" {
		t.Errorf("nil input = %q, want empty", got)
	}
	got := protocol.PermissionInputSummary(map[string]any{"file_path": "notes.md"})
	if !strings.Contains(got, "\"file_path\": \"notes.md\"") {
		t.Errorf("object input = %q, want indented JSON", got)
	}
	long := protocol.PermissionInputSummary(strings.Repeat("é", protocol.MaxPermissionInputChars+50))
	if runes := []rune(long); len(runes) != protocol.MaxPermissionInputChars+1 || runes[len(runes)-1] != '…' {
		t.Errorf("long input truncated to %d runes ending %q, want %d plus an ellipsis",
			len(runes), string(runes[len(runes)-1]), protocol.MaxPermissionInputChars)
	}
	if strings.Contains(long, "�") {
		t.Error("truncation split a multi-byte rune")
	}
}

// TestClaudeArgsCarriesBriefing keeps the briefing on the invocation. It is appended to the system
// prompt rather than added to the prompt text so that it is stated once per turn instead of once per
// message, and so that it stays out of the transcript the user reads back.
func TestClaudeArgsCarriesBriefing(t *testing.T) {
	args := claudeArgs(claudeRun{model: "opus", effort: "high", permissionMode: runnerconfig.PermissionModeManual, storeRoot: "/srv/store"})

	for i, arg := range args {
		if arg != "--append-system-prompt" {
			continue
		}
		if i+1 >= len(args) || args[i+1] != briefing.AgentBriefing("/srv/store") {
			t.Fatalf("--append-system-prompt = %q, want the briefing for this store root", args[i+1:])
		}
		return
	}
	t.Errorf("args = %q, want the rendering briefing appended to the system prompt", args)
}

// A turn played by a managed agent carries the agent's standing instructions in the same flag,
// under the briefing.
func TestClaudeArgsAppendsStandingInstructions(t *testing.T) {
	args := claudeArgs(claudeRun{model: "opus", effort: "high", permissionMode: runnerconfig.PermissionModeManual,
		storeRoot: "/srv/store", instructions: "Be terse."})

	for i, arg := range args {
		if arg != "--append-system-prompt" {
			continue
		}
		if i+1 >= len(args) || args[i+1] != briefing.AgentBriefingWith("/srv/store", "Be terse.") {
			t.Fatalf("--append-system-prompt = %q, want the briefing with the instructions under it", args[i+1:])
		}
		return
	}
	t.Errorf("args = %q, want the standing instructions appended to the system prompt", args)
}

// TestClaudeDriverSpawnFailureIsTheSentenceTheUserSees pins what a Spawn answers when the CLI is not
// there. The port says the error *is* the message shown to the user, so its text is the contract and
// not an implementation detail — the hub relays it verbatim rather than rewording it.
func TestClaudeDriverSpawnFailureIsTheSentenceTheUserSees(t *testing.T) {
	driver := &ClaudeDriver{
		binary: filepath.Join(t.TempDir(), "no-such-claude"),
		events: make(chan agentapi.AgentEvent),
	}
	err := driver.Spawn(agentapi.AgentRun{
		WorkDir: t.TempDir(), Model: "opus", Effort: "high", PermissionMode: runnerconfig.PermissionModeManual,
	})
	if err == nil {
		t.Fatal("Spawn with no binary succeeded")
	}
	if !strings.HasPrefix(err.Error(), "The Claude process could not be started: ") {
		t.Errorf("error = %q, want the sentence the user is shown", err)
	}
	// A failed spawn leaves nothing behind: no process, and no event on a stream nobody will drain.
	select {
	case event := <-driver.Events():
		t.Errorf("a failed spawn produced %v, want no event at all", event)
	default:
	}
}

// TestClaudeRunCarriesTheDeploymentsSettings: --setting-sources is a property of the deployment and
// not of the turn, so it comes from the configuration this driver was built with rather than from
// the run the hub handed over. Without it a `.claude/settings.json` pulled into the store would
// install hooks that run as the service user.
func TestClaudeRunCarriesTheDeploymentsSettings(t *testing.T) {
	driver := &ClaudeDriver{cfg: &runnerconfig.Config{ClaudeSettingSources: "user"}}
	if got := driver.runFor(agentapi.AgentRun{Model: "opus"}).settingSources; got != "user" {
		t.Errorf("settingSources = %q, want the deployment's own", got)
	}
	if got := (&ClaudeDriver{}).runFor(agentapi.AgentRun{Model: "opus"}).settingSources; got != "" {
		t.Errorf("settingSources = %q, want none for a driver with no configuration", got)
	}
}

// newTranslator is a driver with no process: enough to read the CLI's lines and to answer on the
// pipe when reading one requires it.
func newTranslator() (*ClaudeDriver, *stdinRecorder) {
	rec := &stdinRecorder{}
	return &ClaudeDriver{Stdin: rec, run: agentapi.AgentRun{Conversation: "c1", Turn: "turn-1"}}, rec
}

// TestClaudeStreamTranslation is the CLI's protocol as this service reads it: one line in, the
// events it means out. This is the half of the seam the hub never sees — everything it makes of
// these events is pinned in claude_ws_test.go.
func TestClaudeStreamTranslation(t *testing.T) {
	for name, tc := range map[string]struct {
		line string
		want []agentapi.AgentEvent
	}{
		"a session announced": {
			`{"type":"system","subtype":"init","session_id":"sess-1"}`,
			[]agentapi.AgentEvent{{Kind: agentapi.EventSession, SessionID: "sess-1"}},
		},
		"a system event naming no session": {
			`{"type":"system","subtype":"init"}`, nil,
		},
		"one finished text block": {
			`{"type":"assistant","uuid":"msg-1","message":{"content":[{"type":"text","text":"hi"}]}}`,
			[]agentapi.AgentEvent{{
				Kind: agentapi.EventBlock, MessageID: "msg-1",
				Block: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "hi"},
			}},
		},
		"a redacted thinking block, which carries no text at all": {
			`{"type":"assistant","message":{"content":[{"type":"redacted_thinking","data":"x"}]}}`,
			[]agentapi.AgentEvent{{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindThinking}}},
		},
		"a content type this service does not carry": {
			`{"type":"assistant","message":{"content":[{"type":"tool_result","content":"done"}]}}`, nil,
		},
		"an ask withdrawn": {
			`{"type":"control_cancel_request","request_id":"req-1"}`,
			[]agentapi.AgentEvent{{Kind: agentapi.EventWithdraw, AskID: "req-1"}},
		},
		"an ask withdrawn without naming one": {
			`{"type":"control_cancel_request"}`, nil,
		},
		"the CLI reporting something that is not a reply": {
			`{"type":"error","error":{"message":"boom"}}`,
			[]agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: "boom"}},
		},
		"a line that is not JSON at all": {`not json`, nil},
	} {
		t.Run(name, func(t *testing.T) {
			driver, _ := newTranslator()
			got := driver.ReadEvent(tc.line)
			if len(got) != len(tc.want) {
				t.Fatalf("readEvent(%s) = %+v, want %+v", tc.line, got, tc.want)
			}
			for i := range got {
				// Deep-compared: the event carries slices (the background
				// roster), which == cannot compare.
				if !reflect.DeepEqual(got[i], tc.want[i]) {
					t.Errorf("event %d = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// The message id rides on every block of the message it names, because the last block of a turn is
// where a fork of this conversation picks the session up.
func TestEveryBlockOfAMessageCarriesItsID(t *testing.T) {
	driver, _ := newTranslator()
	got := driver.ReadEvent(`{"type":"assistant","uuid":"msg-9","message":{"content":[` +
		`{"type":"thinking","thinking":"hmm"},{"type":"text","text":"there"}]}}`)
	if len(got) != 2 {
		t.Fatalf("readEvent = %+v, want one event per content block, in order", got)
	}
	if got[0].Block.Kind != agentapi.BlockKindThinking || got[1].Block.Kind != agentapi.BlockKindText {
		t.Errorf("blocks = %+v, want the CLI's own order kept", got)
	}
	for i, event := range got {
		if event.MessageID != "msg-9" {
			t.Errorf("event %d carries %q, want the message's own id", i, event.MessageID)
		}
	}
}

// A `can_use_tool` request becomes an ask carrying everything the card needs — and the input twice,
// verbatim for the allow that echoes it back and summarised for the person deciding.
func TestCanUseToolBecomesAnAsk(t *testing.T) {
	driver, _ := newTranslator()
	got := driver.ReadEvent(`{"type":"control_request","request_id":"req-1","request":{` +
		`"subtype":"can_use_tool","tool_name":"Edit","display_name":"Edit","description":"notes.md",` +
		`"tool_use_id":"toolu_1","input":{"file_path":"notes.md"}}}`)
	if len(got) != 1 || got[0].Kind != agentapi.EventAsk {
		t.Fatalf("readEvent = %+v, want one ask", got)
	}
	ask := got[0].Ask
	if ask.ID != "req-1" || ask.Tool != "Edit" || ask.DisplayName != "Edit" ||
		ask.Description != "notes.md" || ask.ToolUseID != "toolu_1" {
		t.Errorf("ask = %+v, want every field the card renders", ask)
	}
	if input, _ := ask.Input.(map[string]any); input["file_path"] != "notes.md" {
		t.Errorf("input = %v, want it verbatim for the allow to echo back", ask.Input)
	}
	if !strings.Contains(ask.InputSummary, `"file_path": "notes.md"`) {
		t.Errorf("summary = %q, want the indented JSON a person decides on", ask.InputSummary)
	}
	if ask.IsQuestion() {
		t.Error("an ordinary tool call must not become a question")
	}
}

// A `tool_use` carries the CLI's own id for the call: it is what joins the call to the
// `tool_result` that arrives later on a `user` event.
func TestClaudeToolUseCarriesItsID(t *testing.T) {
	driver, _ := newTranslator()
	got := driver.ReadEvent(`{"type":"assistant","uuid":"msg-1","message":{"content":[` +
		`{"type":"tool_use","id":"toolu_7","name":"Bash","input":{"command":"ls"}}]}}`)
	if len(got) != 1 || got[0].Block.ToolUseID != "toolu_7" {
		t.Fatalf("readEvent = %+v, want the block carrying the call's id", got)
	}
}

// A `user` event's `tool_result` blocks are what the turn's tool calls returned — each naming
// its call, so the hub files it onto that block rather than onto the reply.
func TestClaudeToolResultsNameTheirCall(t *testing.T) {
	driver, _ := newTranslator()
	got := driver.ReadEvent(`{"type":"user","message":{"content":[` +
		`{"type":"tool_result","tool_use_id":"toolu_7","content":"a.md\nb.md"},` +
		`{"type":"tool_result","tool_use_id":"toolu_8","content":[{"type":"text","text":"part one"},` +
		`{"type":"text","text":"part two"}],"is_error":true},` +
		`{"type":"text","text":"not a result"},` +
		`{"type":"tool_result","content":"nameless"}]}}`)
	if len(got) != 2 {
		t.Fatalf("readEvent = %+v, want one result per named tool_result", got)
	}
	if got[0].Kind != agentapi.EventToolResult || got[0].ToolUseID != "toolu_7" ||
		got[0].ToolResult != "a.md\nb.md" || got[0].ToolIsError {
		t.Errorf("first = %+v, want the output filed under its call", got[0])
	}
	if got[1].ToolUseID != "toolu_8" || got[1].ToolResult != "part one\npart two" || !got[1].ToolIsError {
		t.Errorf("second = %+v, want the joined parts marked as an error", got[1])
	}
}

// The `result` event is the bill for the turn — the tokens it cost, which no account probe
// reports — and, when the CLI calls the turn an error, the sentence saying so.
func TestClaudeResultReportsCostAndError(t *testing.T) {
	driver, _ := newTranslator()
	got := driver.ReadEvent(`{"type":"result","subtype":"success","is_error":false,` +
		`"total_cost_usd":0.012,"usage":{"input_tokens":120,"output_tokens":34,` +
		`"cache_read_input_tokens":1000,"cache_creation_input_tokens":50}}`)
	if len(got) != 1 || got[0].Kind != agentapi.EventUsage {
		t.Fatalf("readEvent = %+v, want the turn's bill", got)
	}
	usage := got[0].Usage
	if usage.InputTokens != 120 || usage.OutputTokens != 34 ||
		usage.CacheReadTokens != 1000 || usage.CacheWriteTokens != 50 ||
		usage.TotalCostUSD != 0.012 || usage.Scope != agentapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the event's own figures as a turn total", usage)
	}

	failed := driver.ReadEvent(`{"type":"result","subtype":"error_during_execution",` +
		`"is_error":true,"errors":[{"message":"the model overloaded"}]}`)
	if len(failed) != 1 || failed[0].Kind != agentapi.EventFailure || failed[0].Message != "the model overloaded" {
		t.Errorf("errored result = %+v, want the CLI's sentence reported", failed)
	}

	// A clean result with no figures says nothing at all: no bill, no failure, no event.
	if got := driver.ReadEvent(`{"type":"result","is_error":false}`); got != nil {
		t.Errorf("bare result = %+v, want nothing from an event with nothing to file", got)
	}
}
