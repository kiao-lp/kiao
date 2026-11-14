package opencode

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

// opencodeAgent runs one `opencode run --format json` process per turn.
// Resume uses --session; --fork copies the whole session without a message cut point.
// The CLI has no approval channel or mid-turn input, so only bypassPermissions is
// supported. Provider credentials belong to the host; no sign-in flow is exposed.
// Stats report historical cost, not provider rate limits, so no quota probe is exposed.
type OpencodeHarness struct {
	Cfg *runnerconfig.Config
	// binary is overridable to test spawn failures without an installed CLI.
	Binary string

	OptionsService *OpenCodeOptionsService
}

const OpencodeBinaryName = "opencode"

var (
	_ harnessapi.Harness          = (*OpencodeHarness)(nil)
	_ harnessapi.HarnessOptions   = (*OpencodeHarness)(nil)
	_ harnessapi.HarnessMCP       = (*OpencodeHarness)(nil)
	_ harnessapi.HarnessBranching = (*OpencodeHarness)(nil)
)

func NewOpenCodeHarness(cfg *runnerconfig.Config) *OpencodeHarness {
	return &OpencodeHarness{
		Cfg:            cfg,
		Binary:         OpencodeBinaryName,
		OptionsService: NewOpenCodeOptionsService(cfg),
	}
}

func (a *OpencodeHarness) Driver() harnessapi.HarnessDriver {
	return &opencodeDriver{cfg: a.Cfg, binary: a.Binary, events: make(chan harnessapi.HarnessEvent)}
}

func (a *OpencodeHarness) Options() harnessapi.HarnessOptionsDto { return a.OptionsService.Get() }

func (a *OpencodeHarness) RenderMCP(servers []equipment.MCPServer) (string, error) {
	return buildOpenCodeMCPConfig(servers), nil
}

func (a *OpencodeHarness) BranchesSessions() bool { return true }

type opencodeRun struct {
	model, effort, permissionMode, sessionID string
	instructions                             string
	// Without --thinking, the CLI emits no reasoning blocks.
	thinking    bool
	forkSession bool
	// storeRoot reaches the model through the briefing; the process runs in the turn folder.
	storeRoot string
	// mcpConfig retains {env:KIAO_MCP_TURN_TOKEN} for CLI expansion.
	// An empty config leaves the host's configuration untouched.
	mcpConfig string
	mcpToken  string
	// Gate --auto here as well as upstream so new callers fail closed.
	allowBypass bool
}

func (d *opencodeDriver) runFor(run harnessapi.HarnessRun) opencodeRun {
	return opencodeRun{
		model:          run.Model,
		effort:         run.Effort,
		permissionMode: run.PermissionMode,
		instructions:   run.Instructions,
		thinking:       run.Thinking,
		sessionID:      run.SessionID,
		forkSession:    run.ForkSession,
		storeRoot:      run.StoreRoot,
		mcpConfig:      run.MCPConfig,
		mcpToken:       run.MCPToken,
		allowBypass:    run.AllowBypass,
	}
}

var errOpenCodeNeedsBypass = errors.New(
	"OpenCode runs turns unsupervised or not at all, and this service does not allow it.")

// The prompt travels on stdin to avoid exposing it in ps or hitting
// argument limits. Spawn sets the working directory instead of --dir.
// Omit --harness so hosts can rename their default primary harness.
func opencodeArgs(run opencodeRun) ([]string, error) {
	// Without --auto, permission requests are auto-rejected; there is no approval
	// protocol. Refuse turns when bypass is disabled or an interactive mode is requested.
	if !run.allowBypass || runnerconfig.AsksBeforeTools(run.permissionMode) {
		return nil, errOpenCodeNeedsBypass
	}

	args := []string{"run",
		"--format", "json",
		"--auto",
		// The JSON error may only contain a reference; stderr carries the cause.
		"--print-logs", "--log-level", "ERROR",
	}
	if run.thinking {
		args = append(args, "--thinking")
	}
	if model := strings.TrimSpace(run.model); model != "" {
		args = append(args, "-m", model)
	}
	if effort := strings.TrimSpace(run.effort); effort != "" {
		// Models without the requested variant ignore it.
		args = append(args, "--variant", effort)
	}
	if session := strings.TrimSpace(run.sessionID); session != "" {
		args = append(args, "-s", session)
		if run.forkSession {
			args = append(args, "--fork")
		}
	}
	return args, nil
}

