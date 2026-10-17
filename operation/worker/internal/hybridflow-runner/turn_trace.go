package hybridflowrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"kiao/worker/internal/core"
)

// Per-turn process diagnostics live in <conversation>/turns/<turn id>.jsonl.
// Records: run (pre-spawn settings), exec (actual invocation), stderr, optional raw stream, note.
// Tracing must never fail a turn: open failures return nil and all methods are nil-safe.

const (
	// Keep traces inside the conversation so deleting it removes them too.
	turnsDirName = "turns"
	traceFileExt = ".jsonl"

	// Bound untrusted CLI output. Keep the head for setup diagnostics; the Codex driver
	// separately keeps a stderr tail for the final failure message.
	maxTraceBytes = 1 << 20

	// Bound individual records so large protocol frames cannot consume the whole trace.
	maxTraceLineChars = 8 << 10

	maxTurnTraces = 20

	// Traces may contain private process output; restrict access to the owner.
	traceDirPerm  = 0o700
	traceFilePerm = 0o600
)

const (
	traceKindRun    = "run"
	traceKindExec   = "exec"
	traceKindStderr = "stderr"
	traceKindStream = "stream"
	traceKindNote   = "note"

	// Directions are relative to the agent: out from it, in to it.
	traceOut = "out"
	traceIn  = "in"
)

// Use the original credential placeholder for redacted secrets.
const traceRedaction = "${KIAO_MCP_TURN_TOKEN}"

type traceLine struct {
	At   string `json:"at"`
	Kind string `json:"kind"`
}

// Written before spawning so failed starts retain their settings.
type traceRun struct {
	traceLine
	Conversation   string `json:"conversation"`
	Turn           string `json:"turn"`
	Agent          string `json:"agent"`
	Owner          string `json:"owner,omitempty"`
	Folder         string `json:"folder"`
	WorkDir        string `json:"workDir"`
	StoreRoot      string `json:"storeRoot,omitempty"`
	Model          string `json:"model,omitempty"`
	Effort         string `json:"effort,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	Thinking       bool   `json:"thinking"`
	// Deployment permission: false forbids unsupervised runs regardless of the turn mode.
	AllowBypass bool   `json:"allowBypass"`
	Session     string `json:"session,omitempty"`
	ForkSession bool   `json:"forkSession,omitempty"`
	ResumeAt    string `json:"resumeAt,omitempty"`
	// Keep rendered config before credential substitution (path for Claude, TOML for Codex,
	// settings.json fragment for Muse).
	MCPServers []traceMCPServer `json:"mcpServers,omitempty"`
	MCPConfig  string           `json:"mcpConfig,omitempty"`
	// Record whether a credential was minted, never its value.
	MCPToken   bool   `json:"mcpToken"`
	PlayedBy   string `json:"playedBy,omitempty"`
	RunID      string `json:"runId,omitempty"`
	FlowNodeID string `json:"flowNodeId,omitempty"`
	Board      string `json:"board,omitempty"`
}

type traceMCPServer struct {
	Name    string   `json:"name"`
	Type    string   `json:"type,omitempty"`
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
	URL     string   `json:"url,omitempty"`
	// Keep ${VAR} placeholders; replace literal values with <set> to avoid exposing secrets.
	Env     map[string]string `json:"env,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Driver record, written after the process starts.
type traceExec struct {
	traceLine
	Binary  string   `json:"binary"`
	Path    string   `json:"path,omitempty"`
	Version string   `json:"version,omitempty"`
	Argv    []string `json:"argv"`
	// Only service-added or changed entries; never copy the inherited host environment.
	Env        []string `json:"env,omitempty"`
	Dir        string   `json:"dir,omitempty"`
	PID        int      `json:"pid,omitempty"`
	SkillsPath string   `json:"skillsPath,omitempty"`
	Skills     []string `json:"skills,omitempty"`
	// Pre-credential copy of staged configuration that is deleted after the turn (Muse).
	Config string `json:"config,omitempty"`
}

type traceEvent struct {
	traceLine
	// Stream records only; directions are relative to the agent.
	Dir  string `json:"dir,omitempty"`
	Text string `json:"text"`
}

// The mutex keeps records atomic across stdout, stderr and permission-answer goroutines.
type turnTrace struct {
	// Only raw protocol capture is switchable; run, exec and stderr are always bounded and kept.
	stream bool

	// Scrub centrally: credentials can appear in argv, staged config or future driver output.
	secrets []string

	mu        sync.Mutex
	file      *os.File
	written   int64
	truncated bool
	closed    bool
}

func (s *ConversationStore) openTurnTrace(conversationID, turnID string, stream bool, secrets []string) *turnTrace {
	if s == nil || !conversationIDRe.MatchString(conversationID) || strings.TrimSpace(turnID) == "" {
		return nil
	}
	dir := filepath.Join(s.convDir(conversationID), turnsDirName)
	if err := os.MkdirAll(dir, traceDirPerm); err != nil {
		logConv.Warn("cannot open the turn trace",
			"conversation", conversationID, "turn", turnID, "error", err)
		return nil
	}
	pruneTurnTraces(dir, maxTurnTraces-1)

	file, err := os.OpenFile(filepath.Join(dir, turnID+traceFileExt),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND, traceFilePerm)
	if err != nil {
		logConv.Warn("cannot open the turn trace",
			"conversation", conversationID, "turn", turnID, "error", err)
		return nil
	}
	kept := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		if strings.TrimSpace(secret) != "" {
			kept = append(kept, secret)
		}
	}
	return &turnTrace{stream: stream, secrets: kept, file: file}
}

