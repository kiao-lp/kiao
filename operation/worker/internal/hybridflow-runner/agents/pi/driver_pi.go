package pi

import (
	"encoding/json"
	"errors"
	"fmt"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/filesystem"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	briefing "kiao/worker/internal/hybridflow-runner/agents/prompt"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

type piAgent struct {
	cfg      *runnerconfig.Config
	profiles *PiProfiles
}

func NewPiAgent(cfg *runnerconfig.Config, profiles *PiProfiles) *piAgent {
	return &piAgent{cfg, profiles}
}

func (a *piAgent) Available() bool {
	doc, err := a.profiles.ReadProfiles()
	if err != nil {
		return false
	}
	// Offer setup even with incomplete profiles; resolution provides the precise refusal.
	return len(a.profiles.Installations(doc)) > 0 || len(doc.Profiles) > 0
}

func (a *piAgent) Driver() agentapi.AgentDriver {
	return &PiDriver{cfg: a.cfg, profiles: a.profiles, events: make(chan agentapi.AgentEvent), asks: map[string]string{}}
}

func (a *piAgent) BranchesSessions() bool { return true }

func (a *piAgent) RenderMCP(servers []equipment.MCPServer) (string, error) {
	return piMCPConfig(servers), nil
}

func (a *piAgent) Options() agentapi.AgentOptionsDto {
	offers := a.profiles.OfferedProfiles()
	for i := range offers {
		if offers[i].Status == "ready" {
			models, err := a.profiles.Models(offers[i].ID, false)
			if err != nil {
				offers[i].Status, offers[i].Message = "model_unavailable", err.Error()
			} else {
				offers[i].Models = models
			}
		}
	}
	doc, _ := a.profiles.ReadProfiles()
	return agentapi.AgentOptionsDto{Models: []agentapi.AgentOption{}, Efforts: []agentapi.AgentOption{}, PermissionModes: agentapi.PermissionModesFrom(agentapi.ClaudeAllPermissionModes, a.cfg.BypassEnabled), Profiles: offers, DefaultProfileID: doc.DefaultPiProfileID, Capabilities: &agentapi.AgentCapabilities{Steer: true, FollowUp: true, Compact: true, Branch: true, ForkAtMessage: true}}
}

func piMCPConfig(servers []equipment.MCPServer) string {
	out := map[string]any{}
	for _, server := range servers {
		config := map[string]any{"exposure": "codemode"}
		if server.Type == equipment.MCPHTTP {
			config["url"], config["headers"] = server.URL, server.Headers
		} else {
			config["command"], config["args"], config["env"] = server.Command, server.Args, server.Env
		}
		out[server.Name] = config
	}
	raw, _ := json.Marshal(map[string]any{"mcpServers": out})
	return string(raw)
}

type PiDriver struct {
	eventMu         sync.Mutex
	eventsClosed    bool
	cfg             *runnerconfig.Config
	profiles        *PiProfiles
	events          chan agentapi.AgentEvent
	run             agentapi.AgentRun
	Rpc             *piRPC
	dir, sessionDir string
	mu              sync.Mutex
	stopped         bool
	finished        bool
	asks            map[string]string
	queue           []agentapi.AgentQueuedMessage
	queueMu         sync.Mutex
	inputMu         sync.Mutex
	stopOnce        sync.Once
	finalError      string
	// Calls are emitted once, with results attached by id (also for nested/parallel calls).
	tools map[string]bool
}

var _ agentapi.AgentDriver = (*PiDriver)(nil)

var _ agentapi.AgentDeferred = (*PiDriver)(nil)

func (d *PiDriver) Events() <-chan agentapi.AgentEvent { return d.events }

func (d *PiDriver) Spawn(run agentapi.AgentRun) error {
	if run.PermissionMode == runnerconfig.PermissionModeBypass && !run.AllowBypass {
		return errors.New("Pi bypass permissions is disabled")
	}
	resolved := run.Pi
	var err error
	if resolved == nil {
		resolved, err = d.profiles.ResolveProfile(run.ProfileID, run.Model, run.Effort)
		if err != nil {
			return err
		}
	}
	if resolved.Installation.External {
		if err := verifyPiVersion(resolved.Installation, piEnvironment(nil)); err != nil {
			return err
		}
	}
	run.Pi = resolved
	d.run = run
	d.tools = map[string]bool{}
	if run.Conversation == "" || !conversations.ConversationIDRe.MatchString(run.Conversation) {
		return errors.New("invalid Pi conversation")
	}
	native := filepath.Join(d.cfg.StatePath, conversations.ConversationsDirName, run.Conversation, "pi")
	d.sessionDir = filepath.Join(native, "sessions")
	if err := os.MkdirAll(d.sessionDir, 0o700); err != nil {
		return err
	}
	session := run.SessionID
	if session != "" {
		root := filepath.Join(d.cfg.StatePath, conversations.ConversationsDirName)
		relative, err := filepath.Rel(root, session)
		if err != nil || strings.HasPrefix(relative, "..") || !filepath.IsAbs(session) {
			return errors.New("Pi session is outside conversation state")
		}
		if run.ForkSession {
			// Never open the source for writing, even before RPC branching has completed.
			data, err := os.ReadFile(session)
			if err != nil {
				return errors.New("Pi source session is unavailable")
			}
			session = filepath.Join(native, "fork-source.jsonl")
			if err := os.WriteFile(session, data, 0o600); err != nil {
				return err
			}
		} else {
			relative, err = filepath.Rel(native, session)
			if err != nil || strings.HasPrefix(relative, "..") {
				return errors.New("Pi sessions cannot have two conversation writers")
			}
		}
	}
	mcp := run.MCPConfig
	if resolved.Profile.MCPServers != nil {
		var config struct {
			Servers map[string]json.RawMessage `json:"mcpServers"`
		}
		config.Servers = map[string]json.RawMessage{}
		_ = json.Unmarshal([]byte(mcp), &config)
		for name := range config.Servers {
			if !slices.Contains(resolved.Profile.MCPServers, name) {
				delete(config.Servers, name)
			}
		}
		raw, _ := json.Marshal(config)
		mcp = string(raw)
	}
	dir, extraEnv, secrets, err := materializePi(resolved, filepath.Join(d.cfg.StatePath, "pi-runs"), mcp)
	if err != nil {
		return err
	}
	d.dir = dir
	args := piArgs(dir, d.sessionDir, session)
	if err := os.WriteFile(filepath.Join(dir, "instructions.md"), []byte(briefing.AgentBriefingWith(run.StoreRoot, run.Instructions)), 0o600); err != nil {
		os.RemoveAll(dir)
		return err
	}
	args = append(args, "--append-system-prompt", filepath.Join(dir, "instructions.md"))
	// Use the installed store catalogue, including when cwd is below the store root.
	for _, skill := range piSkillPaths(run.StoreRoot) {
		args = append(args, "--skill", skill)
	}
	for _, group := range []struct {
		flag      string
		resources []agentapi.PiResource
	}{{"--extension", resolved.Profile.Extensions}, {"--prompt-template", resolved.Profile.PromptTemplates}} {
		paths, err := piVerifyResources(group.resources)
		if err != nil {
			os.RemoveAll(dir)
			return err
		}
		for _, path := range paths {
			args = append(args, group.flag, path)
		}
	}
	if len(resolved.Profile.Tools) > 0 {
		args = append(args, "--tools", strings.Join(resolved.Profile.Tools, ","))
	}
	extraEnv = append(extraEnv, "KIAO_PI_PERMISSION_MODE="+run.PermissionMode, "KIAO_MCP_TURN_TOKEN="+run.MCPToken)
	secrets = append(secrets, run.MCPToken)
	rpc, err := startPiRPC(resolved.Installation.Path, args, piEnvironment(extraEnv), run.WorkDir, run.Trace, secrets)
	if err != nil {
		os.RemoveAll(dir)
		return errors.New("Pi could not start: " + err.Error())
	}
	d.mu.Lock()
	d.Rpc = rpc
	stopped := d.stopped
	d.mu.Unlock()
	go d.work()
	if stopped {
		d.Stop()
	}
	return nil
}

func piSkillPaths(root string) []string {
	if root == "" {
		return nil
	}
	dir := filepath.Join(root, ".agents", "skills")
	entries, _ := os.ReadDir(dir)
	var paths []string
	for _, e := range entries {
		if e.IsDir() {
			path := filepath.Join(dir, e.Name(), "SKILL.md")
			if _, err := os.Stat(path); err == nil {
				paths = append(paths, path)
			}
		}
	}
	return paths
}

func (d *PiDriver) emit(event agentapi.AgentEvent) {
	d.eventMu.Lock()
	defer d.eventMu.Unlock()
	if !d.eventsClosed {
		d.events <- event
	}
}

func (d *PiDriver) work() {
	code, terminal := 0, "completed"
	defer func() {
		d.Rpc.close()
		if d.Rpc.Process.Err != nil || d.Rpc.Process.ExitCode != 0 {
			if code == 0 {
				code, terminal = 1, "failed"
			}
		}
		d.inputMu.Lock()
		d.mu.Lock()
		if d.stopped {
			code, terminal = -1, "cancelled"
		}
		d.finished = true
		d.mu.Unlock()
		d.cancelPendingQueue()
		d.inputMu.Unlock()
		os.RemoveAll(d.dir)
		if code != 0 && d.finalError != "" {
			d.emit(agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: d.Rpc.scrub(d.finalError)})
		}
		d.eventMu.Lock()
		d.events <- agentapi.AgentEvent{Kind: agentapi.EventDone, ExitCode: code, Terminal: terminal}
		d.eventsClosed = true
		close(d.events)
		d.eventMu.Unlock()
	}()
	fail := func(err error) { code, terminal = 1, "failed"; d.finalError = err.Error() }
	if err := d.initialize(); err != nil {
		fail(err)
		return
	}
	baseline, err := d.Rpc.call("get_session_stats", nil, piCommandTimeout)
	if err != nil {
		fail(err)
		return
	}
	var accepted map[string]json.RawMessage
	if d.run.Compact || strings.TrimSpace(d.run.Prompt) == "/compact" {
		if err := d.captureSession(); err != nil {
			fail(err)
			return
		}
		// compact is a protocol operation, never a model interpretation of a slash command.
		result := make(chan error, 1)
		go func() { _, err := d.Rpc.call("compact", nil, 10*time.Minute); result <- err }()
		for {
			select {
			case err := <-result:
				if err != nil {
					fail(err)
				}
				d.captureSession()
				d.reportUsage(baseline)
				return
			case event, ok := <-d.Rpc.events:
				if !ok {
					fail(errors.New("Pi exited during compaction"))
					return
				}
				d.handle(event)
			}
		}
	}
	accepted, err = d.Rpc.call("prompt", map[string]any{"message": d.run.Prompt, "images": d.run.Images}, piCommandTimeout)
	if err != nil {
		fail(err)
		return
	}
	if err := d.captureSession(); err != nil {
		fail(err)
		return
	}
	if rawString(accepted, "disposition") == "handled" {
		state, err := d.Rpc.call("get_state", nil, piCommandTimeout)
		if err != nil {
			fail(err)
			return
		}
		if string(state["isStreaming"]) != "true" && string(state["isCompacting"]) != "true" {
			d.captureSession()
			d.reportUsage(baseline)
			return
		}
	}
	for event := range d.Rpc.events {
		kind := rawString(event, "type")
		d.handle(event)
		if kind == "agent_settled" {
			if string(event["aborted"]) == "true" {
				code, terminal = -1, "cancelled"
			}
			// Intermediate failed messages can be followed by successful Pi retries.
			if d.finalError != "" && code == 0 {
				code, terminal = 1, "failed"
			}
			if err := d.captureSession(); err != nil {
				fail(err)
			}
			d.reportUsage(baseline)
			return
		}
	}
	fail(errors.New("Pi exited before agent_settled"))
}