// opencodeDriver is created per turn and never reused.
type opencodeDriver struct {
	cfg    *runnerconfig.Config
	binary string
	run    harnessapi.HarnessRun

	// Unbuffered events backpressure CLI reads to the hub relay rate.
	events chan harnessapi.HarnessEvent

	mu sync.Mutex
	// stopped latches Stop before cmd is published, preventing a missed kill.
	cmd     *exec.Cmd
	stopped bool

	// Keep stderr because JSON failures may carry only a reference, not the cause.
	errMu   sync.Mutex
	stderr  []string
	errDone chan struct{}
}

var _ harnessapi.HarnessDriver = (*opencodeDriver)(nil)

const maxOpenCodeStderrLines = 20

// Spawn closes stdin after the prompt: the CLI waits for EOF before starting
// and cannot accept further input through Say.
func (d *opencodeDriver) Spawn(run harnessapi.HarnessRun) error {
	d.run = run
	args, err := opencodeArgs(d.runFor(run))
	if err != nil {
		return err
	}
	cmd := exec.Command(d.binary, args...)
	// WorkDir must be absolute and symlink-resolved to prevent escaping the store.
	cmd.Dir = run.WorkDir
	cmd.Env = os.Environ()
	if config := strings.TrimSpace(run.MCPConfig); config != "" {
		// OPENCODE_CONFIG_CONTENT overrides host config; omit it when no servers are supplied.
		cmd.Env = append(cmd.Env, "OPENCODE_CONFIG_CONTENT="+config)
	}
	if run.MCPToken != "" {
		// The CLI expands {env:KIAO_MCP_TURN_TOKEN}; keep the credential out of files
		// and process arguments.
		cmd.Env = append(cmd.Env, "KIAO_MCP_TURN_TOKEN="+run.MCPToken)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return notStartedOpenCode(err)
	}
	// Keep stderr prose separate from stdout JSONL to avoid malformed events.
	outR, outW, err := os.Pipe()
	if err != nil {
		stdin.Close()
		return notStartedOpenCode(err)
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		stdin.Close()
		outR.Close()
		outW.Close()
		return notStartedOpenCode(err)
	}
	cmd.Stdout = outW
	cmd.Stderr = errW

	if err := cmd.Start(); err != nil {
		stdin.Close()
		outW.Close()
		outR.Close()
		errW.Close()
		errR.Close()
		return notStartedOpenCode(err)
	}
	outW.Close() // parent drops its write ends; the child keeps its dups
	errW.Close()

	d.mu.Lock()
	d.cmd = cmd
	d.errDone = make(chan struct{})
	stopped := d.stopped
	d.mu.Unlock()
	if stopped {
		_ = cmd.Process.Kill()
	}

	// No per-turn system prompt is available, so prepend the briefing to stdin.
	// The hub transcript retains the original prompt.
	prompt := briefing.HarnessBriefingWith(run.StoreRoot, run.Instructions) + "\n\n" + run.Prompt
	_, writeErr := io.WriteString(stdin, prompt)
	closeErr := stdin.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		// No readers have started; kill and reap the child so it cannot block on output.
		_ = cmd.Process.Kill()
		go func() { _ = cmd.Wait() }()
		outR.Close()
		errR.Close()
		return fmt.Errorf("The prompt could not be sent to OpenCode: %w", err)
	}

	harnessapi.LogClaudeWS.Info("spawned",
		"harness", harnessapi.HarnessOpenCode, "conversation", run.Conversation, "turn", run.Turn,
		"pid", cmd.Process.Pid, "work_dir", run.WorkDir, "store_root", run.StoreRoot)
	run.Trace.Exec(d.execRecord(cmd))
	// Record stdin separately because argv does not contain the prompt.
	run.Trace.StreamLine(turntrace.TraceIn, prompt)

	go d.readStderr(errR)
	go d.read(outR)
	return nil
}

// execRecord relies on trace scrubbing to redact credentials from the environment.
func (d *opencodeDriver) execRecord(cmd *exec.Cmd) turntrace.TraceExec {
	path, version := turntrace.BinaryVersion(d.binary)
	skills := ""
	if root := pkgSkills.StoreRootOf(d.cfg); root != "" {
		skills = pkgSkills.StoreAgentsSkills(root)
	}
	return turntrace.TraceExec{
		Binary: d.binary, Path: path, Version: version,
		Argv: cmd.Args, Env: turntrace.AddedEnv(cmd.Env), Dir: cmd.Dir, PID: cmd.Process.Pid,
		SkillsPath: skills, Skills: turntrace.InstalledSkills(skills),
	}
}

func notStartedOpenCode(err error) error {
	return fmt.Errorf("The OpenCode process could not be started: %w", err)
}

func (d *opencodeDriver) Events() <-chan harnessapi.HarnessEvent { return d.events }

