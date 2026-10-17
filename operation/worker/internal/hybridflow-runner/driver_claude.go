package hybridflowrunner

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"kiao/worker/internal/core"
)

// Adapts the Claude CLI flags and stream-json control protocol to AgentDriver.
type claudeAgent struct {
	cfg *Config
	// Overridable to test spawn failures without an installed CLI.
	binary string

	options *ClaudeOptionsService
	usage   *ClaudeUsageService
	login   *ClaudeLoginService
}

var (
	_ Agent          = (*claudeAgent)(nil)
	_ AgentOptions   = (*claudeAgent)(nil)
	_ AgentUsage     = (*claudeAgent)(nil)
	_ AgentLogin     = (*claudeAgent)(nil)
	_ AgentMCP       = (*claudeAgent)(nil)
	_ AgentBranching = (*claudeAgent)(nil)
)

func newClaudeAgent(cfg *Config) *claudeAgent {
	return &claudeAgent{
		cfg:     cfg,
		binary:  claudeBinaryName,
		options: newClaudeOptionsService(cfg),
		usage:   newClaudeUsageService(cfg),
		login:   newClaudeLoginService(cfg),
	}
}

func (a *claudeAgent) Driver() AgentDriver {
	return &claudeDriver{cfg: a.cfg, binary: a.binary, events: make(chan AgentEvent)}
}

func (a *claudeAgent) Options() agentOptionsDto { return a.options.get() }

func (a *claudeAgent) Usage() (AgentUsageDto, error) { return a.usage.getUsage() }

// LoginEnabled gates login endpoints; auth status remains readable when disabled.
func (a *claudeAgent) LoginEnabled() bool                      { return a.login.enabled }
func (a *claudeAgent) AuthStatus() (AgentAuthStatusDto, error) { return a.login.status() }
func (a *claudeAgent) LoginStart() (string, error)             { return a.login.start() }
func (a *claudeAgent) LoginCancel() bool                       { return a.login.cancel() }
func (a *claudeAgent) LoginShutdown()                          { a.login.shutdown() }
func (a *claudeAgent) LoginCode(code string) (bool, string, error) {
	return a.login.submitCode(code)
}

// --fork-session resumes history under a new session ID.
func (a *claudeAgent) BranchesSessions() bool { return true }

func (a *claudeAgent) RenderMCP(servers []core.MCPServer) (string, error) {
	return writeMCPConfig(a.cfg, servers)
}

// claudeRun translates AgentRun into CLI arguments.
type claudeRun struct {
	model, effort, permissionMode, sessionID string
	instructions string
	// Branch from sessionID on the first turn of a forked conversation.
	forkSession bool
	// CLI message UUID where forked history ends; empty replays the whole session.
	resumeAt string
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
func (d *claudeDriver) runFor(run AgentRun) claudeRun {
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
		"--append-system-prompt", agentBriefingWith(run.storeRoot, run.instructions),
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
	if asksBeforeTools(run.permissionMode) || !run.allowBypass {
		return append(args, "--permission-mode", permissionModeManual)
	}
	return append(args, "--dangerously-skip-permissions")
}

// claudeDriver owns one process and is never reused.
type claudeDriver struct {
	cfg    *Config
	binary string
	run    AgentRun

	// Unbuffered to apply hub back-pressure to CLI reads.
	events chan AgentEvent

	// Flush partial stderr after reaping. Set before the reader starts; no lock needed.
	stderrOut *traceLineWriter

	mu  sync.Mutex
	cmd *exec.Cmd

	// Keep stdin open for permission answers and mid-turn messages; closing it ends the process.
	stdinMu     sync.Mutex
	stdin       io.WriteCloser
	stdinClosed bool
}

var _ AgentDriver = (*claudeDriver)(nil)

// Spawn leaves no pipes or child process behind on failure and produces no events.
func (d *claudeDriver) Spawn(run AgentRun) error {
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
		return notStarted(err)
	}
	d.attachStdin(stdin)
	pr, pw, err := os.Pipe()
	if err != nil {
		d.closeStdin()
		return notStarted(err)
	}
	cmd.Stdout = pw
	// Keep stderr out of the JSON stream. exec drains this writer and Wait joins it;
	// an unread pipe could block the child.
	if stderrOut := run.Trace.stderrWriter(); stderrOut != nil {
		d.stderrOut = stderrOut
		cmd.Stderr = stderrOut
	}

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		d.closeStdin()
		return notStarted(err)
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
		d.closeStdin()
		pr.Close()
		return fmt.Errorf("The prompt could not be sent to Claude: %w", err)
	}

	logClaudeWS.Info("spawned",
		"conversation", run.Conversation, "turn", run.Turn, "pid", cmd.Process.Pid,
		"work_dir", run.WorkDir, "store_root", run.StoreRoot)
	run.Trace.exec(d.execRecord(cmd))

	go d.read(pr)
	return nil
}