func (d *PiDriver) initialize() error {
	rpc := d.Rpc
	if d.run.ForkSession {
		if _, err := rpc.call("clone", nil, piCommandTimeout); err != nil {
			return fmt.Errorf("Pi clone failed: %w", err)
		}
		if d.run.ResumeAt != "" {
			data, err := rpc.call("get_entries", nil, piCommandTimeout)
			if err != nil {
				return err
			}
			userID, err := piForkUser(data, d.run.ResumeAt)
			if err != nil {
				return err
			}
			if userID != "" {
				if _, err := rpc.call("fork", map[string]any{"entryId": userID}, piCommandTimeout); err != nil {
					return err
				}
			}
		}
	}
	if d.run.SessionID != "" {
		if err := d.captureSession(); err != nil {
			return err
		}
	}
	p := d.run.Pi
	if _, err := rpc.call("set_model", map[string]any{"provider": p.Provider, "modelId": p.ModelID}, piCommandTimeout); err != nil {
		return err
	}
	levels, err := rpc.call("get_available_thinking_levels", nil, piCommandTimeout)
	if err != nil {
		return err
	}
	var allowed []string
	_ = json.Unmarshal(levels["levels"], &allowed)
	if len(allowed) == 0 {
		return errors.New("Pi reported no supported reasoning level")
	}
	effort := p.Effort
	if !d.run.Thinking {
		effort = "off"
	}
	if effort == "" {
		effort = allowed[0]
	}
	if !slices.Contains(allowed, effort) {
		return errors.New("Pi model does not support thinking level " + effort)
	}
	if _, err := rpc.call("set_thinking_level", map[string]any{"level": effort}, piCommandTimeout); err != nil {
		return err
	}
	if len(d.run.Images) > 0 {
		available, err := rpc.call("get_available_models", nil, piCommandTimeout)
		if err != nil {
			return err
		}
		var models []struct {
			Provider string   `json:"provider"`
			ID       string   `json:"id"`
			Input    []string `json:"input"`
		}
		_ = json.Unmarshal(available["models"], &models)
		image := false
		for _, m := range models {
			if m.Provider == p.Provider && m.ID == p.ModelID {
				image = slices.Contains(m.Input, "image")
			}
		}
		if !image {
			return errors.New("Pi model does not support image input")
		}
	}
	return nil
}

