package hybridflowrunner

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// The per-turn trace (turn_trace.go): the operational half of a turn, which is everything the
// transcript beside it is right to refuse — how the process was run, what it wrote to stderr, and
// the raw protocol where the conversation asked for it.

// readTrace reads the one trace a conversation has, as records. It fails the test if there is not
// exactly one, because every test here drives exactly one turn.
func readTrace(t *testing.T, store *ConversationStore, conversationID string) []map[string]any {
	t.Helper()
	dir := filepath.Join(store.convDir(conversationID), turnsDirName)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("no trace directory for %s: %v", conversationID, err)
	}
	if len(entries) != 1 {
		t.Fatalf("traces in %s = %d, want exactly one", dir, len(entries))
	}
	return readTraceFile(t, filepath.Join(dir, entries[0].Name()))
}

func readTraceFile(t *testing.T, path string) []map[string]any {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("trace line is not JSON: %q (%v)", line, err)
		}
		records = append(records, rec)
	}
	return records
}

// ofKind is the records of one kind, in the order they were written.
func ofKind(records []map[string]any, kind string) []map[string]any {
	var out []map[string]any
	for _, rec := range records {
		if rec["kind"] == kind {
			out = append(out, rec)
		}
	}
	return out
}

// openTestTrace is a trace over a conversation of its own, which is what every unit test below
// wants: the store is where a trace's path comes from, so building one by hand would be testing a
// path this package does not use.
func openTestTrace(t *testing.T, stream bool, secrets ...string) (*ConversationStore, string, *turnTrace) {
	t.Helper()
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "")
	trace := store.openTurnTrace(meta.ID, "turn-1700000000000-aaaa", stream, secrets)
	if trace == nil {
		t.Fatal("openTurnTrace returned nothing")
	}
	return store, meta.ID, trace
}

// ── what is always kept, and what is switched ─────────────────────────────────

// The three unconditional records are the ones a turn that went wrong is read for, and the raw
// stream is the one that is not: it is the whole exchange rather than the reply, so it is off until
// somebody asks for it on this conversation.
func TestTurnTraceKeepsTheProcessAndDropsTheStreamUnlessAsked(t *testing.T) {
	store, id, trace := openTestTrace(t, false)
	trace.run(traceRun{Conversation: id, Turn: "turn-1", Agent: agentClaude})
	trace.exec(traceExec{Binary: "claude", Argv: []string{"claude", "--print"}})
	trace.stderrLine("node: cannot read the settings file")
	trace.streamLine(traceOut, `{"type":"system"}`)
	trace.close()

	records := readTrace(t, store, id)
	for _, kind := range []string{traceKindRun, traceKindExec, traceKindStderr} {
		if len(ofKind(records, kind)) != 1 {
			t.Errorf("records of kind %s = %d, want one: it is written for every turn", kind, len(ofKind(records, kind)))
		}
	}
	if got := ofKind(records, traceKindStream); len(got) != 0 {
		t.Errorf("stream records with the switch off = %v, want none", got)
	}
	if stderr := ofKind(records, traceKindStderr); stderr[0]["text"] != "node: cannot read the settings file" {
		t.Errorf("stderr record = %v, want the line the process wrote", stderr[0])
	}
}

// With the switch on, both directions are kept: a trace holding only what the agent said would show
// a turn acting on decisions that appear to have come from nowhere.
func TestTurnTraceKeepsBothDirectionsWhenTheConversationAsks(t *testing.T) {
	store, id, trace := openTestTrace(t, true)
	trace.streamLine(traceOut, `{"type":"user"}`)
	trace.streamLine(traceIn, `{"type":"control_response"}`)
	trace.close()

	stream := ofKind(readTrace(t, store, id), traceKindStream)
	if len(stream) != 2 {
		t.Fatalf("stream records = %v, want both directions", stream)
	}
	if stream[0]["dir"] != traceOut || stream[1]["dir"] != traceIn {
		t.Errorf("stream directions = %v / %v, want out then in", stream[0]["dir"], stream[1]["dir"])
	}
}

