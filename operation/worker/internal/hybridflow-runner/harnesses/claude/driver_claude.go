package claude

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	briefing "kiao/worker/internal/hybridflow-runner/harnesses/prompt"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	pkgSkills "kiao/worker/internal/hybridflow-runner/skills"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Adapts the Claude CLI flags and stream-json control protocol to HarnessDriver.
type ClaudeHarness struct {
	Cfg *runnerconfig.Config
	// Overridable to test spawn failures without an installed CLI.
	Binary string

	OptionsService *ClaudeOptionsService
	usage          *ClaudeUsageService
	Login          *ClaudeLoginService
}

var (
	_ harnessapi.Harness          = (*ClaudeHarness)(nil)
	_ harnessapi.HarnessOptions   = (*ClaudeHarness)(nil)
	_ harnessapi.HarnessUsage     = (*ClaudeHarness)(nil)
	_ harnessapi.HarnessLogin     = (*ClaudeHarness)(nil)
	_ harnessapi.HarnessMCP       = (*ClaudeHarness)(nil)
	_ harnessapi.HarnessBranching = (*ClaudeHarness)(nil)
)

func NewClaudeHarness(cfg *runnerconfig.Config) *ClaudeHarness {
	return &ClaudeHarness{
		Cfg:            cfg,
		Binary:         pkgSkills.ClaudeBinaryName,
		OptionsService: NewClaudeOptionsService(cfg),
		usage:          newClaudeUsageService(cfg),
		Login:          newClaudeLoginService(cfg),
	}
}

func (a *ClaudeHarness) Driver() harnessapi.HarnessDriver {
	return &ClaudeDriver{cfg: a.Cfg, binary: a.Binary, events: make(chan harnessapi.HarnessEvent)}
}

func (a *ClaudeHarness) Options() harnessapi.HarnessOptionsDto { return a.OptionsService.Get() }

func (a *ClaudeHarness) Usage() (harnessapi.HarnessUsageDto, error) { return a.usage.getUsage() }

// LoginEnabled gates login endpoints; auth status remains readable when disabled.
func (a *ClaudeHarness) LoginEnabled() bool { return a.Login.Enabled }

func (a *ClaudeHarness) AuthStatus() (harnessapi.HarnessAuthStatusDto, error) {
	return a.Login.Status()
}

func (a *ClaudeHarness) LoginStart() (string, error) { return a.Login.Start() }

func (a *ClaudeHarness) LoginCancel() bool { return a.Login.cancel() }

func (a *ClaudeHarness) LoginShutdown() { a.Login.Shutdown() }

func (a *ClaudeHarness) LoginCode(code string) (bool, string, error) {
	return a.Login.SubmitCode(code)
}

// --fork-session resumes history under a new session ID.
func (a *ClaudeHarness) BranchesSessions() bool { return true }

func (a *ClaudeHarness) RenderMCP(servers []equipment.MCPServer) (string, error) {
	return writeMCPConfig(a.Cfg, servers)
}

// claudeRun translates HarnessRun into CLI arguments.
type claudeRun struct {
	model, effort, permissionMode, sessionID string
	instructions                             string
	// Branch from sessionID on the first turn of a forked conversation.
	forkSession bool
	// CLI message UUID where forked history ends; empty replays the whole session.
	resumeAt      string
	mcpConfigPath string
	// Restrict settings sources: project settings pulled into the store can install hooks
	// that --print executes as the service user without prompting.
	settingSources string
	// Open the whole store with --add-dir to avoid manual permission requests when
	// a turn working in one folder reads another.
	storeRoot string
	// Gate bypass again at flag construction so new callers fail closed.
	allowBypass bool
}

