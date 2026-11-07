package codex

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	pkgEquipment "kiao/worker/internal/core/equipment"
	pkgProcess "kiao/worker/internal/core/process"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	pkgSkills "kiao/worker/internal/hybridflow-runner/skills"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
)

// codexAgent adapts `codex exec --json`: one process per turn, with JSONL events on stdout.
// The CLI has no approval or mid-turn input channel, so only bypassPermissions is supported;
// Answer and Say return errors.
type CodexAgent struct {
	cfg *runnerconfig.Config
	// Replaceable in tests to exercise spawn failures without a CLI.
	Binary string

	OptionsService *CodexOptionsService
	usage          *CodexUsageService
	Login          *CodexLoginService
}

const CodexBinaryName = "codex"

// Quota comes from the app server; exec reports only per-turn usage (codex_usage.go).
var (
	_ agentapi.Agent            = (*CodexAgent)(nil)
	_ agentapi.AgentOptions     = (*CodexAgent)(nil)
	_ agentapi.AgentUsage       = (*CodexAgent)(nil)
	_ agentapi.AgentMCP         = (*CodexAgent)(nil)
	_ agentapi.AgentAuth        = (*CodexAgent)(nil)
	_ agentapi.AgentDeviceLogin = (*CodexAgent)(nil)
	_ agentapi.AgentAPIKeyLogin = (*CodexAgent)(nil)
)

func NewCodexAgent(cfg *runnerconfig.Config) *CodexAgent {
	return &CodexAgent{
		cfg:            cfg,
		Binary:         CodexBinaryName,
		OptionsService: newCodexOptionsService(cfg),
		usage:          newCodexUsageService(),
		Login:          NewCodexLoginService(cfg),
	}
}

func (a *CodexAgent) Driver() agentapi.AgentDriver {
	return &CodexDriver{cfg: a.cfg, Binary: a.Binary, EventStream: make(chan agentapi.AgentEvent)}
}

func (a *CodexAgent) Options() agentapi.AgentOptionsDto { return a.OptionsService.Get() }

func (a *CodexAgent) Usage() (agentapi.AgentUsageDto, error) { return a.usage.GetUsage() }

func (a *CodexAgent) AuthStatus() (agentapi.AgentAuthStatusDto, error) { return a.Login.Status() }

func (a *CodexAgent) DeviceLoginEnabled() bool { return a.Login.Enabled }

func (a *CodexAgent) DeviceLoginStart() (string, string, error) { return a.Login.StartDevice() }

func (a *CodexAgent) DeviceLoginStatus() (bool, bool, string, error) { return a.Login.DeviceStatus() }

func (a *CodexAgent) DeviceLoginCancel() bool { return a.Login.CancelDevice() }

func (a *CodexAgent) DeviceLoginHostCommand() string { return "codex login --device-auth" }

func (a *CodexAgent) DeviceLoginShutdown() { a.Login.ShutdownDevice() }

func (a *CodexAgent) APIKeyLoginEnabled() bool { return a.Login.Enabled }

func (a *CodexAgent) SubmitAPIKey(key string) (bool, string, error) { return a.Login.submitKey(key) }

func (a *CodexAgent) APIKeyHostCommand() string { return "codex login --with-api-key" }