// Trace full argv (including the system prompt) but only added environment variables.
// The trace scrubs KIAO_MCP_TURN_TOKEN.
func (d *claudeDriver) execRecord(cmd *exec.Cmd) traceExec {
	path, version := binaryVersion(d.binary)
	skills := ""
	if root := storeRootOf(d.cfg); root != "" {
		skills = storeClaudeSkills(root)
	}
	return traceExec{
		Binary: d.binary, Path: path, Version: version,
		Argv: cmd.Args, Env: addedEnv(cmd.Env), Dir: cmd.Dir, PID: cmd.Process.Pid,
		SkillsPath: skills, Skills: installedSkills(skills),
	}
}

func notStarted(err error) error {
	return fmt.Errorf("The Claude process could not be started: %w", err)
}

func (d *claudeDriver) Events() <-chan AgentEvent { return d.events }

// Allow responses must carry schema-valid tool input, never the displayed summary.
func (d *claudeDriver) Answer(askID string, decision AskDecision) error {
	var response map[string]any
	if decision.Allow {
		response = map[string]any{"behavior": "allow", "updatedInput": orEmptyInput(decision.Input)}
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
func (d *claudeDriver) Say(text string) error {
	return d.writeStdin(map[string]any{
		"type":    "user",
		"message": map[string]any{"role": "user", "content": text},
	})
}

// The reader emits agentDone after the killed process closes stdout.
func (d *claudeDriver) Stop() {
	d.mu.Lock()
	cmd := d.cmd
	d.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		logClaudeWS.Info("process killed",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
	d.closeStdin()
}

// read drains stdout and emits exactly one agentDone with the exit code.
func (d *claudeDriver) read(pr *os.File) {
	defer close(d.events)
	reader := bufio.NewReader(pr)
	for {
		line, err := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			// Trace raw frames before translation drops unhandled content.
			d.run.Trace.streamLine(traceOut, trimmed)
			for _, event := range d.readEvent(trimmed) {
				d.events <- event
			}
		}
		if err != nil {
			break
		}
	}
	pr.Close()

	// Unblock Wait even if a crash ended stdout without a result frame.
	d.closeStdin()

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
	d.stderrOut.flush()
	d.events <- AgentEvent{Kind: agentDone, ExitCode: exitCode}
}

func (d *claudeDriver) readEvent(line string) []AgentEvent {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		logClaudeWS.Warn("event parse failed", "conversation", d.run.Conversation, "error", err)
		return nil
	}
	switch asString(event["type"]) {
	case "system":
		return d.systemEvent(event)
	case "assistant":
		return d.assistantEvents(event)
	case "user":
		return d.userEvents(event)
	case "control_request":
		return d.controlRequest(event)
	case "control_cancel_request":
		if requestID := asString(event["request_id"]); requestID != "" {
			return []AgentEvent{{Kind: agentWithdraw, AskID: requestID}}
		}
	case "result":
		logClaudeWS.Info("claude result",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "is_error", event["is_error"])
		// stream-json input otherwise keeps the CLI waiting after its result.
		d.closeStdin()
		return d.resultEvents(event)
	case "error":
		message := line
		if e, ok := event["error"].(map[string]any); ok {
			if m := asString(e["message"]); m != "" {
				message = m
			}
		}
		return []AgentEvent{{Kind: agentFailure, Message: message}}
	}
	return nil
}

func (d *claudeDriver) systemEvent(event map[string]any) []AgentEvent {
	sid := asString(event["session_id"])
	if sid == "" {
		return nil
	}
	return []AgentEvent{{Kind: agentSession, SessionID: sid}}
}

// Preserve content order. With --include-partial-messages, assistant events
// announce each completed block once; stream_event carries partial growth.
// Do not deduplicate or diff against earlier blocks in the turn.
// The envelope UUID anchors --resume-session-at; only retained blocks move it.
func (d *claudeDriver) assistantEvents(event map[string]any) []AgentEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)
	uuid := asString(event["uuid"])

	events := make([]AgentEvent, 0, len(content))
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		kind := blockKind(asString(block["type"]))
		if kind == "" {
			continue
		}
		events = append(events, AgentEvent{
			Kind: agentBlock, Block: readBlock(kind, block), MessageID: uuid,
		})
	}
	return events
}

