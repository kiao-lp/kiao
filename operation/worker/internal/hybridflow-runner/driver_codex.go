package hybridflowrunner

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"

	"kiao/worker/internal/core"
)

// codexAgent adapts `codex exec --json`: one process per turn, with JSONL events on stdout.
// The CLI has no approval or mid-turn input channel, so only bypassPermissions is supported;
// Answer and Say return errors.
type codexAgent struct {
	cfg *Config
	// Replaceable in tests to exercise spawn failures without a CLI.
	binary string

	options *CodexOptionsService
	usage   *CodexUsageService
}

const codexBinaryName = "codex"

// Quota comes from the app server; exec reports only per-turn usage (codex_usage.go).
var (
	_ Agent        = (*codexAgent)(nil)
	_ AgentOptions = (*codexAgent)(nil)
	_ AgentUsage   = (*codexAgent)(nil)
	_ AgentMCP     = (*codexAgent)(nil)
)

func newCodexAgent(cfg *Config) *codexAgent {
	return &codexAgent{
		cfg:     cfg,
		binary:  codexBinaryName,
		options: newCodexOptionsService(cfg),
		usage:   newCodexUsageService(),
	}
}

func (a *codexAgent) Driver() AgentDriver {
	return &codexDriver{cfg: a.cfg, binary: a.binary, events: make(chan AgentEvent)}
}

func (a *codexAgent) Options() agentOptionsDto { return a.options.get() }

func (a *codexAgent) Usage() (AgentUsageDto, error) { return a.usage.getUsage() }

func (a *codexAgent) RenderMCP(servers []core.MCPServer) (string, error) {
	return buildCodexMCPConfig(servers), nil
}

type codexRun struct {
	model, effort, permissionMode, sessionID string
	instructions                             string
	// False suppresses reasoning summaries, not model reasoning.
	thinking bool
	// Absolute store root, conveyed through the briefing rather than --add-dir.
	storeRoot string
	// Rendered mcp_servers table; credentials still use ${KIAO_MCP_TURN_TOKEN}.
	mcpConfig        string
	mcpToken         string
	ignoreUserConfig bool
	// Deployment permission, checked again at flag construction so new callers fail closed.
	allowBypass bool
}

func (d *codexDriver) runFor(run AgentRun) codexRun {
	ignoreUserConfig := false
	if d.cfg != nil {
		ignoreUserConfig = d.cfg.CodexIgnoreUserConfig
	}
	return codexRun{
		model:            run.Model,
		effort:           run.Effort,
		permissionMode:   run.PermissionMode,
		instructions:     run.Instructions,
		sessionID:        run.SessionID,
		thinking:         run.Thinking,
		storeRoot:        run.StoreRoot,
		mcpConfig:        run.MCPConfig,
		mcpToken:         run.MCPToken,
		ignoreUserConfig: ignoreUserConfig,
		allowBypass:      run.AllowBypass,
	}
}

// Fail closed if a caller bypassed the permission-mode gate.
var errCodexNeedsBypass = errors.New(
	"Codex runs turns unsupervised or not at all, and this service does not allow it.")