// Settings sources come from deployment configuration, not the turn caller.
func (d *ClaudeDriver) runFor(run harnessapi.HarnessRun) claudeRun {
	settingSources := ""
	if d.cfg != nil {
		settingSources = d.cfg.ClaudeSettingSources
	}
	return claudeRun{
		model:          run.Model,
		effort:         run.Effort,
		permissionMode: run.PermissionMode,
		instructions:   run.Instructions,
		sessionID:      run.SessionID,
		forkSession:    run.ForkSession,
		resumeAt:       run.ResumeAt,
		mcpConfigPath:  run.MCPConfig,
		settingSources: settingSources,
		storeRoot:      run.StoreRoot,
		allowBypass:    run.AllowBypass,
	}
}

// Keep stream-json stdin open for prompts, permission answers and mid-turn messages.
// --permission-prompt-tool stdio is required in both modes: manual otherwise
// auto-denies prompt-worthy calls, and bypass otherwise hides AskUserQuestion.
// Bypass still allows ordinary tools before any control request is sent.
func claudeArgs(run claudeRun) []string {
	args := []string{
		"--print",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--include-partial-messages",
		"--verbose",
		"--model", run.model,
		"--effort", run.effort,
		"--append-system-prompt", briefing.HarnessBriefingWith(run.storeRoot, run.instructions),
	}
	if sources := strings.TrimSpace(run.settingSources); sources != "" {
		args = append(args, "--setting-sources", sources)
	}
	if root := strings.TrimSpace(run.storeRoot); root != "" {
		args = append(args, "--add-dir", root)
	}
	// --strict-mcp-config prevents loading additional servers from the writable
	// <HOME>/.claude.json. Omit both flags when using the operator's own CLI config.
	if path := strings.TrimSpace(run.mcpConfigPath); path != "" {
		args = append(args, "--mcp-config", path, "--strict-mcp-config")
	}
	if strings.TrimSpace(run.sessionID) != "" {
		args = append(args, "--resume", run.sessionID)
		// Fork under a new ID rather than writing to the source conversation's session.
		if run.forkSession {
			args = append(args, "--fork-session")
			// Limit replay to copied history. Only trim a fork, never the session being continued.
			if uuid := strings.TrimSpace(run.resumeAt); uuid != "" {
				args = append(args, "--resume-session-at="+uuid)
			}
		}
	}
	args = append(args, "--permission-prompt-tool", "stdio")
	// manualLive is a worker policy unknown to the CLI. Fall back to manual if bypass is disallowed.
	if runnerconfig.AsksBeforeTools(run.permissionMode) || !run.allowBypass {
		return append(args, "--permission-mode", runnerconfig.PermissionModeManual)
	}
	return append(args, "--dangerously-skip-permissions")
}

// claudeDriver owns one process and is never reused.
type ClaudeDriver struct {
	cfg    *runnerconfig.Config
	binary string
	run    harnessapi.HarnessRun

	// Unbuffered to apply hub back-pressure to CLI reads.
	events chan harnessapi.HarnessEvent

	// Flush partial stderr after reaping. Set before the reader starts; no lock needed.
	stderrOut *turntrace.TraceLineWriter

	// Reader-owned terminal failure; subsequent model output is discarded.
	terminal string
	// A result ends one CLI turn; idle means no background continuation remains.
	sessionState  string
	sawResult     bool
	cliVersion    string
	mainUsage     harnessapi.TurnUsage
	modelUsage    *harnessapi.TurnUsage
	usageBaseline *harnessapi.TurnUsage
	childUsage    map[string]harnessapi.TurnUsage
	pendingUsage  map[string]harnessapi.TurnUsage
	streamMessage string

	mu  sync.Mutex
	cmd *exec.Cmd

	// Keep stdin open for permission answers and mid-turn messages; closing it ends the process.
	stdinMu     sync.Mutex
	Stdin       io.WriteCloser
	stdinClosed bool
}

var _ harnessapi.HarnessDriver = (*ClaudeDriver)(nil)