type piEntry struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parentId"`
	Type     string  `json:"type"`
	Message  struct {
		Role string `json:"role"`
	} `json:"message"`
}

func piForkUser(data map[string]json.RawMessage, anchor string) (string, error) {
	var entries []piEntry
	_ = json.Unmarshal(data["entries"], &entries)
	byID := map[string]piEntry{}
	for _, e := range entries {
		byID[e.ID] = e
	}
	var branch []piEntry
	leaf := rawString(data, "leafId")
	for leaf != "" {
		e, ok := byID[leaf]
		if !ok {
			break
		}
		branch = append(branch, e)
		if e.ParentID == nil {
			break
		}
		leaf = *e.ParentID
	}
	slices.Reverse(branch)
	found := false
	for _, e := range branch {
		if found && e.Message.Role == "user" {
			return e.ID, nil
		}
		if e.ID == anchor {
			found = true
		}
	}
	if !found {
		return "", errors.New("Pi branch anchor is not on the active session branch")
	}
	return "", nil
}

func (d *PiDriver) captureSession() error {
	state, err := d.Rpc.call("get_state", nil, piCommandTimeout)
	if err != nil {
		return err
	}
	session := rawString(state, "sessionFile")
	if session == "" {
		return errors.New("Pi reported no native session")
	}
	data, err := d.Rpc.call("get_entries", nil, piCommandTimeout)
	if err != nil {
		return err
	}
	var entries []piEntry
	_ = json.Unmarshal(data["entries"], &entries)
	anchor := ""
	for _, e := range entries {
		if e.Message.Role == "assistant" {
			anchor = e.ID
		}
	}
	// Driver data complements the common transcript: durable entry IDs, leaf, file, and turn mapping.
	body, _ := json.Marshal(map[string]any{"sessionFile": session, "leafId": rawString(data, "leafId"), "turnId": d.run.Turn, "entries": entries})
	if err := filesystem.WriteFileAtomic(filepath.Join(filepath.Dir(d.sessionDir), "session.json"), body, 0o600); err != nil {
		return err
	}
	d.emit(agentapi.AgentEvent{Kind: agentapi.EventSession, SessionID: session, MessageID: anchor})
	return nil
}