func (a *CodexAgent) RenderMCP(servers []pkgEquipment.MCPServer) (string, error) {
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

func (d *CodexDriver) runFor(run agentapi.AgentRun) codexRun {
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
	if !run.allowBypass || runnerconfig.AsksBeforeTools(run.permissionMode) {
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
		"-c", "developer_instructions="+tomlString(briefing.AgentBriefingWith(run.storeRoot, run.instructions)))
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
		args = append(args, "-c", "mcp_servers="+strings.ReplaceAll(table, equipment.MCPTokenPlaceholder, run.mcpToken))
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
type CodexDriver struct {
	cfg    *runnerconfig.Config
	Binary string
	run    agentapi.AgentRun

	// Unbuffered: hub delivery backpressures CLI reads.
	EventStream chan agentapi.AgentEvent

	mu sync.Mutex
	// stopped latches Stop before the supervisor is published, so an early
	// cancellation is not lost. Reaping is independent of protocol reads.
	Process *pkgProcess.SupervisedAgentProcess
	stopped bool

	// Keep stderr diagnostics for failures absent from the JSONL stream (login, config, MCP).
	errMu   sync.Mutex
	stderr  []string
	errDone chan struct{}
}

var _ agentapi.AgentDriver = (*CodexDriver)(nil)

const maxCodexStderrLines = 20

// Spawn must close stdin after the prompt: exec waits for EOF before starting the turn.
func (d *CodexDriver) Spawn(run agentapi.AgentRun) error {
	d.run = run
	args, err := codexArgs(d.runFor(run))
	if err != nil {
		return err
	}
	cmd := exec.Command(d.Binary, args...)
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

	process, err := pkgProcess.StartSupervisedAgent(cmd)
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
	d.Process = process
	d.errDone = make(chan struct{})
	if d.stopped {
		process.Stop()
	}
	d.mu.Unlock()

	_, writeErr := io.WriteString(stdin, run.Prompt)
	closeErr := stdin.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		// Kill and reap: no goroutine is draining the output pipes yet.
		d.Stop()
		<-process.Done
		outR.Close()
		errR.Close()
		return fmt.Errorf("The prompt could not be sent to Codex: %w", err)
	}

	agentapi.LogClaudeWS.Info("spawned",
		"agent", agentapi.AgentCodex, "conversation", run.Conversation, "turn", run.Turn,
		"pid", process.Pid, "supervisor_pid", process.Cmd.Process.Pid,
		"work_dir", run.WorkDir, "store_root", run.StoreRoot)
	run.Trace.Exec(d.execRecord(cmd))
	run.Trace.Note(fmt.Sprintf("agent process supervisor pid %d", process.Cmd.Process.Pid))
	// argv omits the stdin prompt, so record it as the first input frame.
	run.Trace.StreamLine(turntrace.TraceIn, run.Prompt)

	go d.readStderr(errR)
	go d.read(outR)
	return nil
}

// argv includes the MCP credential; the trace must scrub it centrally (codex_mcp.go).
func (d *CodexDriver) execRecord(cmd *exec.Cmd) turntrace.TraceExec {
	path, version := turntrace.BinaryVersion(d.Binary)
	skills := ""
	if root := pkgSkills.StoreRootOf(d.cfg); root != "" {
		skills = pkgSkills.StoreAgentsSkills(root)
	}
	return turntrace.TraceExec{
		Binary: d.Binary, Path: path, Version: version,
		Argv: cmd.Args, Env: turntrace.AddedEnv(cmd.Env), Dir: cmd.Dir, PID: d.Process.Pid,
		SkillsPath: skills, Skills: turntrace.InstalledSkills(skills),
	}
}

func notStartedCodex(err error) error {
	return fmt.Errorf("The Codex process could not be started: %w", err)
}

func (d *CodexDriver) Events() <-chan agentapi.AgentEvent { return d.EventStream }

// exec has no approval channel and never emits agentAsk.
func (d *CodexDriver) Answer(string, agentapi.AskDecision) error {
	return errors.New("Codex asks nothing, so there is nothing to answer")
}

// stdin closes after the prompt; exec has no mid-turn input channel.
func (d *CodexDriver) Say(string) error {
	return errors.New("Codex cannot be told anything mid-turn; wait for the reply and send it after")
}

// The reader emits agentDone only after the supervisor has reaped all descendants.
func (d *CodexDriver) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopped = true
	if d.Process != nil {
		agentapi.LogClaudeWS.Info("process stop requested",
			"agent", agentapi.AgentCodex, "conversation", d.run.Conversation, "turn", d.run.Turn,
			"pid", d.Process.Pid)
		d.Process.Stop()
	}
}

// stderr mixes progress and failures, so it must not emit agentFailure for every line.
func (d *CodexDriver) readStderr(errR *os.File) {
	defer close(d.errDone)
	defer errR.Close()
	scanner := bufio.NewScanner(errR)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		agentapi.LogClaudeWS.Debug("codex stderr",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "line", line)
		// Trace all stderr; the in-memory tail is only for the failure message.
		d.run.Trace.StderrLine(line)
		d.errMu.Lock()
		d.stderr = append(d.stderr, line)
		if len(d.stderr) > maxCodexStderrLines {
			d.stderr = d.stderr[len(d.stderr)-maxCodexStderrLines:]
		}
		d.errMu.Unlock()
	}
}

func (d *CodexDriver) lastStderr() string {
	d.errMu.Lock()
	defer d.errMu.Unlock()
	if len(d.stderr) == 0 {
		return ""
	}
	return d.stderr[len(d.stderr)-1]
}

// read emits exactly one agentDone with the process exit code.
func (d *CodexDriver) read(outR *os.File) {
	defer close(d.EventStream)
	reader := bufio.NewReader(outR)
	said := false
	for {
		line, err := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			// Trace lifecycle frames too; transcript blocks only retain item.completed.
			d.run.Trace.StreamLine(turntrace.TraceOut, trimmed)
			for _, event := range d.readEvent(trimmed) {
				if event.Kind == agentapi.EventFailure {
					said = true
				}
				d.EventStream <- event
			}
		}
		if err != nil {
			break
		}
	}
	outR.Close()

	// The supervisor reaps inherited pipe holders when the launcher exits.
	<-d.errDone
	<-d.Process.Done

	exitCode := d.Process.ExitCode
	if d.Process.Err != nil && !said {
		d.EventStream <- agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: d.Process.Err.Error()}
		said = true
	}
	// Use the last stderr diagnostic when a failed process emitted no protocol failure.
	if exitCode != 0 && !said {
		if last := d.lastStderr(); last != "" {
			d.EventStream <- agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: last}
		}
	}
	d.EventStream <- agentapi.AgentEvent{Kind: agentapi.EventDone, ExitCode: exitCode}
}