// Spawn leaves no pipes or child process behind on failure and produces no events.
func (d *ClaudeDriver) Spawn(run harnessapi.HarnessRun) error {
	d.run = run
	d.loadUsageBaseline()
	cmd := exec.Command(d.binary, claudeArgs(d.runFor(run))...)
	// WorkDir must be absolute and symlink-resolved to prevent escaping the store.
	cmd.Dir = run.WorkDir
	cmd.Env = append(os.Environ(),
		"CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1",
		"CLAUDE_CODE_BG_TASKS_REPORT_RUNNING=1",
	)
	if !run.Thinking {
		// The CLI has no --thinking flag.
		cmd.Env = append(cmd.Env, "CLAUDE_CODE_DISABLE_THINKING=1")
	}
	if run.MCPToken != "" {
		// The MCP config references ${KIAO_MCP_TURN_TOKEN}, expanded by the CLI.
		// Keep the credential out of files and process arguments.
		cmd.Env = append(cmd.Env, "KIAO_MCP_TURN_TOKEN="+run.MCPToken)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return harnessapi.NotStarted(err)
	}
	d.attachStdin(stdin)
	pr, pw, err := os.Pipe()
	if err != nil {
		d.closeStdin("stdout pipe failed")
		return harnessapi.NotStarted(err)
	}
	cmd.Stdout = pw
	// Keep stderr out of the JSON stream. exec drains this writer and Wait joins it;
	// an unread pipe could block the child.
	if stderrOut := run.Trace.StderrWriter(); stderrOut != nil {
		d.stderrOut = stderrOut
		cmd.Stderr = stderrOut
	}

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		d.closeStdin("spawn failed")
		return harnessapi.NotStarted(err)
	}
	pw.Close() // parent drops its write end; child keeps its dup

	d.mu.Lock()
	d.cmd = cmd
	d.mu.Unlock()

	if err := d.writeStdin(map[string]any{
		"type":    "user",
		"message": map[string]any{"role": "user", "content": run.Prompt},
	}); err != nil {
		// No output reader exists yet: kill and reap rather than block on a full pipe.
		_ = cmd.Process.Kill()
		go func() { _ = cmd.Wait() }()
		d.closeStdin("prompt write failed")
		pr.Close()
		return fmt.Errorf("The prompt could not be sent to Claude: %w", err)
	}

	harnessapi.LogClaudeWS.Info("spawned",
		"conversation", run.Conversation, "turn", run.Turn, "pid", cmd.Process.Pid,
		"work_dir", run.WorkDir, "store_root", run.StoreRoot)
	run.Trace.Exec(d.execRecord(cmd))

	go d.read(pr)
	return nil
}

// Trace full argv (including the system prompt) but only added environment variables.
// The trace scrubs KIAO_MCP_TURN_TOKEN.
func (d *ClaudeDriver) execRecord(cmd *exec.Cmd) turntrace.TraceExec {
	path, version := turntrace.BinaryVersion(d.binary)
	d.cliVersion = version
	skills := ""
	if root := pkgSkills.StoreRootOf(d.cfg); root != "" {
		skills = pkgSkills.StoreClaudeSkills(root)
	}
	return turntrace.TraceExec{
		Binary: d.binary, Path: path, Version: version,
		Argv: cmd.Args, Env: turntrace.AddedEnv(cmd.Env), Dir: cmd.Dir, PID: cmd.Process.Pid,
		SkillsPath: skills, Skills: turntrace.InstalledSkills(skills),
	}
}

func (d *ClaudeDriver) Events() <-chan harnessapi.HarnessEvent { return d.events }

// Allow responses must carry schema-valid tool input, never the displayed summary.
func (d *ClaudeDriver) Answer(askID string, decision harnessapi.AskDecision) error {
	var response map[string]any
	if decision.Allow {
		response = map[string]any{"behavior": "allow", "updatedInput": protocol.OrEmptyInput(decision.Input)}
	} else {
		response = map[string]any{"behavior": "deny", "message": decision.Message}
	}
	return d.writeStdin(map[string]any{"type": "control_response", "response": map[string]any{
		"subtype":    "success",
		"request_id": askID,
		"response":   response,
	}})
}