// ── the credential ────────────────────────────────────────────────────────────

// The turn's token reaches a Codex argument list and a Muse settings file by design, so the trace
// scrubs what it is handed rather than trusting a call site to remember. It is replaced by the
// placeholder it was rendered from, so the line still reads as the configuration it came from.
func TestTurnTraceNeverWritesTheTurnsCredential(t *testing.T) {
	const token = "kiao-turn.SECRETSECRETSECRET"
	store, id, trace := openTestTrace(t, true, token)
	trace.exec(traceExec{Binary: "codex", Argv: []string{"codex", "-c", `mcp_servers={ env = { T = "` + token + `" } }`}})
	trace.stderrLine("started with " + token)
	trace.streamLine(traceOut, `{"token":"`+token+`"}`)
	trace.close()

	body := mustRead(t, filepath.Join(store.convDir(id), turnsDirName, "turn-1700000000000-aaaa.jsonl"))
	if strings.Contains(body, token) {
		t.Fatalf("the trace holds the turn's credential:\n%s", body)
	}
	if strings.Count(body, traceRedaction) != 3 {
		t.Errorf("redactions = %d, want one per place the token stood:\n%s", strings.Count(body, traceRedaction), body)
	}
}

// ── the bounds ────────────────────────────────────────────────────────────────

// An agent's stderr is unbounded by nature, so the file stops rather than growing without one — and
// it says so where it stops, so a short trace is never mistaken for a quiet turn.
func TestTurnTraceStopsAtItsSizeLimit(t *testing.T) {
	store, id, trace := openTestTrace(t, false)
	line := strings.Repeat("x", 4096)
	for i := 0; i < (maxTraceBytes/len(line))+10; i++ {
		trace.stderrLine(line)
	}
	trace.stderrLine("this one is past the end")
	trace.close()

	path := filepath.Join(store.convDir(id), turnsDirName, "turn-1700000000000-aaaa.jsonl")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// The final note is written after the budget is spent, so the file may cross it by one record
	// and never by more.
	if info.Size() > maxTraceBytes+maxTraceLineChars {
		t.Errorf("trace size = %d, want it bounded by %d", info.Size(), maxTraceBytes)
	}
	records := readTraceFile(t, path)
	last := records[len(records)-1]
	if last["kind"] != traceKindNote || !strings.Contains(last["text"].(string), "size limit") {
		t.Errorf("last record = %v, want the note saying the trace was cut", last)
	}
	for _, rec := range records {
		if text, ok := rec["text"].(string); ok && text == "this one is past the end" {
			t.Error("a record written after the limit was kept")
		}
	}
}

// One record is cut on its own, so a single enormous protocol frame costs one line and not the
// whole file's budget — and the line after it is filed as normal.
func TestTurnTraceCutsOneOverlongRecord(t *testing.T) {
	store, id, trace := openTestTrace(t, true)
	trace.streamLine(traceOut, strings.Repeat("y", 4*maxTraceLineChars))
	trace.stderrLine("still here")
	trace.close()

	body := mustRead(t, filepath.Join(store.convDir(id), turnsDirName, "turn-1700000000000-aaaa.jsonl"))
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want the cut frame and the line after it", len(lines))
	}
	if len(lines[0]) > maxTraceLineChars+16 || !strings.HasSuffix(lines[0], "…[cut]") {
		t.Errorf("the overlong record was not cut: %d chars ending %q", len(lines[0]), lines[0][max(0, len(lines[0])-16):])
	}
	if !strings.Contains(lines[1], "still here") {
		t.Errorf("the record after a cut one = %q, want it written whole", lines[1])
	}
}

// ── where it lives, and how long ──────────────────────────────────────────────