// Emit blocks only on item.completed: the port announces each block once, without revisions.
func (d *CodexDriver) readEvent(line string) []agentapi.AgentEvent {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		agentapi.LogClaudeWS.Warn("event parse failed",
			"agent", agentapi.AgentCodex, "conversation", d.run.Conversation, "error", err)
		return nil
	}
	switch protocol.AsString(event["type"]) {
	case "thread.started":
		// Persist the resume ID immediately; interrupted turns may never emit completion.
		if id := protocol.AsString(event["thread_id"]); id != "" {
			return []agentapi.AgentEvent{{Kind: agentapi.EventSession, SessionID: id}}
		}
	case "item.completed":
		item, _ := event["item"].(map[string]any)
		if block, ok := codexBlock(item); ok {
			// No MessageID: item IDs restart each turn, and exec cannot resume at an item.
			return []agentapi.AgentEvent{{Kind: agentapi.EventBlock, Block: block}}
		}
	case "turn.failed":
		if failure, ok := event["error"].(map[string]any); ok {
			if message := protocol.AsString(failure["message"]); message != "" {
				return []agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: message}}
			}
		}
		return []agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: "The Codex turn failed."}}
	case "error":
		// Reconnection errors may be nonfatal; only agentDone ends the turn.
		if message := protocol.AsString(event["message"]); message != "" {
			return []agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: message}}
		}
		return []agentapi.AgentEvent{{Kind: agentapi.EventFailure, Message: line}}
	case "turn.completed":
		// This event reports usage; process exit determines turn completion.
		if usage, ok := ReadCodexUsage(event["usage"], protocol.FirstOf(event, "cost", "total_cost_usd")); ok {
			return []agentapi.AgentEvent{{Kind: agentapi.EventUsage, Usage: usage}}
		}
	case "turn.started", "item.started", "item.updated":
	}
	return nil
}

func codexBlock(item map[string]any) (agentapi.TurnBlock, bool) {
	switch protocol.AsString(item["type"]) {
	case "agent_message":
		return agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: protocol.AsString(item["text"])}, true
	case "reasoning":
		// Keep empty reasoning blocks to preserve their position in the turn.
		return agentapi.TurnBlock{Kind: agentapi.BlockKindThinking, Text: protocol.AsString(item["text"])}, true
	case "command_execution":
		return codexToolBlock(item, "Shell", protocol.AsString(item["command"])), true
	case "file_change":
		return codexToolBlock(item, "ApplyPatch", codexChanges(item["changes"])), true
	case "mcp_tool_call":
		// Use the same MCP tool names as Claude so transcripts render consistently.
		name := "mcp__" + protocol.OrDefault(protocol.AsString(item["server"]), "server") +
			"__" + protocol.OrDefault(protocol.AsString(item["tool"]), "tool")
		return codexToolBlock(item, name, protocol.PermissionInputSummary(item["arguments"])), true
	case "web_search":
		return codexToolBlock(item, "WebSearch", protocol.AsString(item["query"])), true
	case "todo_list":
		return codexToolBlock(item, "TodoList", protocol.PermissionInputSummary(item["items"])), true
	}
	return agentapi.TurnBlock{}, false
}

func codexToolBlock(item map[string]any, name, detail string) agentapi.TurnBlock {
	block := agentapi.TurnBlock{
		Kind:      agentapi.BlockKindToolUse,
		Name:      name,
		Input:     agentapi.SummarizeToolInput(detail),
		Detail:    protocol.CutRunes(detail, protocol.MaxPermissionInputChars),
		ToolUseID: protocol.AsString(item["id"]),
	}
	if result, isError, exitCode, durationMs, ok := agentapi.ToolOutcome(item); ok {
		block.Result, block.IsError = result, isError
		block.ExitCode, block.DurationMs = exitCode, durationMs
	}
	return block
}

// Sort paths for deterministic rendering of identical patches.
func codexChanges(raw any) string {
	changes, ok := raw.(map[string]any)
	if !ok {
		return protocol.PermissionInputSummary(raw)
	}
	paths := make([]string, 0, len(changes))
	for path := range changes {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	lines := make([]string, 0, len(paths))
	for _, path := range paths {
		kind := protocol.AsString(changes[path])
		if nested, ok := changes[path].(map[string]any); ok {
			kind = protocol.AsString(nested["type"])
		}
		lines = append(lines, strings.TrimSpace(protocol.OrDefault(kind, "change")+" "+path))
	}
	return strings.Join(lines, "\n")
}