// Say queues a user frame for the next tool boundary within the current turn;
// it produces no separate result and needs no folder or attachment briefing.
func (d *ClaudeDriver) Say(text string) error {
	return d.writeStdin(map[string]any{
		"type":    "user",
		"message": map[string]any{"role": "user", "content": text},
	})
}

// The reader emits harnessDone after the killed process closes stdout.
func (d *ClaudeDriver) Stop() {
	d.stop("stopped")
}

func (d *ClaudeDriver) stop(reason string) {
	d.mu.Lock()
	cmd := d.cmd
	d.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		harnessapi.LogClaudeWS.Info("process killed",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
	d.closeStdin(reason)
}

// read drains stdout and emits exactly one harnessDone with the exit code.
func (d *ClaudeDriver) read(pr *os.File) {
	defer close(d.events)
	reader := bufio.NewReader(pr)
	for {
		line, err := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			// Trace raw frames before translation drops unhandled content.
			d.run.Trace.StreamLine(turntrace.TraceOut, trimmed)
			for _, event := range d.ReadEvent(trimmed) {
				d.events <- event
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				harnessapi.LogClaudeWS.Error("stdout read failed",
					"conversation", d.run.Conversation, "turn", d.run.Turn, "error", err)
			}
			break
		}
	}
	pr.Close()

	// Unblock Wait even if a crash ended stdout without a result frame.
	d.closeStdin("stdout closed")

	exitCode := 0
	if err := d.cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	// Wait joined the stderr copier; flush any unterminated final line.
	d.stderrOut.Flush()
	done := harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: exitCode}
	if d.terminal != "" {
		done.ExitCode = -1
		done.Terminal = d.terminal
	}
	d.events <- done
}

func (d *ClaudeDriver) ReadEvent(line string) []harnessapi.HarnessEvent {
	if d.terminal != "" {
		return nil
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		harnessapi.LogClaudeWS.Warn("event parse failed", "conversation", d.run.Conversation, "error", err)
		return nil
	}
	switch protocol.AsString(event["type"]) {
	case "system":
		return d.systemEvent(event)
	case "assistant":
		return d.assistantEvents(event)
	case "stream_event":
		return d.streamUsageEvents(event)
	case "user":
		return d.userEvents(event)
	case "control_request":
		return d.controlRequest(event)
	case "control_cancel_request":
		if requestID := protocol.AsString(event["request_id"]); requestID != "" {
			return []harnessapi.HarnessEvent{{Kind: harnessapi.EventWithdraw, AskID: requestID}}
		}
	case "result":
		harnessapi.LogClaudeWS.Info("claude result",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "is_error", event["is_error"],
			"session_state", d.sessionState, "origin", event["origin"], "queued_turn_count", event["queued_turn_count"])
		d.sawResult = true
		if d.sessionState == "" {
			d.terminal = "session_state_unavailable"
			events := d.resultEvents(event)
			if !protocol.AsBool(event["is_error"]) {
				events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
					Message: "This Claude CLI does not report session state. Update Claude Code and start a new turn."})
			}
			d.stop("session state unavailable")
			return events
		}
		d.closeInputIfIdle()
		return d.resultEvents(event)
	case "error":
		message := line
		if e, ok := event["error"].(map[string]any); ok {
			if m := protocol.AsString(e["message"]); m != "" {
				message = m
			}
		}
		return []harnessapi.HarnessEvent{{Kind: harnessapi.EventFailure, Message: message}}
	}
	return nil
}