// The traces sit inside the conversation, so deleting a conversation takes them with it: a trace
// outliving what it traced is a file nobody could ever join back to anything.
func TestTurnTracesGoWithTheConversation(t *testing.T) {
	store, id, trace := openTestTrace(t, false)
	trace.stderrLine("something")
	trace.close()

	dir := filepath.Join(store.convDir(id), turnsDirName)
	info, err := os.Stat(filepath.Join(dir, "turn-1700000000000-aaaa.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != traceFilePerm {
		t.Errorf("trace permissions = %o, want %o: it is a verbatim copy of what a turn's process said", perm, traceFilePerm)
	}
	if err := store.delete(id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the traces outlived the conversation: %v", err)
	}
}

// A conversation keeps the last few turns' traces and not every turn there ever was: a trace is
// read about the turn that just went wrong and never about the fortieth one back. The transcript is
// what keeps every turn.
func TestTurnTracesKeepOnlyTheLastFewTurns(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "")
	var last string
	for i := 0; i < maxTurnTraces+5; i++ {
		// Turn ids are `turn-<millis>-<hex>`, so name order is age order.
		last = "turn-17000000000" + string(rune('0'+i/10)) + string(rune('0'+i%10)) + "-aaaa"
		trace := store.openTurnTrace(meta.ID, last, false, nil)
		trace.note("turn " + last)
		trace.close()
	}
	entries, err := os.ReadDir(filepath.Join(store.convDir(meta.ID), turnsDirName))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != maxTurnTraces {
		t.Errorf("traces kept = %d, want %d", len(entries), maxTurnTraces)
	}
	if entries[len(entries)-1].Name() != last+traceFileExt {
		t.Errorf("newest trace = %s, want %s: the oldest are the ones pruned", entries[len(entries)-1].Name(), last)
	}
}

// A trace is never a reason for a turn to fail, so an unwritable state directory answers nil — and
// every method on nil is a no-op rather than a panic.
func TestATraceThatCannotBeOpenedIsNotATurnThatFails(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "")
	// A file where the turns directory would go: MkdirAll cannot make a directory over it.
	mustWrite(t, filepath.Join(store.convDir(meta.ID), turnsDirName), "not a directory")
	if trace := store.openTurnTrace(meta.ID, "turn-1700000000000-aaaa", false, nil); trace != nil {
		t.Fatal("openTurnTrace must answer nothing when it cannot write")
	}

	var absent *turnTrace
	absent.run(traceRun{})
	absent.exec(traceExec{})
	absent.stderrLine("x")
	absent.streamLine(traceOut, "x")
	absent.note("x")
	absent.close()
	if absent.streamKept() {
		t.Error("a trace that does not exist keeps nothing")
	}
	if absent.stderrWriter() != nil {
		t.Error("a trace that does not exist must leave cmd.Stderr on the null device")
	}
}

// Writes after the close are dropped and not failed: the goroutines that write are not the
// goroutine that closes, and a turn stopped mid-stream is exactly when the two race.
func TestWritingToAClosedTraceIsHarmless(t *testing.T) {
	store, id, trace := openTestTrace(t, true)
	trace.stderrLine("before")
	trace.close()
	trace.close() // idempotent
	trace.stderrLine("after")

	records := readTrace(t, store, id)
	if len(records) != 1 || records[0]["text"] != "before" {
		t.Errorf("records = %v, want only what was written before the close", records)
	}
}

// ── the pieces ────────────────────────────────────────────────────────────────

// A process writes when it likes and in whatever sizes it likes, so the writer files whole lines
// and keeps the rest — including the last one, which a process killed mid-sentence never ends.
func TestTraceLineWriterFilesWholeLines(t *testing.T) {
	var got []string
	w := &traceLineWriter{emit: func(line string) { got = append(got, line) }}
	_, _ = w.Write([]byte("one\ntw"))
	_, _ = w.Write([]byte("o\r\nthree, unfinished"))
	if len(got) != 2 || got[0] != "one" || got[1] != "two" {
		t.Fatalf("lines = %v, want the two complete ones with the carriage return trimmed", got)
	}
	w.flush()
	if len(got) != 3 || got[2] != "three, unfinished" {
		t.Errorf("after flush = %v, want the unterminated line filed as what it is", got)
	}
	w.flush() // nothing left
	if len(got) != 3 {
		t.Errorf("a second flush wrote something: %v", got)
	}
}