// The CLI has no approval channel; this driver never emits harnessAsk.
func (d *opencodeDriver) Answer(string, harnessapi.AskDecision) error {
	return errors.New("OpenCode asks nothing, so there is nothing to answer")
}

// stdin is closed after the prompt, and the CLI has no other mid-turn input channel.
func (d *opencodeDriver) Say(string) error {
	return errors.New("OpenCode cannot be told anything mid-turn; wait for the reply and send it after")
}

// The reader emits harnessDone after the killed process closes its output.
func (d *opencodeDriver) Stop() {
	d.mu.Lock()
	d.stopped = true
	cmd := d.cmd
	d.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		harnessapi.LogClaudeWS.Info("process killed",
			"harness", harnessapi.HarnessOpenCode, "conversation", d.run.Conversation, "turn", d.run.Turn,
			"pid", cmd.Process.Pid)
		_ = cmd.Process.Kill()
	}
}

// Report stderr failures only at process exit: a mid-turn error may be retried
// and must not prematurely mark the turn as failed.
func (d *opencodeDriver) readStderr(errR *os.File) {
	defer close(d.errDone)
	defer errR.Close()
	scanner := bufio.NewScanner(errR)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		harnessapi.LogClaudeWS.Debug("opencode stderr",
			"conversation", d.run.Conversation, "turn", d.run.Turn, "line", line)
		// Trace all stderr even though only the tail is retained in memory.
		d.run.Trace.StderrLine(line)
		d.errMu.Lock()
		d.stderr = append(d.stderr, line)
		if len(d.stderr) > maxOpenCodeStderrLines {
			d.stderr = d.stderr[len(d.stderr)-maxOpenCodeStderrLines:]
		}
		d.errMu.Unlock()
	}
}

func (d *opencodeDriver) lastStderr() string {
	d.errMu.Lock()
	defer d.errMu.Unlock()
	if len(d.stderr) == 0 {
		return ""
	}
	return d.stderr[len(d.stderr)-1]
}

// read closes the stream with exactly one harnessDone carrying the exit code.
func (d *opencodeDriver) read(outR *os.File) {
	defer close(d.events)
	reader := bufio.NewReader(outR)
	said := false
	announced := false
	var billed harnessapi.TurnUsage
	billOpen := false
	for {
		line, err := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			// Trace every frame, including step_start, which produces no stored block.
			d.run.Trace.StreamLine(turntrace.TraceOut, trimmed)
			for _, event := range d.readEvent(trimmed, &announced, &billed, &billOpen) {
				if event.Kind == harnessapi.EventFailure {
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

	// Drain both pipes before Wait to avoid racing either reader.
	<-d.errDone

	// Aggregate step usage into one bill per turn.
	if billOpen {
		billed.Scope = harnessapi.UsageScopeTurn
		d.events <- harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: &billed}
	}

	exitCode := 0
	if err := d.cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	// Use stderr as the failure cause only if the JSON stream supplied none.
	if exitCode != 0 && !said {
		if last := d.lastStderr(); last != "" {
			d.events <- harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: last}
		}
	}
	d.events <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: exitCode}
}

// Text, reasoning and tool_use parts arrive complete: announce each block once,
// never revise it. step_finish carries usage; only process exit ends the turn.
func (d *opencodeDriver) readEvent(line string, announced *bool, billed *harnessapi.TurnUsage, billOpen *bool) []harnessapi.HarnessEvent {
	var event map[string]any
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		harnessapi.LogClaudeWS.Warn("event parse failed",
			"harness", harnessapi.HarnessOpenCode, "conversation", d.run.Conversation, "error", err)
		return nil
	}
	var out []harnessapi.HarnessEvent
	// Announce the first sessionID before other events so interrupted turns can
	// still resume.
	if !*announced {
		if id := protocol.AsString(event["sessionID"]); id != "" {
			*announced = true
			out = append(out, harnessapi.HarnessEvent{Kind: harnessapi.EventSession, SessionID: id})
		}
	}
	switch protocol.AsString(event["type"]) {
	case "text", "reasoning":
		part, _ := event["part"].(map[string]any)
		if block, ok := opencodeBlock(protocol.AsString(event["type"]), part); ok {
			out = append(out, harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: block})
		}
	case "tool_use":
		part, _ := event["part"].(map[string]any)
		if block, ok := opencodeBlock("tool_use", part); ok {
			out = append(out, harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: block})
		}
	case "step_finish":
		part, _ := event["part"].(map[string]any)
		if step, ok := opencodeUsage(part); ok {
			billed.InputTokens += step.InputTokens
			billed.OutputTokens += step.OutputTokens
			billed.CacheReadTokens += step.CacheReadTokens
			billed.CacheWriteTokens += step.CacheWriteTokens
			billed.TotalCostUSD += step.TotalCostUSD
			*billOpen = true
		}
	case "error":
		out = append(out, OpencodeFailure(event["error"]))
	case "step_start":
	}
	return out
}