func blockKind(cliType string) string {
	switch cliType {
	case "text":
		return blockKindText
	case "thinking", "redacted_thinking":
		return blockKindThinking
	case "tool_use":
		return blockKindToolUse
	}
	return ""
}

// Match user tool_result blocks to earlier assistant tool calls by tool_use_id.
func (d *claudeDriver) userEvents(event map[string]any) []AgentEvent {
	message, _ := event["message"].(map[string]any)
	content, _ := message["content"].([]any)

	var events []AgentEvent
	for _, blockAny := range content {
		block, _ := blockAny.(map[string]any)
		if asString(block["type"]) != "tool_result" {
			continue
		}
		id := asString(block["tool_use_id"])
		if id == "" {
			continue
		}
		events = append(events, AgentEvent{
			Kind: agentToolResult, ToolUseID: id,
			ToolResult:  resultSummary(block["content"]),
			ToolIsError: asBool(block["is_error"]),
		})
	}
	return events
}

// Result usage is per-turn billing; report is_error even if the process exits successfully.
func (d *claudeDriver) resultEvents(event map[string]any) []AgentEvent {
	var events []AgentEvent
	if usage, ok := readUsage(event["usage"], event["total_cost_usd"], usageScopeTurn); ok {
		events = append(events, AgentEvent{Kind: agentUsage, Usage: usage})
	}
	if asBool(event["is_error"]) {
		events = append(events, AgentEvent{Kind: agentFailure, Message: claudeResultError(event)})
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
				if m := asString(e["message"]); m != "" {
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
	if subtype := asString(event["subtype"]); subtype != "" {
		return "Claude reported the turn as failed (" + subtype + ")."
	}
	return "Claude reported the turn as failed."
}

func readBlock(kind string, block map[string]any) turnBlock {
	if kind == blockKindToolUse {
		// Keep a short chip label and a detailed audit view; toolUseID joins the later result.
		return turnBlock{
			kind:      kind,
			name:      orDefault(asString(block["name"]), "tool"),
			input:     summarizeToolInput(block["input"]),
			detail:    permissionInputSummary(block["input"]),
			toolUseID: asString(block["id"]),
		}
	}
	// Retain redacted thinking as an empty block to record where reasoning occurred.
	text := asString(block["text"])
	if kind == blockKindThinking {
		text = orDefault(asString(block["thinking"]), text)
	}
	return turnBlock{kind: kind, text: text}
}

func summarizeToolInput(input any) string {
	if input == nil {
		return ""
	}
	var raw string
	if s, ok := input.(string); ok {
		raw = s
	} else {
		b, _ := json.Marshal(input)
		raw = string(b)
	}
	if len(raw) > 80 {
		return raw[:80] + "…"
	}
	return raw
}

// Permission previews need more context than the 80-character tool label.
const maxPermissionInputChars = 4000

// AskUserQuestion uses can_use_tool and receives answers through updatedInput.
// Treat it as a question, never a permission: bypass and manualLive auto-approval
// must not answer on the user's behalf.
const claudeAskQuestionTool = "AskUserQuestion"

// Bound untrusted CLI input for the sidebar, tolerating larger asks than the CLI schema.
const (
	maxQuestions       = 8
	maxQuestionOptions = 12
	maxQuestionChars   = 2000
)

// Unanswered control requests park the CLI, so unsupported subtypes must be refused.
func (d *claudeDriver) controlRequest(event map[string]any) []AgentEvent {
	requestID := asString(event["request_id"])
	if requestID == "" {
		logClaudeWS.Warn("control request without a request id", "conversation", d.run.Conversation)
		return nil
	}
	req, _ := event["request"].(map[string]any)
	subtype := asString(req["subtype"])
	if subtype != "can_use_tool" {
		logClaudeWS.Info("control request refused",
			"conversation", d.run.Conversation, "subtype", subtype)
		_ = d.writeStdin(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype":    "error",
			"request_id": requestID,
			"error":      subtype + " is not supported by worker",
		}})
		return nil
	}

	ask := &AgentAsk{
		ID:           requestID,
		Tool:         orDefault(asString(req["tool_name"]), "tool"),
		DisplayName:  asString(req["display_name"]),
		Description:  asString(req["description"]),
		ToolUseID:    asString(req["tool_use_id"]),
		Input:        req["input"],
		InputSummary: permissionInputSummary(req["input"]),
	}
	// Match the tool name, not input shape: other tools cannot accept an answers map.
	if asString(req["tool_name"]) == claudeAskQuestionTool {
		ask.Questions, ask.QuestionKeys = askedQuestions(req["input"])
	}
	return []AgentEvent{{Kind: agentAsk, Ask: ask}}
}