// What a turn could reach is worth recording; what it authenticated with is not. A value that is a
// `${VAR}` placeholder names a credential without being one, so it is kept as it stands; anything
// else is a value the ledger may have written literally, and a trace is not where it surfaces.
func TestTracedServersNamePlaceholdersAndHideValues(t *testing.T) {
	traced := traceMCPServers([]core.MCPServer{
		{Name: "units", Type: core.MCPStdio, Command: "/opt/kiao-mcp/units", Args: []string{"serve"},
			Env: map[string]string{"KIAO_MCP_TOKEN": "${KIAO_MCP_TURN_TOKEN}", "KIAO_MCP_URL": "http://127.0.0.1:8080"}},
		{Name: "github", Type: core.MCPHTTP, URL: "https://api.example/mcp",
			Headers: map[string]string{"Authorization": "hunter2"}},
	})
	if len(traced) != 2 || traced[0].Name != "github" {
		t.Fatalf("traced servers = %+v, want both in name order", traced)
	}
	if got := traced[0].Headers["Authorization"]; got != "<set>" {
		t.Errorf("a literal header value = %q, want it hidden", got)
	}
	if got := traced[1].Env["KIAO_MCP_TOKEN"]; got != "${KIAO_MCP_TURN_TOKEN}" {
		t.Errorf("a placeholder = %q, want it kept: it names a credential without being one", got)
	}
	if got := traced[1].Env["KIAO_MCP_URL"]; got != "<set>" {
		t.Errorf("a literal environment value = %q, want it hidden", got)
	}
	if traced[1].Command != "/opt/kiao-mcp/units" || len(traced[1].Args) != 1 {
		t.Errorf("stdio server = %+v, want the command a turn would have started", traced[1])
	}
}

// The environment kept is what *this service* added, and not the host's own. The inherited one is
// identical for every turn and is the one place a credential with nothing to do with agents would
// end up in a file.
func TestAddedEnvIsOnlyWhatThisServiceAdded(t *testing.T) {
	env := append(os.Environ(), "CLAUDE_CODE_DISABLE_THINKING=1", "KIAO_MCP_TURN_TOKEN=kiao-turn.x")
	added := addedEnv(env)
	if len(added) != 2 {
		t.Fatalf("added = %v, want only the two this service put there", added)
	}
	if added[0] != "CLAUDE_CODE_DISABLE_THINKING=1" || added[1] != "KIAO_MCP_TURN_TOKEN=kiao-turn.x" {
		t.Errorf("added = %v, want them in name order", added)
	}
	if addedEnv(os.Environ()) != nil {
		t.Error("a process handed the environment unchanged added nothing")
	}
}

// ── a whole turn ──────────────────────────────────────────────────────────────

// claudeStub writes a stand-in for the CLI that says one thing on stderr, answers on stdout in
// stream-json, and exits. It is the same shape as the one the board tests drive, and it is a real
// process because what is being checked here is what happens to the two pipes.
func claudeStub(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	script := "#!/bin/sh\n" +
		"echo 'node:internal/modules: cannot find the settings file' >&2\n" +
		"read -r line\n" +
		`printf '%s\n' '{"type":"system","subtype":"init","session_id":"sess-1"}'` + "\n" +
		`printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'` + "\n" +
		`printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}'` + "\n" +
		`printf '%s\n' '{"type":"result","subtype":"success"}'` + "\n" +
		"cat > /dev/null\n"
	path := filepath.Join(dir, "claude-stub")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// driveOneTurn runs a prompt to its end over the socket, against whatever binary the agent was
// pointed at, and answers the conversation it ran in.
func driveOneTurn(t *testing.T, store *ConversationStore, srv *Service, conversationID string) {
	t.Helper()
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello
	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversationID, "prompt": "hi",
	})
	readUntil(t, conn, "done")
}