// Turn IDs are turn-<millis>-<hex>, so sorting names gives age order without stat calls.
func pruneTurnTraces(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), traceFileExt) {
			names = append(names, entry.Name())
		}
	}
	if len(names) <= keep {
		return
	}
	sort.Strings(names)
	for _, name := range names[:len(names)-keep] {
		_ = os.Remove(filepath.Join(dir, name))
	}
}

// Check before composing frames to avoid the cost when stream capture is disabled.
func (t *turnTrace) streamKept() bool { return t != nil && t.stream }

func (t *turnTrace) run(rec traceRun) {
	rec.traceLine = traceLine{At: nowConversationTime(), Kind: traceKindRun}
	t.write(rec)
}

func (t *turnTrace) exec(rec traceExec) {
	rec.traceLine = traceLine{At: nowConversationTime(), Kind: traceKindExec}
	t.write(rec)
}

func (t *turnTrace) stderrLine(text string) { t.event(traceKindStderr, "", text) }

func (t *turnTrace) streamLine(dir, text string) {
	if !t.streamKept() {
		return
	}
	t.event(traceKindStream, dir, text)
}

func (t *turnTrace) note(text string) { t.event(traceKindNote, "", text) }

func (t *turnTrace) event(kind, dir, text string) {
	if t == nil || strings.TrimSpace(text) == "" {
		return
	}
	t.write(traceEvent{
		traceLine: traceLine{At: nowConversationTime(), Kind: kind},
		Dir:       dir, Text: text,
	})
}

// Cap the encoded record so the limit covers every record shape.
func (t *turnTrace) write(rec any) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.file == nil || t.closed || t.truncated {
		return
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return
	}
	text := t.scrub(string(line))
	if len(text) > maxTraceLineChars {
		// Truncation intentionally leaves a diagnostic fragment, not parseable JSON.
		text = text[:maxTraceLineChars] + " …[cut]"
	}
	if t.written+int64(len(text))+1 > maxTraceBytes {
		t.truncated = true
		final, _ := json.Marshal(traceEvent{
			traceLine: traceLine{At: nowConversationTime(), Kind: traceKindNote},
			Text:      "the trace reached its size limit; nothing after this point was kept",
		})
		_, _ = t.file.Write(append(final, '\n'))
		return
	}
	n, err := t.file.WriteString(text + "\n")
	t.written += int64(n)
	if err != nil {
		// Disable further writes on failure; avoid repeated work for chatty stderr.
		t.closed = true
		_ = t.file.Close()
	}
}