// Malformed questions fall back to a permission card showing raw input so the user
// can still unblock the turn.
func askedQuestions(input any) (questions []map[string]any, keys []string) {
	asked, _ := input.(map[string]any)
	raw, _ := asked["questions"].([]any)
	if len(raw) == 0 {
		return nil, nil
	}
	for _, entry := range raw {
		if len(questions) == maxQuestions {
			break
		}
		asked, _ := entry.(map[string]any)
		key := asString(asked["question"])
		if key == "" {
			// Reject the whole question list; dropping an entry could misalign later answers.
			return nil, nil
		}
		question := map[string]any{
			"question": cutRunes(key, maxQuestionChars),
			"options":  askedOptions(asked["options"]),
		}
		if header := cutRunes(asString(asked["header"]), maxQuestionChars); header != "" {
			question["header"] = header
		}
		if multi, ok := asked["multiSelect"].(bool); ok && multi {
			question["multiSelect"] = true
		}
		questions = append(questions, question)
		keys = append(keys, key)
	}
	return questions, keys
}

// No options still permits a free-text answer, equivalent to the CLI's Other choice.
func askedOptions(raw any) []map[string]any {
	entries, _ := raw.([]any)
	options := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if len(options) == maxQuestionOptions {
			break
		}
		asked, _ := entry.(map[string]any)
		label := cutRunes(asString(asked["label"]), maxQuestionChars)
		if label == "" {
			continue
		}
		option := map[string]any{"label": label}
		if description := cutRunes(asString(asked["description"]), maxQuestionChars); description != "" {
			option["description"] = description
		}
		// Previews need the larger permission-input limit to show the choice being offered.
		if preview := cutRunes(asString(asked["preview"]), maxPermissionInputChars); preview != "" {
			option["preview"] = preview
		}
		options = append(options, option)
	}
	return options
}

// The CLI requires an object, not null, for tool input on allow.
func orEmptyInput(input any) any {
	if input == nil {
		return map[string]any{}
	}
	return input
}

func permissionInputSummary(input any) string {
	if input == nil {
		return ""
	}
	raw, ok := input.(string)
	if !ok {
		b, err := json.MarshalIndent(input, "", "  ")
		if err != nil {
			return ""
		}
		raw = string(b)
	}
	return cutRunes(raw, maxPermissionInputChars)
}

func cutRunes(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max]) + "…"
}

func resultSummary(output any) string {
	switch out := output.(type) {
	case nil:
		return ""
	case string:
		return cutRunes(out, maxBlockResultChars)
	case []any:
		var parts []string
		for _, entry := range out {
			switch e := entry.(type) {
			case string:
				parts = append(parts, e)
			case map[string]any:
				if text := asString(e["text"]); text != "" {
					parts = append(parts, text)
				} else if data, err := json.Marshal(e); err == nil {
					parts = append(parts, string(data))
				}
			}
		}
		return cutRunes(strings.Join(parts, "\n"), maxBlockResultChars)
	default:
		raw, err := json.MarshalIndent(output, "", "  ")
		if err != nil {
			return ""
		}
		return cutRunes(string(raw), maxBlockResultChars)
	}
}