// One whole turn, through the real spawn path, leaving one trace: the hub's record of what the turn
// was, the driver's record of how the process was run, and what the CLI wrote to stderr — which
// used to be merged into the stdout pipe, parsed as stream-json, and discarded as a warning.
func TestATurnLeavesATraceOfHowItWasRun(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	srv.hub.agents.set(agentClaude, claudeAgentAt(cfg, claudeStub(t)))
	conversation := mustCreateConversation(t, store, "")
	driveOneTurn(t, store, srv, conversation.ID)

	records := readTrace(t, store, conversation.ID)
	run := ofKind(records, traceKindRun)
	if len(run) != 1 {
		t.Fatalf("run records = %d, want the one the hub wrote before the spawn", len(run))
	}
	if run[0]["conversation"] != conversation.ID || run[0]["agent"] != agentClaude {
		t.Errorf("run record = %v, want it naming the conversation and its agent", run[0])
	}
	if run[0]["permissionMode"] != permissionModeBypass || run[0]["allowBypass"] != true {
		t.Errorf("run record = %v, want the mode and the deployment's permission", run[0])
	}

	exec := ofKind(records, traceKindExec)
	if len(exec) != 1 {
		t.Fatalf("exec records = %d, want the one the driver wrote", len(exec))
	}
	argv, _ := exec[0]["argv"].([]any)
	if len(argv) == 0 || !strings.Contains(strings.Join(asStrings(argv), " "), "--output-format stream-json") {
		t.Errorf("argv = %v, want the invocation the CLI was actually given", exec[0]["argv"])
	}
	if exec[0]["pid"] == nil {
		t.Errorf("exec record = %v, want the pid of the process that ran", exec[0])
	}

	stderr := ofKind(records, traceKindStderr)
	if len(stderr) != 1 || !strings.Contains(stderr[0]["text"].(string), "cannot find the settings file") {
		t.Fatalf("stderr records = %v, want the line the CLI wrote there", stderr)
	}
	// The stream is off by default, so the same turn keeps none of the protocol.
	if got := ofKind(records, traceKindStream); len(got) != 0 {
		t.Errorf("stream records = %d, want none until the conversation asks", len(got))
	}
	// And the reply is unaffected: the stderr line no longer reaches the stream-json parser.
	messages := mustMessages(t, store, conversation.ID)
	if len(messages) != 2 || messages[1].blockText() != "ok" {
		t.Errorf("transcript = %+v, want the prompt and the reply", messages)
	}
}

func asStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if s, ok := value.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// With the switch on, the same turn keeps the whole exchange — including the `user` event the
// driver has no case for, which is dropped everywhere else in this store.
func TestTheStreamSwitchKeepsWhatTheDriverDrops(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	srv.hub.agents.set(agentClaude, claudeAgentAt(cfg, claudeStub(t)))
	conversation := mustCreateConversation(t, store, "")
	if _, err := store.update(conversation.ID, func(meta *conversationMeta) {
		meta.TraceStream = true
	}); err != nil {
		t.Fatal(err)
	}
	driveOneTurn(t, store, srv, conversation.ID)

	stream := ofKind(readTrace(t, store, conversation.ID), traceKindStream)
	var out, in []string
	for _, rec := range stream {
		if rec["dir"] == traceOut {
			out = append(out, rec["text"].(string))
		} else {
			in = append(in, rec["text"].(string))
		}
	}
	joined := strings.Join(out, "\n")
	for _, want := range []string{`"type":"system"`, `"type":"assistant"`, `"type":"user"`, `"type":"result"`} {
		if !strings.Contains(joined, want) {
			t.Errorf("the stream is missing %s:\n%s", want, joined)
		}
	}
	if len(in) == 0 || !strings.Contains(strings.Join(in, "\n"), `"role":"user"`) {
		t.Errorf("what was said *to* the agent = %v, want the prompt frame", in)
	}
}