func (d *ClaudeDriver) systemEvent(event map[string]any) []harnessapi.HarnessEvent {
	if version := protocol.AsString(event["claude_code_version"]); version != "" {
		d.cliVersion = version
	}
	switch protocol.AsString(event["subtype"]) {
	case "task_progress", "task_notification":
		if usage := d.noteChildUsage(protocol.AsString(event["task_id"]), event["usage"]); usage != nil {
			return []harnessapi.HarnessEvent{{Kind: harnessapi.EventUsage, Usage: usage}}
		}
	}
	if protocol.AsString(event["subtype"]) == "session_state_changed" {
		state := protocol.AsString(event["state"])
		switch state {
		case "running", "requires_action", "idle":
			d.sessionState = state
			harnessapi.LogClaudeWS.Info("claude session state",
				"conversation", d.run.Conversation, "turn", d.run.Turn, "state", state)
			d.closeInputIfIdle()
		}
		return nil
	}
	sid := protocol.AsString(event["session_id"])
	if sid == "" {
		return nil
	}
	return []harnessapi.HarnessEvent{{Kind: harnessapi.EventSession, SessionID: sid}}
}

// Idle may precede or follow the final result. Startup idle alone cannot end input.
func (d *ClaudeDriver) closeInputIfIdle() {
	if d.sawResult && d.sessionState == "idle" {
		d.closeStdin("idle after result")
	}
}

// Preserve content order. With --include-partial-messages, assistant events
// announce each completed block once; stream_event carries partial growth.
// Do not deduplicate or diff against earlier blocks in the turn.
// The envelope UUID anchors --resume-session-at; only retained blocks move it.
func (d *ClaudeDriver) assistantEvents(event map[string]any) []harnessapi.HarnessEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)
	uuid := protocol.AsString(event["uuid"])

	events := make([]harnessapi.HarnessEvent, 0, len(content)+1)
	if protocol.AsString(event["parent_tool_use_id"]) == "" {
		if usage := d.noteMessageUsage(message); usage != nil {
			events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage})
		}
	}
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		kind := blockKind(protocol.AsString(block["type"]))
		if kind == "" {
			continue
		}
		events = append(events, harnessapi.HarnessEvent{
			Kind: harnessapi.EventBlock, Block: harnessapi.ReadBlock(kind, block), MessageID: uuid,
		})
	}
	return events
}

func blockKind(cliType string) string {
	switch cliType {
	case "text":
		return harnessapi.BlockKindText
	case "thinking", "redacted_thinking":
		return harnessapi.BlockKindThinking
	case "tool_use":
		return harnessapi.BlockKindToolUse
	}
	return ""
}

// Match user tool_result blocks to earlier assistant tool calls by tool_use_id.
func (d *ClaudeDriver) userEvents(event map[string]any) []harnessapi.HarnessEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)

	var events []harnessapi.HarnessEvent
	if result, ok := event["tool_use_result"].(map[string]any); ok {
		id := protocol.AsString(protocol.FirstOf(result, "agentId", "task_id"))
		var raw any = result
		if nested := protocol.FirstOf(result, "usage", "totalUsage", "total_usage"); nested != nil {
			raw = nested
		}
		if usage := d.noteChildUsage(id, raw); usage != nil {
			events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage})
		}
	}
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		if protocol.AsString(block["type"]) != "tool_result" {
			continue
		}
		id := protocol.AsString(block["tool_use_id"])
		if id == "" {
			continue
		}
		result := harnessapi.HarnessEvent{
			Kind: harnessapi.EventToolResult, ToolUseID: id,
			ToolResult:  protocol.ResultSummary(block["content"]),
			ToolIsError: protocol.AsBool(block["is_error"]),
		}
		events = append(events, result)
		if result.ToolIsError && strings.HasPrefix(strings.TrimSpace(result.ToolResult),
			"Tool permission request failed: AbortError: Stream closed") {
			d.terminal = harnessapi.TerminalPermissionChannelClosed
			harnessapi.LogClaudeWS.Error("Claude approval channel closed",
				"conversation", d.run.Conversation, "turn", d.run.Turn,
				"tool_use_id", id, "error", result.ToolResult)
			events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
				Message: "Claude's tool approval channel closed. The turn was stopped because further tool approvals cannot be delivered. " +
					"Start a new turn to retry. CLI error: " + result.ToolResult})
			d.stop("approval channel failed")
			return events
		}
	}
	return events
}