// Normalize agent usage and cost spellings. Missing, unreadable or all-zero
// reports mean unknown, not free.
func readUsage(raw, cost any, scope string) (*turnUsage, bool) {
	usage, _ := raw.(map[string]any)
	report := &turnUsage{Scope: scope}
	found := false
	set := func(field *int64, keys ...string) {
		if tokens, ok := asInt64(firstOf(usage, keys...)); ok {
			*field = tokens
			found = found || tokens != 0
		}
	}
	set(&report.InputTokens, "input_tokens", "inputTokens", "totalInputTokens", "prompt_tokens")
	set(&report.OutputTokens, "output_tokens", "outputTokens", "totalOutputTokens", "completion_tokens")
	set(&report.CacheReadTokens, "cache_read_input_tokens", "cacheReadTokens", "cachedInputTokens", "cached_tokens", "cachedTokens")
	set(&report.CacheWriteTokens, "cache_creation_input_tokens", "cacheCreationTokens", "cache_write_tokens", "cacheWriteTokens")
	if amount, ok := asFloat(cost); ok && amount != 0 {
		report.TotalCostUSD, found = amount, true
	} else if amount, ok := asFloat(firstOf(usage, "cost", "costUSD", "total_cost_usd")); ok && amount != 0 {
		report.TotalCostUSD, found = amount, true
	}
	if !found {
		return nil, false
	}
	return report, true
}

// Accept field names used by different agents and CLI versions.
func firstOf(report map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := report[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

// Read output and outcome from completed items used by the other drivers.
func toolOutcome(item map[string]any) (result string, isError bool, exitCode *int, durationMs int64, ok bool) {
	if output := firstOf(item, "output", "aggregated_output", "result", "response", "results", "visibleOutput"); output != nil {
		if rendered := resultSummary(output); rendered != "" {
			result, ok = rendered, true
		}
	}
	if asBool(item["is_error"]) || asBool(item["isError"]) {
		isError, ok = true, true
	}
	if raw := firstOf(item, "error", "errorMessage", "failureReason"); raw != nil {
		if rendered := resultSummary(raw); rendered != "" {
			switch {
			case result == "":
				result = rendered
			case !strings.Contains(result, rendered):
				// Retain the failure reason alongside output unless already present verbatim.
				result += "\n" + rendered
			}
			isError, ok = true, true
		} else {
			isError, ok = true, true
		}
	}
	switch status := asString(firstOf(item, "status", "state")); status {
	case "failed", "error", "denied", "cancelled":
		isError, ok = true, true
	}
	if code, found := asInt64(firstOf(item, "exit_code", "exitCode")); found {
		code := int(code)
		exitCode, ok = &code, true
		if code != 0 {
			isError = true
		}
	}
	if measured, found := asInt64(firstOf(item, "duration_ms", "durationMs")); found && measured > 0 {
		durationMs, ok = measured, true
	}
	return result, isError, exitCode, durationMs, ok
}

func asBool(v any) bool {
	flag, _ := v.(bool)
	return flag
}

func asInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case float32:
		return int64(n), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	case int32:
		return int64(n), true
	case json.Number:
		if parsed, err := n.Int64(); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		if parsed, err := n.Float64(); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

var errClaudeStdinClosed = errors.New("claude stdin is closed")

// Stop latches even before attachment; close a late pipe rather than adopting it.
func (d *claudeDriver) attachStdin(stdin io.WriteCloser) {
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed {
		_ = stdin.Close()
		return
	}
	d.stdin = stdin
}

// Serialize newline-delimited JSON frames shared by prompts, answers and mid-turn messages.
func (d *claudeDriver) writeStdin(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	d.run.Trace.streamLine(traceIn, string(data))
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed || d.stdin == nil {
		return errClaudeStdinClosed
	}
	_, err = d.stdin.Write(append(data, '\n'))
	return err
}

// Idempotently close stdin: stream-json waits for more input after a result.
// Latch closure before attachment so a late pipe is also closed.
func (d *claudeDriver) closeStdin() {
	d.stdinMu.Lock()
	defer d.stdinMu.Unlock()
	if d.stdinClosed {
		return
	}
	d.stdinClosed = true
	if d.stdin != nil {
		_ = d.stdin.Close()
	}
}