// codexArgs uses stdin for the prompt to avoid exposing it through ps or hitting argv limits.
// Resume has a narrower flag set; all flags here must work after `exec resume`.
// Use the process working directory because resume lacks --cd. Omit --add-dir because
// bypass mode disables the sandbox; the briefing conveys the store root.
func codexArgs(run codexRun) ([]string, error) {
	if !run.allowBypass || asksBeforeTools(run.permissionMode) {
		return nil, errCodexNeedsBypass
	}

	args := []string{"exec"}
	if session := strings.TrimSpace(run.sessionID); session != "" {
		args = append(args, "resume")
	}
	args = append(args,
		"--json",
		// DCMS serves arbitrary folders, including those outside git repositories.
		"--skip-git-repo-check",
		"--dangerously-bypass-approvals-and-sandbox",
		// developer_instructions adds to the model instructions; model_instructions_file replaces them.
		"-c", "developer_instructions="+tomlString(agentBriefingWith(run.storeRoot, run.instructions)))
	if model := strings.TrimSpace(run.model); model != "" {
		// The worker encodes the service tier as model@tier; the CLI takes separate values.
		if slug, tier, ok := strings.Cut(model, "@"); ok && slug != "" && tier != "" {
			model = slug
			args = append(args, "-c", "service_tier="+tomlString(tier))
			if tier == "fast" || tier == "priority" {
				args = append(args, "-c", "features.fast_mode=true")
			}
		}
		args = append(args, "-m", model)
	}
	if effort := strings.TrimSpace(run.effort); effort != "" {
		args = append(args, "-c", "model_reasoning_effort="+tomlString(effort))
	}
	if !run.thinking {
		args = append(args, "-c", `model_reasoning_summary="none"`)
	}
	if table := strings.TrimSpace(run.mcpConfig); table != "" {
		// Credential substitution and its exposure tradeoff are documented in codex_mcp.go.
		args = append(args, "-c", "mcp_servers="+strings.ReplaceAll(table, codexMCPPlaceholder, run.mcpToken))
		if run.ignoreUserConfig {
			// --ignore-user-config removes all user configuration, including providers and model
			// catalogues, not just MCP servers. Opt in only when the deployment owns CODEX_HOME.
			args = append(args, "--ignore-user-config")
		}
	}
	if session := strings.TrimSpace(run.sessionID); session != "" {
		args = append(args, session)
	}
	return append(args, "-"), nil
}

// codexDriver owns one supervised process tree and is never reused.
type codexDriver struct {
	cfg    *Config
	binary string
	run    AgentRun

	// Unbuffered: hub delivery backpressures CLI reads.
	events chan AgentEvent

	mu sync.Mutex
	// stopped latches Stop before the supervisor is published, so an early
	// cancellation is not lost. Reaping is independent of protocol reads.
	process *supervisedAgentProcess
	stopped bool

	// Keep stderr diagnostics for failures absent from the JSONL stream (login, config, MCP).
	errMu   sync.Mutex
	stderr  []string
	errDone chan struct{}
}

var _ AgentDriver = (*codexDriver)(nil)

const maxCodexStderrLines = 20

// Spawn must close stdin after the prompt: exec waits for EOF before starting the turn.
func (d *codexDriver) Spawn(run AgentRun) error {
	d.run = run
	args, err := codexArgs(d.runFor(run))
	if err != nil {
		return err
	}
	cmd := exec.Command(d.binary, args...)
	// WorkDir is absolute and symlink-resolved to prevent escaping the store via a symlink.
	cmd.Dir = run.WorkDir
	cmd.Env = os.Environ()

	stdinR, stdin, err := os.Pipe()
	if err != nil {
		return notStartedCodex(err)
	}
	defer stdinR.Close()
	cmd.Stdin = stdinR
	// Keep prose stderr separate from JSONL stdout to avoid malformed protocol events.
	outR, outW, err := os.Pipe()
	if err != nil {
		stdin.Close()
		return notStartedCodex(err)
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		stdin.Close()
		outR.Close()
		outW.Close()
		return notStartedCodex(err)
	}
	cmd.Stdout = outW
	cmd.Stderr = errW

	process, err := startSupervisedAgent(cmd)
	if err != nil {
		stdin.Close()
		outW.Close()
		outR.Close()
		errW.Close()
		errR.Close()
		return notStartedCodex(err)
	}
	stdinR.Close() // only the supervised launcher retains the prompt's read end
	outW.Close()   // parent drops its write ends; the child keeps its dups
	errW.Close()

	d.mu.Lock()
	d.process = process
	d.errDone = make(chan struct{})
	if d.stopped {
		process.stop()
	}
	d.mu.Unlock()

	_, writeErr := io.WriteString(stdin, run.Prompt)
	closeErr := stdin.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		// Kill and reap: no goroutine is draining the output pipes yet.
		d.Stop()
		<-process.done
		outR.Close()
		errR.Close()
		return fmt.Errorf("The prompt could not be sent to Codex: %w", err)
	}

	logClaudeWS.Info("spawned",
		"agent", agentCodex, "conversation", run.Conversation, "turn", run.Turn,
		"pid", process.pid, "supervisor_pid", process.cmd.Process.Pid,
		"work_dir", run.WorkDir, "store_root", run.StoreRoot)
	run.Trace.exec(d.execRecord(cmd))
	run.Trace.note(fmt.Sprintf("agent process supervisor pid %d", process.cmd.Process.Pid))
	// argv omits the stdin prompt, so record it as the first input frame.
	run.Trace.streamLine(traceIn, run.Prompt)

	go d.readStderr(errR)
	go d.read(outR)
	return nil
}

