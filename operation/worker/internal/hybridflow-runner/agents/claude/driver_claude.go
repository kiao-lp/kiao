package claude

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	pkgSkills "kiao/worker/internal/hybridflow-runner/skills"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Adapts the Claude CLI flags and stream-json control protocol to AgentDriver.
type ClaudeAgent struct {
	Cfg *runnerconfig.Config
	// Overridable to test spawn failures without an installed CLI.
	Binary string

	OptionsService *ClaudeOptionsService
	usage          *ClaudeUsageService
	Login          *ClaudeLoginService
}

var (
	_ agentapi.Agent          = (*ClaudeAgent)(nil)
	_ agentapi.AgentOptions   = (*ClaudeAgent)(nil)
	_ agentapi.AgentUsage     = (*ClaudeAgent)(nil)
	_ agentapi.AgentLogin     = (*ClaudeAgent)(nil)
	_ agentapi.AgentMCP       = (*ClaudeAgent)(nil)
	_ agentapi.AgentBranching = (*ClaudeAgent)(nil)
)

func NewClaudeAgent(cfg *runnerconfig.Config) *ClaudeAgent {
	return &ClaudeAgent{
		Cfg:            cfg,
		Binary:         pkgSkills.ClaudeBinaryName,
		OptionsService: NewClaudeOptionsService(cfg),
		usage:          newClaudeUsageService(cfg),
		Login:          newClaudeLoginService(cfg),
	}
}

func (a *ClaudeAgent) Driver() agentapi.AgentDriver {
	return &ClaudeDriver{cfg: a.Cfg, binary: a.Binary, events: make(chan agentapi.AgentEvent)}
}

func (a *ClaudeAgent) Options() agentapi.AgentOptionsDto { return a.OptionsService.Get() }

func (a *ClaudeAgent) Usage() (agentapi.AgentUsageDto, error) { return a.usage.getUsage() }

// LoginEnabled gates login endpoints; auth status remains readable when disabled.
func (a *ClaudeAgent) LoginEnabled() bool { return a.Login.Enabled }

func (a *ClaudeAgent) AuthStatus() (agentapi.AgentAuthStatusDto, error) { return a.Login.Status() }

func (a *ClaudeAgent) LoginStart() (string, error) { return a.Login.Start() }

func (a *ClaudeAgent) LoginCancel() bool { return a.Login.cancel() }

func (a *ClaudeAgent) LoginShutdown() { a.Login.Shutdown() }

func (a *ClaudeAgent) LoginCode(code string) (bool, string, error) {
	return a.Login.SubmitCode(code)
}

// --fork-session resumes history under a new session ID.
func (a *ClaudeAgent) BranchesSessions() bool { return true }

func (a *ClaudeAgent) RenderMCP(servers []equipment.MCPServer) (string, error) {
	return writeMCPConfig(a.Cfg, servers)
}

// claudeRun translates AgentRun into CLI arguments.
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
func (d *ClaudeDriver) runFor(run agentapi.AgentRun) claudeRun {
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
		"--append-system-prompt", briefing.AgentBriefingWith(run.storeRoot, run.instructions),
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
	// manualLive is a client mode unknown to the CLI. Fall back to manual if bypass is disallowed.
	if runnerconfig.AsksBeforeTools(run.permissionMode) || !run.allowBypass {
		return append(args, "--permission-mode", runnerconfig.PermissionModeManual)
	}
	return append(args, "--dangerously-skip-permissions")
}

// claudeDriver owns one process and is never reused.
type ClaudeDriver struct {
	cfg    *runnerconfig.Config
	binary string
	run    agentapi.AgentRun

	// Unbuffered to apply hub back-pressure to CLI reads.
	events chan agentapi.AgentEvent

	// Flush partial stderr after reaping. Set before the reader starts; no lock needed.
	stderrOut *turntrace.TraceLineWriter

	mu  sync.Mutex
	cmd *exec.Cmd

	// Keep stdin open for permission answers and mid-turn messages; closing it ends the process.
	stdinMu     sync.Mutex
	Stdin       io.WriteCloser
	stdinClosed bool
}

var _ agentapi.AgentDriver = (*ClaudeDriver)(nil)

// Spawn leaves no pipes or child process behind on failure and produces no events.
func (d *ClaudeDriver) Spawn(run agentapi.AgentRun) error {
	d.run = run
	cmd := exec.Command(d.binary, claudeArgs(d.runFor(run))...)
	// WorkDir must be absolute and symlink-resolved to prevent escaping the store.
	cmd.Dir = run.WorkDir
	cmd.Env = os.Environ()
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
		return agentapi.NotStarted(err)
	}
	d.attachStdin(stdin)
	pr, pw, err := os.Pipe()
	if err != nil {
		d.CloseStdin()
		return agentapi.NotStarted(err)
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
		d.CloseStdin()
		return agentapi.NotStarted(err)
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
		d.CloseStdin()
		pr.Close()
		return fmt.Errorf("The prompt could not be sent to Claude: %w", err)
	}

	agentapi.LogClaudeWS.Info("spawned",
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

func (d *ClaudeDriver) Events() <-chan agentapi.AgentEvent { return d.events }

// Allow responses must carry schema-valid tool input, never the displayed summary.
func (d *ClaudeDriver) Answer(askID string, decision agentapi.AskDecision) error {
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

// The reader emits agentDone after the killed process closes stdout.
func (d *ClaudeDriver) Stop() {
	d.mu.Lock()
	cmd := d.cmd
	d.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		agentapi.LogClaudeWS.Info("process killed",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
	d.CloseStdin()
}

// read drains stdout and emits exactly one agentDone with the exit code.
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
			break
		}
	}
	pr.Close()

	// Unblock Wait even if a crash ended stdout without a result frame.
	d.CloseStdin()

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
	d.events <- agentapi.AgentEvent{Kind: agentapi.EventDone, ExitCode: exitCode}
}