// ProviderAuthError must retain AuthRequired so the UI can offer sign-in.
func OpencodeFailure(raw any) harnessapi.HarnessEvent {
	failure, _ := raw.(map[string]any)
	name := protocol.AsString(failure["name"])
	if data, ok := failure["data"].(map[string]any); ok {
		if message := protocol.AsString(data["message"]); message != "" {
			if status, ok := data["statusCode"].(float64); ok {
				message = fmt.Sprintf("API Error: %.0f %s", status, message)
				if status == 429 {
					if headers, ok := data["responseHeaders"].(map[string]any); ok {
						var seconds, milliseconds string
						for key, value := range headers {
							switch strings.ToLower(key) {
							case "retry-after":
								seconds = protocol.AsString(value)
							case "retry-after-ms":
								milliseconds = protocol.AsString(value)
							}
						}
						if milliseconds != "" {
							message += "; retry-after: " + milliseconds + "ms"
						} else if seconds != "" {
							message += "; retry-after: " + seconds
						}
					}
				}
			}
			return harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: message,
				AuthRequired: name == "ProviderAuthError"}
		}
	}
	if name != "" {
		return harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: name,
			AuthRequired: name == "ProviderAuthError"}
	}
	return harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: "The OpenCode turn failed."}
}

// An all-zero step report is treated as missing usage, not a free bill.
func opencodeUsage(part map[string]any) (harnessapi.TurnUsage, bool) {
	var report harnessapi.TurnUsage
	found := false
	tokens, _ := part["tokens"].(map[string]any)
	set := func(field *int64, keys ...string) {
		if value, ok := protocol.AsInt64(protocol.FirstOf(tokens, keys...)); ok {
			*field = value
			found = found || value != 0
		}
	}
	set(&report.InputTokens, "input")
	set(&report.OutputTokens, "output")
	if cache, ok := tokens["cache"].(map[string]any); ok {
		if value, ok := protocol.AsInt64(protocol.FirstOf(cache, "read")); ok {
			report.CacheReadTokens = value
			found = found || value != 0
		}
		if value, ok := protocol.AsInt64(protocol.FirstOf(cache, "write")); ok {
			report.CacheWriteTokens = value
			found = found || value != 0
		}
	}
	if amount, ok := protocol.AsFloat(protocol.FirstOf(part, "cost")); ok && amount != 0 {
		report.TotalCostUSD, found = amount, true
	}
	return report, found
}

// Omit MessageID: OpenCode forks whole sessions and accepts no message cut point.
func opencodeBlock(kind string, part map[string]any) (harnessapi.TurnBlock, bool) {
	switch kind {
	case "text":
		return harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: protocol.AsString(part["text"])}, true
	case "reasoning":
		// Keep empty reasoning blocks to preserve where the model reasoned in the turn.
		return harnessapi.TurnBlock{Kind: harnessapi.BlockKindThinking, Text: protocol.AsString(part["text"])}, true
	case "tool_use":
		state, _ := part["state"].(map[string]any)
		return opencodeToolBlock(part, state), true
	}
	return harnessapi.TurnBlock{}, false
}

func opencodeToolBlock(part, state map[string]any) harnessapi.TurnBlock {
	tool := protocol.OrDefault(protocol.AsString(part["tool"]), "tool")
	detail := protocol.PermissionInputSummary(state["input"])
	block := harnessapi.TurnBlock{
		Kind:      harnessapi.BlockKindToolUse,
		Name:      tool,
		Input:     harnessapi.SummarizeToolInput(detail),
		Detail:    protocol.CutRunes(detail, protocol.MaxPermissionInputChars),
		ToolUseID: protocol.OrDefault(protocol.AsString(part["callID"]), protocol.AsString(part["id"])),
	}
	switch protocol.AsString(state["status"]) {
	case "completed":
		block.Result = protocol.AsString(state["output"])
	case "error":
		block.Result, block.IsError = protocol.AsString(state["error"]), true
	}
	if timing, _ := state["time"].(map[string]any); timing != nil {
		if start, ok := protocol.AsInt64(protocol.FirstOf(timing, "start")); ok {
			if end, ok := protocol.AsInt64(protocol.FirstOf(timing, "end")); ok && end >= start {
				block.DurationMs = end - start
			}
		}
	}
	return block
}