// Result counters settle usage; is_error remains a failure on a zero process exit.
func (d *ClaudeDriver) resultEvents(event map[string]any) []harnessapi.HarnessEvent {
	var events []harnessapi.HarnessEvent
	if usage := d.resultUsage(event); usage != nil {
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage})
	}
	if protocol.AsBool(event["is_error"]) {
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: claudeResultError(event)})
	}
	return events
}

func claudeResultError(event map[string]any) string {
	var errs []string
	if raw, ok := event["errors"].([]any); ok {
		for _, entry := range raw {
			switch e := entry.(type) {
			case string:
				errs = append(errs, e)
			case map[string]any:
				if m := protocol.AsString(e["message"]); m != "" {
					errs = append(errs, m)
				}
			}
			if len(errs) == 3 {
				break
			}
		}
	}
	if len(errs) > 0 {
		return strings.Join(errs, "; ")
	}
	if subtype := protocol.AsString(event["subtype"]); subtype != "" {
		return "Claude reported the turn as failed (" + subtype + ")."
	}
	return "Claude reported the turn as failed."
}

// Unanswered control requests park the CLI, so unsupported subtypes must be refused.
func (d *ClaudeDriver) controlRequest(event map[string]any) []harnessapi.HarnessEvent {
	requestID := protocol.AsString(event["request_id"])
	if requestID == "" {
		harnessapi.LogClaudeWS.Warn("control request without a request id", "conversation", d.run.Conversation)
		return nil
	}
	req, _ := event["request"].(map[string]any)
	subtype := protocol.AsString(req["subtype"])
	if subtype != "can_use_tool" {
		harnessapi.LogClaudeWS.Info("control request refused",
			"conversation", d.run.Conversation, "subtype", subtype)
		_ = d.writeStdin(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype":    "error",
			"request_id": requestID,
			"error":      subtype + " is not supported by worker",
		}})
		return nil
	}

	ask := &harnessapi.HarnessAsk{
		ID:           requestID,
		Tool:         protocol.OrDefault(protocol.AsString(req["tool_name"]), "tool"),
		DisplayName:  protocol.AsString(req["display_name"]),
		Description:  protocol.AsString(req["description"]),
		ToolUseID:    protocol.AsString(req["tool_use_id"]),
		Input:        req["input"],
		InputSummary: protocol.PermissionInputSummary(req["input"]),
	}
	// Match the tool name, not input shape: other tools cannot accept an answers map.
	if protocol.AsString(req["tool_name"]) == runnerconfig.ClaudeAskQuestionTool {
		ask.Questions, ask.QuestionKeys = harnessapi.AskedQuestions(req["input"])
	}
	return []harnessapi.HarnessEvent{{Kind: harnessapi.EventAsk, Ask: ask}}
}

var errClaudeStdinClosed = errors.New("claude stdin is closed")

// Stop latches even before attachment; close a late pipe rather than adopting it.
func (d *ClaudeDriver) attachStdin(stdin io.WriteCloser) {
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed {
		_ = stdin.Close()
		return
	}
	d.Stdin = stdin
}

// Serialize newline-delimited JSON frames shared by prompts, answers and mid-turn messages.
func (d *ClaudeDriver) writeStdin(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	d.run.Trace.StreamLine(turntrace.TraceIn, string(data))
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed || d.Stdin == nil {
		return errClaudeStdinClosed
	}
	_, err = d.Stdin.Write(append(data, '\n'))
	return err
}

// Latch closure before attachment so a late pipe is also closed.
func (d *ClaudeDriver) CloseStdin() {
	d.closeStdin("explicit close")
}

func (d *ClaudeDriver) closeStdin(reason string) {
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed {
		return
	}
	d.stdinClosed = true
	if d.Stdin != nil {
		_ = d.Stdin.Close()
	}
	harnessapi.LogClaudeWS.Info("claude stdin closed",
		"conversation", d.run.Conversation, "turn", d.run.Turn, "reason", reason)
}