func (d *ClaudeDriver) ReadEvent(line string) []agentapi.AgentEvent {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		agentapi.LogClaudeWS.Warn("event parse failed", "conversation", d.run.Conversation, "error", err)
		return nil
	}
	switch protocol.AsString(event["type"]) {
	case "system":
		return d.systemEvent(event)
	case "assistant":
		return d.assistantEvents(event)
	case "user":
		return d.userEvents(event)
	case "control_request":
		return d.controlRequest(event)
	case "control_cancel_request":
		if requestID := protocol.AsString(event["request_id"]); requestID != "" {
			return []agentapi.AgentEvent{{Kind: agentapi.EventWithdraw, AskID: requestID}}
		}
	case "result":
		agentapi.LogClaudeWS.Info("claude result",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "is_error", event["is_error"])
		// stream-json input otherwise keeps the CLI waiting after its result.
		d.CloseStdin()
		return d.resultEvents(event)
	case "error":
		message := line
		if e, ok := event["error"].(map[string]any); ok {
			if m := protocol.AsString(e["message"]); m != "" {
				message = m
			}
		}
		return []agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: message}}
	}
	return nil
}

func (d *ClaudeDriver) systemEvent(event map[string]any) []agentapi.AgentEvent {
	sid := protocol.AsString(event["session_id"])
	if sid == "" {
		return nil
	}
	return []agentapi.AgentEvent{{Kind: agentapi.EventSession, SessionID: sid}}
}

// Preserve content order. With --include-partial-messages, assistant events
// announce each completed block once; stream_event carries partial growth.
// Do not deduplicate or diff against earlier blocks in the turn.
// The envelope UUID anchors --resume-session-at; only retained blocks move it.
func (d *ClaudeDriver) assistantEvents(event map[string]any) []agentapi.AgentEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)
	uuid := protocol.AsString(event["uuid"])

	events := make([]agentapi.AgentEvent, 0, len(content))
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		kind := blockKind(protocol.AsString(block["type"]))
		if kind == "" {
			continue
		}
		events = append(events, agentapi.AgentEvent{
			Kind: agentapi.EventBlock, Block: agentapi.ReadBlock(kind, block), MessageID: uuid,
		})
	}
	return events
}

func blockKind(cliType string) string {
	switch cliType {
	case "text":
		return agentapi.BlockKindText
	case "thinking", "redacted_thinking":
		return agentapi.BlockKindThinking
	case "tool_use":
		return agentapi.BlockKindToolUse
	}
	return ""
}

// Match user tool_result blocks to earlier assistant tool calls by tool_use_id.
func (d *ClaudeDriver) userEvents(event map[string]any) []agentapi.AgentEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)

	var events []agentapi.AgentEvent
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		if protocol.AsString(block["type"]) != "tool_result" {
			continue
		}
		id := protocol.AsString(block["tool_use_id"])
		if id == "" {
			continue
		}
		events = append(events, agentapi.AgentEvent{
			Kind: agentapi.EventToolResult, ToolUseID: id,
			ToolResult:  protocol.ResultSummary(block["content"]),
			ToolIsError: protocol.AsBool(block["is_error"]),
		})
	}
	return events
}

// Result usage is per-turn billing; report is_error even if the process exits successfully.
func (d *ClaudeDriver) resultEvents(event map[string]any) []agentapi.AgentEvent {
	var events []agentapi.AgentEvent
	if usage, ok := agentapi.ReadUsage(event["usage"], event["total_cost_usd"], agentapi.UsageScopeTurn); ok {
		events = append(events, agentapi.AgentEvent{Kind: agentapi.EventUsage, Usage: usage})
	}
	if protocol.AsBool(event["is_error"]) {
		events = append(events, agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: claudeResultError(event)})
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
func (d *ClaudeDriver) controlRequest(event map[string]any) []agentapi.AgentEvent {
	requestID := protocol.AsString(event["request_id"])
	if requestID == "" {
		agentapi.LogClaudeWS.Warn("control request without a request id", "conversation", d.run.Conversation)
		return nil
	}
	req, _ := event["request"].(map[string]any)
	subtype := protocol.AsString(req["subtype"])
	if subtype != "can_use_tool" {
		agentapi.LogClaudeWS.Info("control request refused",
			"conversation", d.run.Conversation, "subtype", subtype)
		_ = d.writeStdin(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype":    "error",
			"request_id": requestID,
			"error":      subtype + " is not supported by worker",
		}})
		return nil
	}

	ask := &agentapi.AgentAsk{
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
		ask.Questions, ask.QuestionKeys = agentapi.AskedQuestions(req["input"])
	}
	return []agentapi.AgentEvent{{Kind: agentapi.EventAsk, Ask: ask}}
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

// Idempotently close stdin: stream-json waits for more input after a result.
// Latch closure before attachment so a late pipe is also closed.
func (d *ClaudeDriver) CloseStdin() {
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed {
		return
	}
	d.stdinClosed = true
	if d.Stdin != nil {
		_ = d.Stdin.Close()
	}
}