// ── the other two agents ──────────────────────────────────────────────────────

// Codex already kept its stderr, twenty lines deep in memory, to name the sentence a turn died on.
// The trace is where the rest of what it said goes — and its argument list with it, which is the
// one place this CLI's whole turn is spelled out.
func TestCodexWritesItsStderrAndItsArgumentsToTheTrace(t *testing.T) {
	store, id, trace := openTestTrace(t, true)
	dir := t.TempDir()
	binary := filepath.Join(dir, "codex-stub")
	script := "#!/bin/sh\n" +
		"cat > /dev/null\n" +
		"echo 'stream error: unexpected status 401' >&2\n" +
		`printf '%s\n' '{"type":"thread.started","thread_id":"th-1"}'` + "\n" +
		"exit 1\n"
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	driver := &codexDriver{binary: binary, events: make(chan AgentEvent)}
	if err := driver.Spawn(AgentRun{
		Prompt: "hi", WorkDir: dir, PermissionMode: permissionModeBypass, AllowBypass: true,
		Trace: trace,
	}); err != nil {
		t.Fatalf("Spawn = %v", err)
	}
	for range driver.Events() {
	}
	trace.close()

	records := readTrace(t, store, id)
	if stderr := ofKind(records, traceKindStderr); len(stderr) != 1 ||
		!strings.Contains(stderr[0]["text"].(string), "401") {
		t.Errorf("stderr records = %v, want the line the CLI wrote there", stderr)
	}
	if exec := ofKind(records, traceKindExec); len(exec) != 1 {
		t.Errorf("exec records = %v, want the one the driver wrote", exec)
	}
	// Both directions: the prompt went in on stdin, so it is the one thing a recorded argv cannot
	// show, and the thread event came back on stdout.
	var in, out []string
	for _, rec := range ofKind(records, traceKindStream) {
		if rec["dir"] == traceIn {
			in = append(in, rec["text"].(string))
		} else {
			out = append(out, rec["text"].(string))
		}
	}
	if len(in) != 1 || in[0] != "hi" {
		t.Errorf("what was said to the CLI = %v, want the prompt that went in on stdin", in)
	}
	if len(out) != 1 || !strings.Contains(out[0], "thread.started") {
		t.Errorf("what the CLI said = %v, want the raw frame", out)
	}
}

// A Muse host that dies of a bad configuration used to say so to nobody: its stderr was the null
// device, so the whole of what the turn got was a refusal with no reason in it. The trace is now
// the only place that sentence exists.
func TestAMuseHostThatDiesSaysSoInTheTrace(t *testing.T) {
	store, id, trace := openTestTrace(t, false)
	dir := t.TempDir()
	binary := filepath.Join(dir, "muse-stub")
	script := "#!/bin/sh\necho 'error: settings.json is not valid JSON' >&2\nexit 1\n"
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := spawnMSP(context.Background(), binary, museServeArgs(), dir, os.Environ(), trace); err == nil {
		t.Fatal("the handshake must fail when the host exits at once")
	}
	trace.close()

	stderr := ofKind(readTrace(t, store, id), traceKindStderr)
	if len(stderr) != 1 || !strings.Contains(stderr[0]["text"].(string), "not valid JSON") {
		t.Fatalf("stderr records = %v, want what the host said before it died", stderr)
	}
}

// The host answering the model catalogue is not a turn, so it has no trace to be keyed by — and it
// keeps the null device it always had rather than writing into somebody else's file.
func TestTheOptionsHostIsNotTraced(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "muse-stub")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := spawnMSP(context.Background(), binary, museServeArgs(), dir, os.Environ(), nil); err == nil {
		t.Fatal("the handshake must fail when the host exits at once")
	}
}