func (d *PiDriver) handle(event map[string]json.RawMessage) {
	kind := rawString(event, "type")
	switch kind {
	case "message_start":
		var message struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		_ = json.Unmarshal(event["message"], &message)
		if message.Role == "user" {
			var text string
			if json.Unmarshal(message.Content, &text) != nil {
				var blocks []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				}
				_ = json.Unmarshal(message.Content, &blocks)
				for _, block := range blocks {
					if block.Type == "text" {
						text += block.Text
					}
				}
			}
			d.queueMu.Lock()
			for i := range d.queue {
				if d.queue[i].State == "pending" && d.queue[i].Text == text {
					d.queue[i].State = "delivered"
					break
				}
			}
			d.queueMu.Unlock()
			d.emitQueue()
		}
	case "message_end":
		var message struct {
			Role    string `json:"role"`
			Content []struct {
				Type      string          `json:"type"`
				Text      string          `json:"text"`
				Thinking  string          `json:"thinking"`
				ID        string          `json:"id"`
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"content"`
			StopReason   string `json:"stopReason"`
			ErrorMessage string `json:"errorMessage"`
		}
		if json.Unmarshal(event["message"], &message) != nil || message.Role != "assistant" {
			return
		}
		d.finalError = ""
		if message.StopReason == "error" {
			d.finalError = protocol.OrDefault(message.ErrorMessage, "Pi model request failed")
		}
		for _, block := range message.Content {
			switch block.Type {
			case "text":
				d.emit(agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: block.Text}})
			case "thinking":
				d.emit(agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindThinking, Text: block.Thinking}})
				// Tool execution events are authoritative, including nested and parallel calls.
			}
		}
	case "tool_execution_start":
		id := rawString(event, "toolCallId")
		if d.tools[id] {
			return
		}
		d.tools[id] = true
		args := string(event["args"])
		d.emit(agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindToolUse, Name: rawString(event, "toolName"), Input: protocol.CutRunes(args, 80), Detail: protocol.CutRunes(args, protocol.MaxPermissionInputChars), ToolUseID: id, At: time.Now()}})
	case "tool_execution_end":
		id := rawString(event, "toolCallId")
		if !d.tools[id] {
			d.tools[id] = true
			d.emit(agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindToolUse, Name: rawString(event, "toolName"), ToolUseID: id, At: time.Now()}})
		}
		var result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		_ = json.Unmarshal(event["result"], &result)
		var texts []string
		for _, c := range result.Content {
			if c.Type == "text" {
				texts = append(texts, c.Text)
			}
		}
		var duration int64
		_ = json.Unmarshal(event["durationMs"], &duration)
		d.emit(agentapi.AgentEvent{Kind: agentapi.EventToolResult, ToolUseID: rawString(event, "toolCallId"), ToolResult: strings.Join(texts, "\n"), ToolIsError: string(event["isError"]) == "true", ToolDurationMs: duration})
	case "extension_ui_request":
		d.dialog(event)
	case "queue_update":
		d.updateQueue(event)
	case "auto_retry_start", "summarization_retry_scheduled":
		d.emit(agentapi.AgentEvent{Kind: agentapi.EventNotice, Message: "Pi retry: " + rawString(event, "errorMessage")})
	case "auto_retry_end":
		if string(event["success"]) == "false" {
			d.finalError = protocol.OrDefault(rawString(event, "finalError"), "Pi retries exhausted")
		}
	case "compaction_start":
		d.emit(agentapi.AgentEvent{Kind: agentapi.EventNotice, Message: "Pi is compacting the session"})
	case "compaction_end":
		if message := rawString(event, "errorMessage"); message != "" {
			d.finalError = message
		} else {
			d.emit(agentapi.AgentEvent{Kind: agentapi.EventNotice, Message: "Pi compaction completed"})
		}
	}
}

func (d *PiDriver) dialog(event map[string]json.RawMessage) {
	method, id, title := rawString(event, "method"), rawString(event, "id"), rawString(event, "title")
	d.mu.Lock()
	stopped := d.stopped
	d.mu.Unlock()
	if stopped {
		if method == "confirm" || method == "select" || method == "input" || method == "editor" {
			_ = d.Rpc.send(map[string]any{"type": "extension_ui_response", "id": id, "cancelled": true})
		}
		return
	}
	if method != "confirm" && method != "select" && method != "input" && method != "editor" {
		if message := rawString(event, "message"); message != "" {
			d.emit(agentapi.AgentEvent{Kind: agentapi.EventNotice, Message: message})
		}
		return
	}
	d.mu.Lock()
	d.asks[id] = method
	d.mu.Unlock()
	ask := &agentapi.AgentAsk{ID: id, Tool: "Pi question"}
	if title == "kiao.permission" {
		var permission struct {
			Tool      string `json:"tool"`
			Input     any    `json:"input"`
			ToolUseID string `json:"toolUseId"`
		}
		if err := json.Unmarshal([]byte(rawString(event, "message")), &permission); err != nil || permission.Tool == "" {
			_ = d.Rpc.send(map[string]any{"type": "extension_ui_response", "id": id, "cancelled": true})
			return
		}
		ask.Tool, ask.Input, ask.ToolUseID = permission.Tool, permission.Input, permission.ToolUseID
		raw, _ := json.Marshal(permission.Input)
		ask.InputSummary = string(raw)
	} else {
		question := title
		options := []map[string]any{}
		var values []string
		_ = json.Unmarshal(event["options"], &values)
		for _, v := range values {
			options = append(options, map[string]any{"label": v})
		}
		if title == "kiao.question" {
			var data struct {
				Question string   `json:"question"`
				Options  []string `json:"options"`
			}
			_ = json.Unmarshal([]byte(rawString(event, "placeholder")), &data)
			question = data.Question
			for _, v := range data.Options {
				options = append(options, map[string]any{"label": v})
			}
		}
		if method == "confirm" {
			d.mu.Lock()
			d.asks[id] = "question-confirm"
			d.mu.Unlock()
			options = []map[string]any{{"label": "Yes"}, {"label": "No"}}
		}
		ask.Questions = []map[string]any{{"question": question, "options": options}}
		ask.QuestionKeys = []string{question}
	}
	d.emit(agentapi.AgentEvent{Kind: agentapi.EventAsk, Ask: ask})
}

func (d *PiDriver) Answer(id string, decision agentapi.AskDecision) error {
	d.mu.Lock()
	method, ok := d.asks[id]
	delete(d.asks, id)
	finished := d.finished
	d.mu.Unlock()
	if !ok || finished {
		return errors.New("Pi request is no longer pending")
	}
	response := map[string]any{"type": "extension_ui_response", "id": id}
	value := ""
	if input, ok := decision.Input.(map[string]any); ok {
		if answers, ok := input["answers"].(map[string]any); ok {
			for _, answer := range answers {
				if text, ok := answer.(string); ok {
					value = text
				}
			}
		}
		if answers, ok := input["answers"].(map[string]string); ok {
			for _, answer := range answers {
				value = answer
			}
		}
	}
	switch {
	case !decision.Allow:
		response["cancelled"] = true
	case method == "question-confirm":
		response["confirmed"] = strings.EqualFold(value, "yes")
	case method == "confirm":
		response["confirmed"] = true
	default:
		response["value"] = value
	}
	return d.Rpc.send(response)
}

func (d *PiDriver) Say(text string) error {
	d.inputMu.Lock()
	defer d.inputMu.Unlock()
	d.mu.Lock()
	stopped := d.stopped || d.finished
	d.mu.Unlock()
	if stopped {
		return errors.New("Pi turn has stopped")
	}
	_, err := d.Rpc.call("steer", map[string]any{"message": text}, piCommandTimeout)
	return err
}

func (d *PiDriver) FollowUp(id, text string) error {
	d.inputMu.Lock()
	defer d.inputMu.Unlock()
	d.mu.Lock()
	stopped := d.stopped || d.finished
	d.mu.Unlock()
	if stopped {
		return errors.New("Pi turn has stopped")
	}
	// Add before sending; a very fast queue_update may already report delivery.
	d.queueMu.Lock()
	d.queue = append(d.queue, agentapi.AgentQueuedMessage{ID: id, Text: text, State: "pending"})
	d.queueMu.Unlock()
	data, err := d.Rpc.call("follow_up", map[string]any{"message": text}, piCommandTimeout)
	if err != nil {
		d.setQueuedState(id, "cancelled")
		return err
	}
	if rawString(data, "disposition") == "handled" {
		d.setQueuedState(id, "delivered")
	}
	d.emitQueue()
	return nil
}

func (d *PiDriver) setQueuedState(id, state string) {
	d.queueMu.Lock()
	defer d.queueMu.Unlock()
	for i := range d.queue {
		if d.queue[i].ID == id {
			d.queue[i].State = state
		}
	}
}

func (d *PiDriver) updateQueue(event map[string]json.RawMessage) {
	// Pi's queue contains texts, not stable message IDs. Delivery is acknowledged by
	// message_start(user), which also distinguishes duplicate texts in FIFO order.
	d.emitQueue()
}

func (d *PiDriver) emitQueue() {
	d.queueMu.Lock()
	snapshot := append([]agentapi.AgentQueuedMessage{}, d.queue...)
	d.queueMu.Unlock()
	d.emit(agentapi.AgentEvent{Kind: agentapi.EventQueue, Queue: snapshot})
}

func (d *PiDriver) cancelPendingQueue() {
	d.queueMu.Lock()
	changed := false
	for i := range d.queue {
		if d.queue[i].State == "pending" {
			d.queue[i].State = "cancelled"
			changed = true
		}
	}
	d.queueMu.Unlock()
	if changed {
		d.emitQueue()
	}
}

func (d *PiDriver) ClearQueue() error {
	d.inputMu.Lock()
	defer d.inputMu.Unlock()
	// Mark pending before clear_queue's empty queue_update can be mistaken for delivery.
	d.cancelPendingQueue()
	_, err := d.Rpc.call("clear_queue", nil, piCommandTimeout)
	return err
}

func (d *PiDriver) Stop() {
	d.mu.Lock()
	d.stopped = true
	rpc := d.Rpc
	d.mu.Unlock()
	if rpc == nil {
		return
	}
	d.stopOnce.Do(func() {
		go func() {
			// Both ordering and deadlines matter: abort alone may execute queued follow-ups.
			_ = d.ClearQueue()
			d.cancelDialogs()
			_, _ = rpc.call("abort", nil, piCommandTimeout)
			rpc.Process.Stop()
		}()
	})
}

func (d *PiDriver) reportUsage(before map[string]json.RawMessage) {
	after, err := d.Rpc.call("get_session_stats", nil, piCommandTimeout)
	if err != nil {
		return
	}
	parse := func(raw map[string]json.RawMessage) (map[string]int64, float64) {
		var tokens map[string]int64
		_ = json.Unmarshal(raw["tokens"], &tokens)
		var cost float64
		_ = json.Unmarshal(raw["cost"], &cost)
		return tokens, cost
	}
	a, ac := parse(after)
	b, bc := parse(before)
	usage := &agentapi.TurnUsage{InputTokens: max(0, a["input"]-b["input"]), OutputTokens: max(0, a["output"]-b["output"]), CacheReadTokens: max(0, a["cacheRead"]-b["cacheRead"]), CacheWriteTokens: max(0, a["cacheWrite"]-b["cacheWrite"]), TotalCostUSD: max(0, ac-bc), Scope: agentapi.UsageScopeTurn}
	d.emit(agentapi.AgentEvent{Kind: agentapi.EventUsage, Usage: usage})
}

func (d *PiDriver) cancelDialogs() {
	d.mu.Lock()
	ids := make([]string, 0, len(d.asks))
	for id := range d.asks {
		ids = append(ids, id)
	}
	d.asks = map[string]string{}
	d.mu.Unlock()
	for _, id := range ids {
		_ = d.Rpc.send(map[string]any{"type": "extension_ui_response", "id": id, "cancelled": true})
		d.emit(agentapi.AgentEvent{Kind: agentapi.EventWithdraw, AskID: id})
	}
}