// Drivers supply unsubstituted config where possible; scrub covers argv and other output.
func (t *turnTrace) scrub(text string) string {
	for _, secret := range t.secrets {
		text = strings.ReplaceAll(text, secret, traceRedaction)
	}
	return text
}

// Idempotent; late writes from other goroutines are dropped.
func (t *turnTrace) close() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.file == nil {
		return
	}
	t.closed = true
	_ = t.file.Close()
}

// Use an exec-managed writer goroutine; an undrained pipe could block the child.
// Nil leaves stderr discarded.
func (t *turnTrace) stderrWriter() *traceLineWriter {
	if t == nil {
		return nil
	}
	return &traceLineWriter{emit: t.stderrLine}
}

// Buffer partial writes so records correspond to lines, not arbitrary write boundaries.
type traceLineWriter struct {
	emit func(string)

	mu      sync.Mutex
	partial []byte
}

// Bound pending output from processes that never write a newline.
const maxTracePartial = 64 << 10

func (w *traceLineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.partial = append(w.partial, p...)
	for {
		index := bytes.IndexByte(w.partial, '\n')
		if index < 0 {
			break
		}
		w.emit(strings.TrimRight(string(w.partial[:index]), "\r"))
		w.partial = w.partial[index+1:]
	}
	if len(w.partial) > maxTracePartial {
		w.emit(string(w.partial))
		w.partial = nil
	}
	return len(p), nil
}

func (w *traceLineWriter) flush() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.partial) > 0 {
		w.emit(string(w.partial))
		w.partial = nil
	}
}

func traceMCPServers(servers []core.MCPServer) []traceMCPServer {
	if len(servers) == 0 {
		return nil
	}
	out := make([]traceMCPServer, 0, len(servers))
	for _, server := range servers {
		out = append(out, traceMCPServer{
			Name: server.Name, Type: server.Type,
			Command: server.Command, Args: server.Args, URL: server.URL,
			Env: tracedValues(server.Env), Headers: tracedValues(server.Headers),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Preserve credential-source placeholders without storing literal secrets.
func tracedValues(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
			out[key] = value
			continue
		}
		out[key] = "<set>"
	}
	return out
}

// Compare whole entries to include replaced values. Exclude inherited host variables,
// which may contain unrelated credentials.
func addedEnv(env []string) []string {
	if len(env) == 0 {
		return nil
	}
	own := make(map[string]bool, len(os.Environ()))
	for _, entry := range os.Environ() {
		own[entry] = true
	}
	var added []string
	for _, entry := range env {
		if !own[entry] {
			added = append(added, entry)
		}
	}
	sort.Strings(added)
	return added
}

func isSkillsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Read per turn to capture the skills actually staged, including changes since startup.
func installedSkills(path string) []string {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names
}

const binaryVersionTimeout = 5 * time.Second

// Cache by binary name to avoid a version subprocess every turn; replacement requires restart
// to refresh the recorded version.
var binaryVersions sync.Map

// Missing path or version is recorded as empty rather than guessed.
func binaryVersion(binary string) (path, version string) {
	if strings.TrimSpace(binary) == "" {
		return "", ""
	}
	if cached, ok := binaryVersions.Load(binary); ok {
		pair := cached.([2]string)
		return pair[0], pair[1]
	}
	path, _ = exec.LookPath(binary)
	ctx, cancel := context.WithTimeout(context.Background(), binaryVersionTimeout)
	defer cancel()
	if out, err := exec.CommandContext(ctx, binary, "--version").Output(); err == nil {
		version = strings.TrimSpace(string(out))
		if index := strings.IndexByte(version, '\n'); index >= 0 {
			version = strings.TrimSpace(version[:index])
		}
	}
	binaryVersions.Store(binary, [2]string{path, version})
	return path, version
}