// argv includes the MCP credential; the trace must scrub it centrally (codex_mcp.go).
func (d *codexDriver) execRecord(cmd *exec.Cmd) traceExec {
	path, version := binaryVersion(d.binary)
	skills := ""
	if root := storeRootOf(d.cfg); root != "" {
		skills = storeAgentsSkills(root)
	}
	return traceExec{
		Binary: d.binary, Path: path, Version: version,
		Argv: cmd.Args, Env: addedEnv(cmd.Env), Dir: cmd.Dir, PID: d.process.pid,
		SkillsPath: skills, Skills: installedSkills(skills),
	}
}

func notStartedCodex(err error) error {
	return fmt.Errorf("The Codex process could not be started: %w", err)
}

func (d *codexDriver) Events() <-chan AgentEvent { return d.events }

// exec has no approval channel and never emits agentAsk.
func (d *codexDriver) Answer(string, AskDecision) error {
	return errors.New("Codex asks nothing, so there is nothing to answer")
}

// stdin closes after the prompt; exec has no mid-turn input channel.
func (d *codexDriver) Say(string) error {
	return errors.New("Codex cannot be told anything mid-turn; wait for the reply and send it after")
}

// The reader emits agentDone only after the supervisor has reaped all descendants.
func (d *codexDriver) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopped = true
	if d.process != nil {
		logClaudeWS.Info("process stop requested",
			"agent", agentCodex, "conversation", d.run.Conversation, "turn", d.run.Turn,
			"pid", d.process.pid)
		d.process.stop()
	}
}

// stderr mixes progress and failures, so it must not emit agentFailure for every line.
func (d *codexDriver) readStderr(errR *os.File) {
	defer close(d.errDone)
	defer errR.Close()
	scanner := bufio.NewScanner(errR)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		logClaudeWS.Debug("codex stderr",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "line", line)
		// Trace all stderr; the in-memory tail is only for the failure message.
		d.run.Trace.stderrLine(line)
		d.errMu.Lock()
		d.stderr = append(d.stderr, line)
		if len(d.stderr) > maxCodexStderrLines {
			d.stderr = d.stderr[len(d.stderr)-maxCodexStderrLines:]
		}
		d.errMu.Unlock()
	}
}

func (d *codexDriver) lastStderr() string {
	d.errMu.Lock()
	defer d.errMu.Unlock()
	if len(d.stderr) == 0 {
		return ""
	}
	return d.stderr[len(d.stderr)-1]
}

// read emits exactly one agentDone with the process exit code.
func (d *codexDriver) read(outR *os.File) {
	defer close(d.events)
	reader := bufio.NewReader(outR)
	said := false
	for {
		line, err := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			// Trace lifecycle frames too; transcript blocks only retain item.completed.
			d.run.Trace.streamLine(traceOut, trimmed)
			for _, event := range d.readEvent(trimmed) {
				if event.Kind == agentFailure {
					said = true
				}
				d.events <- event
			}
		}
		if err != nil {
			break
		}
	}
	outR.Close()

	// The supervisor reaps inherited pipe holders when the launcher exits.
	<-d.errDone
	<-d.process.done

	exitCode := d.process.exitCode
	if d.process.err != nil && !said {
		d.events <- AgentEvent{Kind: agentFailure, Message: d.process.err.Error()}
		said = true
	}
	// Use the last stderr diagnostic when a failed process emitted no protocol failure.
	if exitCode != 0 && !said {
		if last := d.lastStderr(); last != "" {
			d.events <- AgentEvent{Kind: agentFailure, Message: last}
		}
	}
	d.events <- AgentEvent{Kind: agentDone, ExitCode: exitCode}
}

// Emit blocks only on item.completed: the port announces each block once, without revisions.
func (d *codexDriver) readEvent(line string) []AgentEvent {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		logClaudeWS.Warn("event parse failed",
			"agent", agentCodex, "conversation", d.run.Conversation, "error", err)
		return nil
	}
	switch asString(event["type"]) {
	case "thread.started":
		// Persist the resume ID immediately; interrupted turns may never emit completion.
		if id := asString(event["thread_id"]); id != "" {
			return []AgentEvent{{Kind: agentSession, SessionID: id}}
		}
	case "item.completed":
		item, _ := event["item"].(map[string]any)
		if block, ok := codexBlock(item); ok {
			// No MessageID: item IDs restart each turn, and exec cannot resume at an item.
			return []AgentEvent{{Kind: agentBlock, Block: block}}
		}
	case "turn.failed":
		if failure, ok := event["error"].(map[string]any); ok {
			if message := asString(failure["message"]); message != "" {
				return []AgentEvent{{Kind: agentFailure, Message: message}}
			}
		}
		return []AgentEvent{{Kind: agentFailure, Message: "The Codex turn failed."}}
	case "error":
		// Reconnection errors may be nonfatal; only agentDone ends the turn.
		if message := asString(event["message"]); message != "" {
			return []AgentEvent{{Kind: agentFailure, Message: message}}
		}
		return []AgentEvent{{Kind: agentFailure, Message: line}}
	case "turn.completed":
		// This event reports usage; process exit determines turn completion.
		if usage, ok := readCodexUsage(event["usage"], firstOf(event, "cost", "total_cost_usd")); ok {
			return []AgentEvent{{Kind: agentUsage, Usage: usage}}
		}
	case "turn.started", "item.started", "item.updated":
	}
	return nil
}

func codexBlock(item map[string]any) (turnBlock, bool) {
	switch asString(item["type"]) {
	case "agent_message":
		return turnBlock{kind: blockKindText, text: asString(item["text"])}, true
	case "reasoning":
		// Keep empty reasoning blocks to preserve their position in the turn.
		return turnBlock{kind: blockKindThinking, text: asString(item["text"])}, true
	case "command_execution":
		return codexToolBlock(item, "Shell", asString(item["command"])), true
	case "file_change":
		return codexToolBlock(item, "ApplyPatch", codexChanges(item["changes"])), true
	case "mcp_tool_call":
		// Use the same MCP tool names as Claude so transcripts render consistently.
		name := "mcp__" + orDefault(asString(item["server"]), "server") +
			"__" + orDefault(asString(item["tool"]), "tool")
		return codexToolBlock(item, name, permissionInputSummary(item["arguments"])), true
	case "web_search":
		return codexToolBlock(item, "WebSearch", asString(item["query"])), true
	case "todo_list":
		return codexToolBlock(item, "TodoList", permissionInputSummary(item["items"])), true
	}
	return turnBlock{}, false
}

func codexToolBlock(item map[string]any, name, detail string) turnBlock {
	block := turnBlock{
		kind:      blockKindToolUse,
		name:      name,
		input:     summarizeToolInput(detail),
		detail:    cutRunes(detail, maxPermissionInputChars),
		toolUseID: asString(item["id"]),
	}
	if result, isError, exitCode, durationMs, ok := toolOutcome(item); ok {
		block.result, block.isError = result, isError
		block.exitCode, block.durationMs = exitCode, durationMs
	}
	return block
}

// Sort paths for deterministic rendering of identical patches.
func codexChanges(raw any) string {
	changes, ok := raw.(map[string]any)
	if !ok {
		return permissionInputSummary(raw)
	}
	paths := make([]string, 0, len(changes))
	for path := range changes {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	lines := make([]string, 0, len(paths))
	for _, path := range paths {
		kind := asString(changes[path])
		if nested, ok := changes[path].(map[string]any); ok {
			kind = asString(nested["type"])
		}
		lines = append(lines, strings.TrimSpace(orDefault(kind, "change")+" "+path))
	}
	return strings.Join(lines, "\n")
}
