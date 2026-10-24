package runnerhttp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	pkgSync "sync"
	"testing"
	"time"
)

// TestSubscribeToUnknownConversationAnswersNotRunning verifies the upgrade handshake, the
// unprompted `hello`, and the subscribe→not_running reply for a conversation with no turn. That
// reply is the normal state of an idle conversation rather than an error: history comes from REST,
// and the socket only ever carries the live turn.
func TestSubscribeToUnknownConversationAnswersNotRunning(t *testing.T) {
	withCLIsOnPath(t, "claude")
	srv := newSocketTestServer(t, nil)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	hello := readFrame(t, conn)
	if hello["type"] != "hello" {
		t.Fatalf("first frame = %v, want the unprompted hello", hello["type"])
	}
	if version, _ := hello["protocolVersion"].(float64); int(version) != pkgTurns.AgentProtocolVersion {
		t.Errorf("protocolVersion = %v, want %d", hello["protocolVersion"], pkgTurns.AgentProtocolVersion)
	}
	// Which agents this deployment offers, the default first: a tab knows on connect whether there
	// is a choice to draw at all, without asking /hybridflow-runner/options for the heavier answer. This host
	// has one CLI, so the list is one long — the list is what is on the machine, not what the build
	// knows how to drive.
	if agents, _ := hello["agents"].([]any); len(agents) != 1 || agents[0] != agentapi.AgentClaude {
		t.Errorf("hello agents = %v, want the one agent this deployment offers, the default first", hello["agents"])
	}

	sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{"does-not-exist"}})
	msg := readFrame(t, conn)
	if msg["type"] != "not_running" {
		t.Errorf("subscribe to an idle conversation: got %v, want not_running", msg["type"])
	}
	if msg["conversationId"] != "does-not-exist" {
		t.Errorf("conversationId = %v, want the id that was subscribed to", msg["conversationId"])
	}
}

// TestWebSocketRequiresAuthInProd ensures the WS endpoint is gated by the same role check as the
// REST endpoints when not in debug mode.
func TestWebSocketRequiresAuthInProd(t *testing.T) {
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "prod", RootPath: t.TempDir(),
		IssuerURI: "https://issuer.example/realms/kiao", JwkSetURI: "https://issuer.example/jwks"}}
	hub := assembly.NewEngine(cfg, nil)
	srv := &Service{cfg: cfg, hub: hub}
	srv.bindAgents(hub.Agents)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws/claude"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected unauthenticated WS dial to fail")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		got := 0
		if resp != nil {
			got = resp.StatusCode
		}
		t.Errorf("unauthenticated WS: status = %d, want 401", got)
	}
}

// TestClaudeHubShutdownKillsJobs verifies shutdown() empties the registry and stops the agent of a
// running turn.
func TestClaudeHubShutdownKillsJobs(t *testing.T) {
	h := assembly.NewEngine(&runnerconfig.Config{}, nil)
	driver := &stubDriver{events: make(chan agentapi.AgentEvent)}
	driver.drain()
	h.PutJob("c1", &pkgTurns.Turn{ConversationID: "c1", Driver: driver})

	h.Shutdown()

	if h.GetJob("c1") != nil {
		t.Errorf("shutdown should drop turns from the registry")
	}
	if !driver.wasStopped() {
		t.Errorf("shutdown should stop the agent of a running turn")
	}
}

// TestClaudeHubEvictsFinishedJobs checks the janitor sweep: a settled turn past its TTL is evicted
// (the leak this fixes), a recently settled one survives, a running one is untouched.
func TestClaudeHubEvictsFinishedJobs(t *testing.T) {
	h := assembly.NewEngine(&runnerconfig.Config{}, nil)
	h.JobTTL = 10 * time.Millisecond

	h.PutJob("stale", &pkgTurns.Turn{ConversationID: "stale", IsDone: true, FinishedAt: time.Now().Add(-time.Hour)})
	h.PutJob("fresh", &pkgTurns.Turn{ConversationID: "fresh", IsDone: true, FinishedAt: time.Now()})
	h.PutJob("running", &pkgTurns.Turn{ConversationID: "running", IsDone: false})

	h.SweepExpiredJobs(time.Now())

	if h.GetJob("stale") != nil {
		t.Errorf("settled turn past TTL should be evicted")
	}
	if h.GetJob("fresh") == nil {
		t.Errorf("recently settled turn should survive within TTL")
	}
	if h.GetJob("running") == nil {
		t.Errorf("running turn must never be evicted")
	}
}

// TestClaudeHubActiveTurnCount confirms only unfinished turns count toward the concurrency cap.
func TestClaudeHubActiveTurnCount(t *testing.T) {
	h := assembly.NewEngine(&runnerconfig.Config{}, nil)
	h.PutJob("a", &pkgTurns.Turn{ConversationID: "a", IsDone: false})
	h.PutJob("b", &pkgTurns.Turn{ConversationID: "b", IsDone: true, FinishedAt: time.Now()})
	h.PutJob("c", &pkgTurns.Turn{ConversationID: "c", IsDone: false})
	if n := h.ActiveTurnCount(); n != 2 {
		t.Errorf("activeTurnCount = %d, want 2 (settled turns excluded)", n)
	}
}

// stdinRecorder stands in for the CLI's stdin pipe and keeps the frames written to it.
type stdinRecorder struct {
	mu     pkgSync.Mutex
	buf    bytes.Buffer
	closed bool
}

func (r *stdinRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.buf.Write(p)
}

func (r *stdinRecorder) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	return nil
}

func (r *stdinRecorder) isClosed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

// frames decodes the newline-delimited JSON written so far.
func (r *stdinRecorder) frames(t *testing.T) []map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(r.buf.String()), "\n") {
		if line == "" {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			t.Fatalf("stdin frame %q is not JSON: %v", line, err)
		}
		out = append(out, frame)
	}
	return out
}

// canUseToolEvent is the CLI's ask, as it arrives on stdout.
func canUseToolEvent(requestID string) map[string]any {
	return map[string]any{
		"type":       "control_request",
		"request_id": requestID,
		"request": map[string]any{
			"subtype":      "can_use_tool",
			"tool_name":    "Edit",
			"display_name": "Edit",
			"description":  "notes.md",
			"tool_use_id":  "toolu_1",
			"input":        map[string]any{"file_path": "notes.md", "old_string": "a", "new_string": "b"},
		},
	}
}

func newPermissionTestJob() (*pkgTurns.Engine, *pkgTurns.Turn, *stdinRecorder) {
	return newPermissionTestJobIn(runnerconfig.PermissionModeManual)
}

// newPermissionTestJobIn is the same turn in a mode of the test's choosing, for the one thing the
// two manual modes do differently: `manualLive` puts a clock on every card.
func newPermissionTestJobIn(mode string) (*pkgTurns.Engine, *pkgTurns.Turn, *stdinRecorder) {
	rec := &stdinRecorder{}
	job := &pkgTurns.Turn{
		ConversationID: "c1", TurnID: "turn-1", Owner: "tester", PermissionMode: mode,
		Driver: &claudecli.ClaudeDriver{Stdin: rec},
	}
	h := assembly.NewEngine(&runnerconfig.Config{}, nil)
	// Short enough to watch, long enough that a test which means to answer first still can.
	h.AutoAllowDelay = 40 * time.Millisecond
	h.PutJob(job.ConversationID, job)
	return h, job, rec
}

// TestManualLiveAllowsACardNobodyAnswered is the promise of the mode with no client at all: the
// card is shown, the live delay passes, and the tool call runs as though the button had been clicked.
func TestManualLiveAllowsACardNobodyAnswered(t *testing.T) {
	h, job, rec := newPermissionTestJobIn(runnerconfig.PermissionModeManualLive)

	feed(h, t, job, canUseToolEvent("req-1"))

	job.Mu.Lock()
	pending := len(job.Pending)
	deadline, _ := job.Pending[0].Message["decideAt"].(int64)
	job.Mu.Unlock()
	if pending != 1 {
		t.Fatalf("pending = %d, want the card put up before it is decided", pending)
	}
	// The deadline travels on the frame: every tab watching counts down to the same moment, and a
	// client that shows no countdown at all still shows a card that is about to be allowed.
	if deadline <= time.Now().UnixMilli() {
		t.Errorf("decideAt = %d, want the moment the service will decide", deadline)
	}

	waitFrames(t, rec, 1)
	response, _ := rec.frames(t)[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	if inner["behavior"] != "allow" {
		t.Errorf("decision = %v, want the card allowed by the countdown", inner)
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	if len(job.Pending) != 0 {
		t.Errorf("pending = %d, want the request taken off the set it was answered from", len(job.Pending))
	}
}

// A card answered before the count runs out is answered once: the countdown has nothing left to
// allow, and the CLI is never written to twice for one request.
func TestManualLiveCountdownIsSpentByADecision(t *testing.T) {
	h, job, rec := newPermissionTestJobIn(runnerconfig.PermissionModeManualLive)
	feed(h, t, job, canUseToolEvent("req-1"))

	h.HandlePermissionDecision(nil, access.Identity{User: "tester"}, pkgTurns.Command{
		Type: "permission_decision", ConversationID: "c1", RequestID: "req-1",
		Behavior: "deny", Message: "not that file",
	})
	time.Sleep(3 * h.AutoAllowDelay)

	frames := rec.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want the one decision: %v", len(frames), frames)
	}
	response, _ := frames[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	if inner["behavior"] != "deny" {
		t.Errorf("decision = %v, want the refusal that got in first", inner)
	}
}

// `manual` has no clock at all: nothing runs without a human, however long that takes.
func TestManualWaitsForeverForAHuman(t *testing.T) {
	h, job, rec := newPermissionTestJobIn(runnerconfig.PermissionModeManual)

	feed(h, t, job, canUseToolEvent("req-1"))
	time.Sleep(3 * h.AutoAllowDelay)

	job.Mu.Lock()
	defer job.Mu.Unlock()
	if _, counted := job.Pending[0].Message["decideAt"]; counted {
		t.Error("a manual card must not say it will be decided: nothing decides it but a human")
	}
	if len(rec.frames(t)) != 0 {
		t.Errorf("wrote %v, want a manual card left waiting", rec.frames(t))
	}
}

// A question is never counted down, in any mode: `manualLive` allows a call it can guess the answer
// to, and there is nothing to guess in a question put to the user.
func TestManualLiveNeverAnswersAQuestion(t *testing.T) {
	h, job, rec := newPermissionTestJobIn(runnerconfig.PermissionModeManualLive)
	ask := canUseToolEvent("req-1")
	request, _ := ask["request"].(map[string]any)
	request["tool_name"] = runnerconfig.ClaudeAskQuestionTool
	request["input"] = map[string]any{"questions": []any{
		map[string]any{"question": "Which way?", "options": []any{map[string]any{"label": "This one"}}},
	}}

	feed(h, t, job, ask)
	time.Sleep(3 * h.AutoAllowDelay)

	job.Mu.Lock()
	defer job.Mu.Unlock()
	if len(job.Pending) != 1 || len(rec.frames(t)) != 0 {
		t.Errorf("pending = %d, wrote %v; want the question still waiting for its answer",
			len(job.Pending), rec.frames(t))
	}
	if _, counted := job.Pending[0].Message["decideAt"]; counted {
		t.Error("a question must not carry a countdown: guessing an answer puts words in the user's mouth")
	}
}

// waitFrames waits for the CLI to have been written to, so a countdown can be watched without
// sleeping for a fixed stretch and hoping.
func waitFrames(t *testing.T, rec *stdinRecorder, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(rec.frames(t)) < want {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %d frames on the CLI's stdin", want)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// TestPermissionRequestBecomesPending checks the relay: a can_use_tool ask is remembered under its
// request id, with the fields the client renders — and its input summarised rather than raw.
func TestPermissionRequestBecomesPending(t *testing.T) {
	h, job, _ := newPermissionTestJob()

	feed(h, t, job, canUseToolEvent("req-1"))

	if len(job.Pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(job.Pending))
	}
	msg := job.Pending[0].Message
	for key, want := range map[string]any{
		"type": "permission_request", "requestId": "req-1", "toolName": "Edit",
		"displayName": "Edit", "description": "notes.md", "toolUseId": "toolu_1",
	} {
		if msg[key] != want {
			t.Errorf("permission_request[%q] = %v, want %v", key, msg[key], want)
		}
	}
	if input, _ := msg["input"].(string); !strings.Contains(input, "new_string") {
		t.Errorf("permission_request input = %q, want the tool input", input)
	}
	// The retained request is emitted as a copy, so `sync` replaying it cannot race the stamp emit
	// writes into the frame it is handed.
	if _, stamped := msg["conversationId"]; stamped {
		t.Error("the retained permission request was stamped in place; it must be emitted as a copy")
	}
}

// TestPermissionAllowEchoesInput is the contract with the CLI: an allowed call runs with the input
// we hand back, so it must be the original input and not the summary shown to the user.
func TestPermissionAllowEchoesInput(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, canUseToolEvent("req-1"))

	h.HandlePermissionDecision(nil, access.Identity{User: "tester"},
		pkgTurns.Command{Type: "permission_decision", ConversationID: "c1", RequestID: "req-1", Behavior: "allow"})

	frames := rec.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want 1", len(frames))
	}
	response, _ := frames[0]["response"].(map[string]any)
	if frames[0]["type"] != "control_response" || response["subtype"] != "success" || response["request_id"] != "req-1" {
		t.Fatalf("frame = %v, want a success control_response for req-1", frames[0])
	}
	inner, _ := response["response"].(map[string]any)
	if inner["behavior"] != "allow" {
		t.Errorf("behavior = %v, want allow", inner["behavior"])
	}
	updated, _ := inner["updatedInput"].(map[string]any)
	if updated["new_string"] != "b" || updated["file_path"] != "notes.md" {
		t.Errorf("updatedInput = %v, want the tool input verbatim", updated)
	}
	if len(job.Pending) != 0 {
		t.Errorf("pending = %d after a decision, want 0", len(job.Pending))
	}
}

// TestPermissionDenyCarriesReason checks the deny frame, whose message is what the model is told.
func TestPermissionDenyCarriesReason(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, canUseToolEvent("req-1"))

	h.HandlePermissionDecision(nil, access.Identity{User: "tester"}, pkgTurns.Command{
		Type: "permission_decision", ConversationID: "c1", RequestID: "req-1",
		Behavior: "deny", Message: "not that file",
	})

	response, _ := rec.frames(t)[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	if inner["behavior"] != "deny" || inner["message"] != "not that file" {
		t.Errorf("deny frame = %v, want the user's reason", inner)
	}
	if _, ok := inner["updatedInput"]; ok {
		t.Errorf("deny frame = %v, must not carry updatedInput", inner)
	}
	_ = job
}

// TestPermissionDecisionIgnoresUnanswerable covers the frames that must never reach the CLI: a
// second answer to the same request, an unknown request or conversation, and a behavior that is
// neither.
func TestPermissionDecisionIgnoresUnanswerable(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, canUseToolEvent("req-1"))
	id := access.Identity{User: "tester"}

	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "req-1", Behavior: "maybe"})
	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "other", Behavior: "allow"})
	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "no-such-conversation", RequestID: "req-1", Behavior: "allow"})
	if frames := rec.frames(t); len(frames) != 0 {
		t.Fatalf("wrote %d frames, want none: %v", len(frames), frames)
	}

	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "req-1", Behavior: "allow"})
	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "req-1", Behavior: "deny"})
	if frames := rec.frames(t); len(frames) != 1 {
		t.Errorf("answering twice wrote %d frames, want 1", len(frames))
	}
	if len(job.Pending) != 0 {
		t.Errorf("pending = %d, want 0", len(job.Pending))
	}
}

// askQuestionEvent is the CLI asking the user something, as it arrives on stdout: an ordinary
// can_use_tool request whose tool is AskUserQuestion and whose input carries the questions.
func askQuestionEvent(requestID string) map[string]any {
	return map[string]any{
		"type":       "control_request",
		"request_id": requestID,
		"request": map[string]any{
			"subtype":     "can_use_tool",
			"tool_name":   runnerconfig.ClaudeAskQuestionTool,
			"tool_use_id": "toolu_2",
			"input": map[string]any{"questions": []any{
				map[string]any{
					"question": "Tabs or spaces?",
					"header":   "Indent",
					"options": []any{
						map[string]any{"label": "Tabs", "description": "Tab characters", "preview": "\tcode"},
						map[string]any{"label": "Spaces", "description": "Space characters"},
					},
				},
				map[string]any{
					"question":    "Which languages?",
					"header":      "Languages",
					"multiSelect": true,
					"options": []any{
						map[string]any{"label": "Go"},
						map[string]any{"label": "TypeScript"},
					},
				},
			}},
		},
	}
}

// TestQuestionRequestBecomesPending: an AskUserQuestion ask is relayed on its own frame, with the
// questions structured for a card to render rather than dumped as a blob of JSON.
func TestQuestionRequestBecomesPending(t *testing.T) {
	h, job, _ := newPermissionTestJob()

	feed(h, t, job, askQuestionEvent("req-q"))

	if len(job.Pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(job.Pending))
	}
	perm := job.Pending[0]
	if !perm.IsQuestion() {
		t.Fatal("the ask was held as a permission, want a question")
	}
	msg := perm.Message
	if msg["type"] != "question_request" || msg["requestId"] != "req-q" || msg["toolUseId"] != "toolu_2" {
		t.Fatalf("frame = %v, want a question_request for req-q", msg)
	}
	if _, summarised := msg["input"]; summarised {
		t.Error("a question frame must not carry the permission card's input summary")
	}
	questions, _ := msg["questions"].([]map[string]any)
	if len(questions) != 2 {
		t.Fatalf("questions = %v, want the two that were asked", questions)
	}
	if questions[0]["question"] != "Tabs or spaces?" || questions[0]["header"] != "Indent" {
		t.Errorf("first question = %v, want the text and its header", questions[0])
	}
	if _, multi := questions[0]["multiSelect"]; multi {
		t.Errorf("first question = %v, want no multiSelect on a single-choice question", questions[0])
	}
	if questions[1]["multiSelect"] != true {
		t.Errorf("second question = %v, want multiSelect", questions[1])
	}
	options, _ := questions[0]["options"].([]map[string]any)
	if len(options) != 2 || options[0]["label"] != "Tabs" || options[0]["preview"] != "\tcode" {
		t.Errorf("options = %v, want the labels with their descriptions and preview", options)
	}
}

// TestQuestionAnswerReachesTheCLI is the contract with the tool: the answers ride back in on an
// allow, keyed by question text, and the questions themselves go back exactly as they came.
func TestQuestionAnswerReachesTheCLI(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, askQuestionEvent("req-q"))

	h.HandleQuestionAnswer(nil, access.Identity{User: "tester"}, pkgTurns.Command{
		Type: "question_answer", ConversationID: "c1", RequestID: "req-q",
		Answers: []string{"Tabs", "Go, TypeScript"},
	})

	frames := rec.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want 1", len(frames))
	}
	response, _ := frames[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	if response["request_id"] != "req-q" || inner["behavior"] != "allow" {
		t.Fatalf("frame = %v, want an allow for req-q", frames[0])
	}
	updated, _ := inner["updatedInput"].(map[string]any)
	answers, _ := updated["answers"].(map[string]any)
	if answers["Tabs or spaces?"] != "Tabs" || answers["Which languages?"] != "Go, TypeScript" {
		t.Errorf("answers = %v, want each answer under its own question", answers)
	}
	if _, kept := updated["questions"]; !kept {
		t.Error("updatedInput lost the questions; the CLI validates it against the tool's schema")
	}
	// The preview of the option that was picked goes back with it: the model wrote those to be
	// compared, so which one the answer refers to is part of the answer.
	annotations, _ := updated["annotations"].(map[string]any)
	first, _ := annotations["Tabs or spaces?"].(map[string]any)
	if first["preview"] != "\tcode" {
		t.Errorf("annotations = %v, want the chosen option's preview", annotations)
	}
	if _, unpicked := annotations["Which languages?"]; unpicked {
		t.Errorf("annotations = %v, want none for an answer with no preview", annotations)
	}
	if len(job.Pending) != 0 {
		t.Errorf("pending = %d after an answer, want 0", len(job.Pending))
	}
}

// TestQuestionDismissedSendsNoAnswers: a dismissed card is answered rather than left parking the
// turn, and what it sends is an empty map — which is what tells the model it was not answered.
func TestQuestionDismissedSendsNoAnswers(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, askQuestionEvent("req-q"))

	h.HandleQuestionAnswer(nil, access.Identity{User: "tester"}, pkgTurns.Command{
		ConversationID: "c1", RequestID: "req-q", Answers: []string{"", "  "},
	})

	response, _ := rec.frames(t)[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	updated, _ := inner["updatedInput"].(map[string]any)
	if answers, _ := updated["answers"].(map[string]any); len(answers) != 0 {
		t.Errorf("answers = %v, want none", answers)
	}
	if _, annotated := updated["annotations"]; annotated {
		t.Error("an unanswered card must annotate nothing")
	}
	if len(job.Pending) != 0 {
		t.Errorf("pending = %d, want 0", len(job.Pending))
	}
}

// TestQuestionAndPermissionFramesDoNotCross: each kind is answered by its own frame. Allowing a
// question through the permission path would run the tool without the answers it was called for,
// and answering a permission with a question answer would hand the CLI an input of the wrong shape.
func TestQuestionAndPermissionFramesDoNotCross(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, askQuestionEvent("req-q"))
	feed(h, t, job, canUseToolEvent("req-1"))
	id := access.Identity{User: "tester"}

	h.HandlePermissionDecision(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "req-q", Behavior: "allow"})
	h.HandleQuestionAnswer(nil, id, pkgTurns.Command{ConversationID: "c1", RequestID: "req-1", Answers: []string{"Tabs"}})

	if frames := rec.frames(t); len(frames) != 0 {
		t.Fatalf("wrote %d frames, want none: %v", len(frames), frames)
	}
	if len(job.Pending) != 2 {
		t.Errorf("pending = %d, want both asks still waiting", len(job.Pending))
	}
}

// TestSyncSeparatesQuestionsFromPermissions: a tab that subscribes mid-turn gets both back, and it
// has to be able to tell them apart — they are answered by different frames.
func TestSyncSeparatesQuestionsFromPermissions(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	feed(h, t, job, canUseToolEvent("req-1"))
	feed(h, t, job, askQuestionEvent("req-q"))

	frame := h.SyncFrame(job)
	permissions, _ := frame["pendingPermissions"].([]map[string]any)
	questions, _ := frame["pendingQuestions"].([]map[string]any)
	if len(permissions) != 1 || permissions[0]["requestId"] != "req-1" {
		t.Errorf("pendingPermissions = %v, want the permission alone", permissions)
	}
	if len(questions) != 1 || questions[0]["requestId"] != "req-q" {
		t.Errorf("pendingQuestions = %v, want the question alone", questions)
	}
}

// TestBypassAllowsToolCallsButStillAsksQuestions: the prompt surface is installed in every mode
// now, so a bypass turn can reach the user with a question. It must not reach them with anything
// else — the mode's whole promise is that no tool call is put to them.
func TestBypassAllowsToolCallsButStillAsksQuestions(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	job.PermissionMode = runnerconfig.PermissionModeBypass

	feed(h, t, job, canUseToolEvent("req-1"))
	if len(job.Pending) != 0 {
		t.Errorf("a bypass turn parked on a permission request: %v", job.Pending)
	}
	frames := rec.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want the tool call allowed unasked", len(frames))
	}
	response, _ := frames[0]["response"].(map[string]any)
	inner, _ := response["response"].(map[string]any)
	updated, _ := inner["updatedInput"].(map[string]any)
	if inner["behavior"] != "allow" || updated["file_path"] != "notes.md" {
		t.Errorf("frame = %v, want an allow carrying the tool input", inner)
	}

	feed(h, t, job, askQuestionEvent("req-q"))
	if len(job.Pending) != 1 || !job.Pending[0].IsQuestion() {
		t.Errorf("pending = %v, want the question waiting for the user", job.Pending)
	}
}

// TestOnlyAskUserQuestionBecomesAQuestion: the question card is chosen by the tool that asked, not
// by the shape of its input. Another tool that happened to take a list of questions would otherwise
// be answered with an `answers` map its own schema has never heard of.
func TestOnlyAskUserQuestionBecomesAQuestion(t *testing.T) {
	h, job, _ := newPermissionTestJob()

	event := askQuestionEvent("req-q")
	request, _ := event["request"].(map[string]any)
	request["tool_name"] = "SomeOtherTool"
	feed(h, t, job, event)

	if len(job.Pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(job.Pending))
	}
	if job.Pending[0].IsQuestion() {
		t.Error("a tool that is not AskUserQuestion was held as a question")
	}
}

// TestMalformedQuestionFallsBackToAPermission: an ask this service cannot render as a question is
// still shown, as the permission card it would have been. Refusing to render it would park the turn
// on a question nobody can see or dismiss.
func TestMalformedQuestionFallsBackToAPermission(t *testing.T) {
	h, job, _ := newPermissionTestJob()

	event := askQuestionEvent("req-q")
	request, _ := event["request"].(map[string]any)
	request["input"] = map[string]any{"questions": []any{map[string]any{"header": "Indent"}}}
	feed(h, t, job, event)

	if len(job.Pending) != 1 {
		t.Fatalf("pending = %d, want 1", len(job.Pending))
	}
	if job.Pending[0].IsQuestion() {
		t.Error("a question with nothing to ask was held as one")
	}
	if job.Pending[0].Message["type"] != "permission_request" {
		t.Errorf("frame = %v, want a permission_request", job.Pending[0].Message)
	}
}

// TestUnsupportedControlRequestIsRefused: an ask this service cannot surface still has to be
// answered, or the CLI waits on it forever.
func TestUnsupportedControlRequestIsRefused(t *testing.T) {
	h, job, rec := newPermissionTestJob()

	feed(h, t, job, map[string]any{
		"type": "control_request", "request_id": "req-9",
		"request": map[string]any{"subtype": "request_user_dialog"},
	})

	frames := rec.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames, want 1", len(frames))
	}
	response, _ := frames[0]["response"].(map[string]any)
	if response["subtype"] != "error" || response["request_id"] != "req-9" {
		t.Errorf("frame = %v, want an error control_response for req-9", frames[0])
	}
	if len(job.Pending) != 0 {
		t.Errorf("an unsupported control request must not become pending, got %d", len(job.Pending))
	}
}

// TestPermissionCancelledByCLI drops a withdrawn request, so no answer is later written for it.
func TestPermissionCancelledByCLI(t *testing.T) {
	h, job, rec := newPermissionTestJob()
	feed(h, t, job, canUseToolEvent("req-1"))

	feedLine(h, t, job, `{"type":"control_cancel_request","request_id":"req-1"}`)
	if len(job.Pending) != 0 {
		t.Fatalf("pending = %d after a cancel, want 0", len(job.Pending))
	}

	h.HandlePermissionDecision(nil, access.Identity{User: "tester"},
		pkgTurns.Command{ConversationID: "c1", RequestID: "req-1", Behavior: "allow"})
	if frames := rec.frames(t); len(frames) != 0 {
		t.Errorf("a withdrawn request was answered: %v", frames)
	}
}

// TestResultEventClosesStdin pins the lifecycle that keeps stream-json input from hanging: the CLI
// waits for another frame after a turn, so `result` is what has to end its input.
func TestResultEventClosesStdin(t *testing.T) {
	h, job, rec := newPermissionTestJob()

	feedLine(h, t, job, `{"type":"result","is_error":false}`)

	if !rec.isClosed() {
		t.Error("the result event must close the CLI's stdin, or the process never exits")
	}
	if err := job.Agent().Answer("req-1", agentapi.AskDecision{Allow: true}); err == nil {
		t.Error("answering after close should fail rather than silently succeed")
	}
}

// TestSubscribeReplaysPendingPermissions: subscribing to a turn blocked on a permission has to
// surface the request again — otherwise a page reload leaves the turn parked with nobody asked.
func TestSubscribeReplaysPendingPermissions(t *testing.T) {
	srv := newSocketTestServer(t, nil)
	job := &pkgTurns.Turn{
		ConversationID: "blocked", TurnID: "turn-1", Owner: "tester",
		Driver: &claudecli.ClaudeDriver{Stdin: &stdinRecorder{}}, PromptText: "do it",
		Blocks:         []agentapi.TurnBlock{{Kind: agentapi.BlockKindText, Text: "working…"}},
		PermissionMode: runnerconfig.PermissionModeManualLive,
		StartedAt:      time.Now(),
	}
	srv.hub.PutJob(job.ConversationID, job)
	feed(srv.hub, t, job, canUseToolEvent("req-1"))

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{"blocked"}})
	msg := readFrame(t, conn)
	if msg["type"] != "sync" {
		t.Fatalf("subscribe reply = %v, want sync", msg["type"])
	}
	if msg["conversationId"] != "blocked" || msg["turnId"] != "turn-1" {
		t.Errorf("sync = %v, want both ids so the client can route and fence it", msg)
	}
	if msg["userText"] != "do it" || syncBlockText(msg) != "working…" {
		t.Errorf("sync = %v, want the prompt and the whole reply so far", msg)
	}
	pending, _ := msg["pendingPermissions"].([]any)
	if len(pending) != 1 {
		t.Fatalf("sync carried %d pending permissions, want 1: %v", len(pending), msg["pendingPermissions"])
	}
	first, _ := pending[0].(map[string]any)
	if first["requestId"] != "req-1" || first["type"] != "permission_request" {
		t.Errorf("replayed request = %v, want the permission_request for req-1", first)
	}
	// How the replayed cards are to be treated travels with them: the conversation record only
	// learns the turn's mode when it settles, so a tab reconnecting mid-turn has nowhere else to
	// read it — and in `manualLive` that is the difference between a card that counts down and one
	// that parks the turn.
	if msg["permissionMode"] != runnerconfig.PermissionModeManualLive {
		t.Errorf("sync permissionMode = %v, want the mode the turn runs in", msg["permissionMode"])
	}
}

// blockWatcher is a socket subscribed to one hand-made turn: the frames its blocks produce, without
// a CLI process to produce them.
type blockWatcher struct {
	hub  *pkgTurns.Engine
	job  *pkgTurns.Turn
	conn *websocket.Conn
}

func newBlockWatcher(t *testing.T) *blockWatcher {
	t.Helper()
	srv := newSocketTestServer(t, nil)
	job := &pkgTurns.Turn{
		ConversationID: "conv-a", TurnID: "turn-1",
		Driver: &claudecli.ClaudeDriver{Stdin: &stdinRecorder{}}, StartedAt: time.Now(),
	}
	srv.hub.PutJob(job.ConversationID, job)

	ts := httptest.NewServer(srv.handler())
	t.Cleanup(ts.Close)
	conn := dialClaude(t, ts.URL)
	t.Cleanup(func() { conn.Close() })

	readFrame(t, conn) // hello
	sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{job.ConversationID}})
	readFrame(t, conn) // sync
	return &blockWatcher{hub: srv.hub, job: job, conn: conn}
}

// frames reads the next n frames as "<type>[index] <kind|name>: <data|input>", which is short enough
// to write the expectation out in full — and a diff on it says which frame went wrong.
func (w *blockWatcher) frames(t *testing.T, n int) []string {
	t.Helper()
	got := make([]string, 0, n)
	for i := 0; i < n; i++ {
		msg := readFrame(t, w.conn)
		index, _ := msg["index"].(float64)
		switch msg["type"] {
		case "output":
			got = append(got, fmt.Sprintf("output[%d] %s: %s",
				int(index), protocol.AsString(msg["kind"]), protocol.AsString(msg["data"])))
		case "tool_use":
			got = append(got, fmt.Sprintf("tool_use[%d] %s: %s",
				int(index), protocol.AsString(msg["name"]), protocol.AsString(msg["input"])))
		default:
			got = append(got, fmt.Sprintf("%v", msg["type"]))
		}
	}
	return got
}

// TestBlocksKeepTheOrderTheCLIProducedThem is the whole point of blocks: a turn that writes,
// thinks, calls a tool and writes again reaches the client as four frames in that order, each
// addressing its own block. The flat text-plus-tool-list this replaced could not say which came
// first, so a reader could not tell a tool call made before a paragraph from one made after it.
func TestBlocksKeepTheOrderTheCLIProducedThem(t *testing.T) {
	w := newBlockWatcher(t)
	feed(w.hub, t, w.job, assistantEvent("msg-1",
		map[string]any{"type": "text", "text": "Looking."},
		map[string]any{"type": "thinking", "thinking": "probably under units/"},
		map[string]any{"type": "tool_use", "name": "Read",
			"input": map[string]any{"file_path": "units/a.md"}},
		map[string]any{"type": "text", "text": " Found it."},
	))

	want := []string{
		"output[0] text: Looking.",
		"output[1] thinking: probably under units/",
		`tool_use[2] Read: {"file_path":"units/a.md"}`,
		"output[3] text:  Found it.",
	}
	got := w.frames(t, len(want))
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("frame %d = %q, want %q", i, got[i], want[i])
		}
	}

	kinds := []string{agentapi.BlockKindText, agentapi.BlockKindThinking, agentapi.BlockKindToolUse, agentapi.BlockKindText}
	if len(w.job.Blocks) != len(kinds) {
		t.Fatalf("the turn holds %d blocks, want %d: %+v", len(w.job.Blocks), len(kinds), w.job.Blocks)
	}
	for i, kind := range kinds {
		if w.job.Blocks[i].Kind != kind {
			t.Errorf("block %d is %q, want %q", i, w.job.Blocks[i].Kind, kind)
		}
	}
	// The chip's label is cut at 80 chars; the detail is what a reader auditing the turn opens.
	if detail := w.job.Blocks[2].Detail; !strings.Contains(detail, "units/a.md") {
		t.Errorf("tool detail = %q, want the whole input", detail)
	}
}

// TestASecondMessageIsNotSwallowedByTheFirst pins the bug ordered blocks fixed. The delta used to
// be this message's text measured against everything the *turn* had said, so the reply that follows
// a tool result — a new message, starting from nothing — was dropped whenever it was shorter than
// what came before it. It is the normal shape of an agentic turn, and it was lost from the
// transcript too, not only from the screen.
func TestASecondMessageIsNotSwallowedByTheFirst(t *testing.T) {
	w := newBlockWatcher(t)
	feed(w.hub, t, w.job, assistantEvent("msg-1",
		map[string]any{"type": "text", "text": "Reading the unit files now."}))
	feed(w.hub, t, w.job, assistantEvent("msg-2",
		map[string]any{"type": "text", "text": "Done."}))

	want := []string{"output[0] text: Reading the unit files now.", "output[1] text: Done."}
	got := w.frames(t, len(want))
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("frame %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestOneBlockPerEventIsHowTheCLIActuallyStreams pins the shape the installed CLI produces, because
// the whole append rests on it: with --include-partial-messages it announces each *finished*
// content block as its own `assistant` event — several per message, each a single-element content
// array, sharing one message id — and carries the growth of a block in progress as `stream_event`,
// which this service does not read.
//
// Reading those two events as one block re-emitted is what a position-within-the-message key would
// do, and it would fold the reply into the reasoning that preceded it.
func TestOneBlockPerEventIsHowTheCLIActuallyStreams(t *testing.T) {
	w := newBlockWatcher(t)
	feed(w.hub, t, w.job, assistantEvent("msg-1",
		map[string]any{"type": "thinking", "thinking": "17 times 23"}))
	feed(w.hub, t, w.job, assistantEvent("msg-1",
		map[string]any{"type": "text", "text": "391."}))

	want := []string{"output[0] thinking: 17 times 23", "output[1] text: 391."}
	got := w.frames(t, len(want))
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("frame %d = %q, want %q", i, got[i], want[i])
		}
	}
	if len(w.job.Blocks) != 2 {
		t.Errorf("blocks = %+v, want the reasoning and the reply kept apart", w.job.Blocks)
	}
}

// TestARedactedThinkingBlockStillReachesTheClient: the CLI encrypts such a block, so there is no
// text to send — but a turn where the model thought and the record shows nothing is exactly the gap
// this work exists to close. The empty frame is what opens the block on the client.
func TestARedactedThinkingBlockStillReachesTheClient(t *testing.T) {
	w := newBlockWatcher(t)
	feed(w.hub, t, w.job, assistantEvent("msg-1",
		map[string]any{"type": "redacted_thinking", "data": "AAAAB"},
		map[string]any{"type": "text", "text": "Here."},
	))

	want := []string{"output[0] thinking: ", "output[1] text: Here."}
	got := w.frames(t, len(want))
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("frame %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestPromptRejectsUnknownPermissionMode: a mode this service cannot honour is refused rather than
// read as either of the two, which would give the turn the wrong amount of freedom. It is refused
// before the conversation is even looked up, because a request is validated before any resource is
// consulted — which is what keeps this test independent of the registries.
func TestPromptRejectsUnknownPermissionMode(t *testing.T) {
	srv := newSocketTestServer(t, nil)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": "conv-1700000000000-abcd", "prompt": "hi",
		"permissionMode": "plan",
	})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeUnknownPermissionMode {
		t.Fatalf("unknown mode reply = %v, want an error with code %s", msg, turnevents.ErrCodeUnknownPermissionMode)
	}
	if srv.hub.ActiveTurnCount() != 0 {
		t.Error("no CLI process may be spawned for a mode the service does not accept")
	}
}

// TestPromptRefusesBypassWhenTheServiceDisallowsIt covers both ways a turn could end up running
// unasked on a service that switched bypass off: the mode sent with the prompt, and the mode the
// conversation already stores — which is what an omitted field resolves to, and which a store
// carried over from a service that did allow it will hold.
func TestPromptRefusesBypassWhenTheServiceDisallowsIt(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	cfg.BypassEnabled = false
	srv := newSocketTestServerWith(t, cfg, store)
	// Recorded straight into the store: the REST layer would refuse to create it, which is the point
	// — this is the conversation an older service left behind.
	stored := mustCreateConversation(t, store, "")

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	for name, frame := range map[string]map[string]any{
		"sent with the prompt": {
			"type": "prompt", "conversationId": stored.ID, "prompt": "hi",
			"permissionMode": runnerconfig.PermissionModeBypass,
		},
		"inherited from the conversation": {
			"type": "prompt", "conversationId": stored.ID, "prompt": "hi",
		},
	} {
		sendFrame(t, conn, frame)
		msg := readFrame(t, conn)
		if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeBypassDisabled {
			t.Errorf("bypass %s = %v, want an error with code %s", name, msg, turnevents.ErrCodeBypassDisabled)
		}
	}
	if srv.hub.ActiveTurnCount() != 0 {
		t.Error("no CLI process may be spawned for a mode the service does not allow")
	}

	// The manual modes are untouched: switching bypass off withdraws one mode, it does not close the
	// panel. An agent that refuses every spawn takes it as far as the spawn and no further, so the
	// assertion is that the mode was accepted rather than that a real CLI ran.
	srv.hub.Agents.Set(agentapi.AgentClaude, refusingAgent())
	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": stored.ID, "prompt": "hi",
		"permissionMode": runnerconfig.PermissionModeManual,
	})
	if msg := readFrame(t, conn); msg["code"] != turnevents.ErrCodeSpawnFailed {
		t.Errorf("manual mode = %v, want it accepted on a service without bypass (%s)",
			msg, turnevents.ErrCodeSpawnFailed)
	}
}

// TestClaudeHubRejectsWhenAtCapacity drives a prompt over the WS with the cap forced to 0, so the
// hub refuses before ever spawning the CLI. Everything else about the request is valid — a real
// folder and a real conversation — because a refusal must name the reason it actually has.
func TestClaudeHubRejectsWhenAtCapacity(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	srv.hub.MaxTurns = 0 // any prompt is already over capacity
	conversation := mustCreateConversation(t, store, "")

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "hi",
	})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeTooManyTurns {
		t.Errorf("prompt over capacity = %v, want an error with code %s", msg, turnevents.ErrCodeTooManyTurns)
	}
}

// TestPromptRefusesAFolderThatIsGone: the folder is resolved at the turn, not at the conversation.
// A conversation whose folder was deleted or renamed since it was created has no working directory
// left, and the refusal has to come before a process exists — `exec` would otherwise start the CLI
// in whatever the service's own working directory happens to be.
func TestPromptRefusesAFolderThatIsGone(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	mustMkdir(t, cfg.RootPath, "units")
	conversation := mustCreateConversation(t, store, "units")
	if err := os.RemoveAll(filepath.Join(cfg.RootPath, "units")); err != nil {
		t.Fatal(err)
	}
	srv := newSocketTestServerWith(t, cfg, store)

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "hi",
	})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeBadFolder {
		t.Fatalf("prompt in a folder that is gone = %v, want an error with code %s", msg, turnevents.ErrCodeBadFolder)
	}
	if srv.hub.ActiveTurnCount() != 0 {
		t.Error("no CLI process may be spawned without a working directory")
	}
}

// TestPromptRefusedWhileTheConversationIsRunning pins the deliberate reversal: a prompt no longer
// replaces the running turn. Replacement is indefensible once a conversation is durable — the turn
// it killed had already recorded the user's message, so its half-finished reply would be filed
// under a prompt still on screen.
func TestPromptRefusedWhileTheConversationIsRunning(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	conversation := mustCreateConversation(t, store, "")
	srv := newSocketTestServerWith(t, cfg, store)
	srv.hub.PutJob(conversation.ID, &pkgTurns.Turn{
		ConversationID: conversation.ID, TurnID: "turn-1", Owner: "tester", StartedAt: time.Now(),
	})

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "hi",
	})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeConversationBusy {
		t.Fatalf("second prompt = %v, want an error with code %s", msg, turnevents.ErrCodeConversationBusy)
	}
	if messages := mustMessages(t, store, conversation.ID); len(messages) != 0 {
		t.Errorf("a refused prompt wrote %d transcript records, want none", len(messages))
	}
}

// TestPromptWritesTheUserRecordBeforeSpawning is the ordering sweepInterrupted depends on: the
// user's message reaches the transcript before any process exists, so a turn interrupted by
// anything at all — a crash, a kill, a spawn that failed — always has a dangling record to close.
func TestPromptWritesTheUserRecordBeforeSpawning(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	conversation := mustCreateConversation(t, store, "")
	srv := newSocketTestServerWith(t, cfg, store)
	// An agent that refuses to spawn, so the failure is deterministic and needs no `claude` on the
	// host. What the CLI itself answers when its binary is missing is pinned in driver_claude_test.go.
	srv.hub.Agents.Set(agentapi.AgentClaude, refusingAgent())

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "summarise this unit",
	})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeSpawnFailed {
		t.Fatalf("failed spawn = %v, want an error with code %s", msg, turnevents.ErrCodeSpawnFailed)
	}

	messages := mustMessages(t, store, conversation.ID)
	if len(messages) != 2 {
		t.Fatalf("transcript = %+v, want the user's record and the settled turn", messages)
	}
	if messages[0].Role != pkgConversations.RoleUser || messages[0].Text != "summarise this unit" {
		t.Errorf("first record = %+v, want the prompt verbatim", messages[0])
	}
	if messages[1].Role != pkgConversations.RoleAssistant || !messages[1].Interrupted {
		t.Errorf("second record = %+v, want an interrupted assistant turn", messages[1])
	}
	// A turn that never started still has to settle the conversation, or it stays busy forever.
	meta, err := store.Get(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta.RunningAt != "" {
		t.Error("the conversation is still marked running after a failed spawn")
	}
	if srv.hub.IsRunning(conversation.ID) {
		t.Error("the turn registry still reports a turn for a spawn that failed")
	}
}

// TestFailedSpawnRecordsTheTurnBeforeReportingIt pins the ordering PROTOCOL.md calls contractual
// for every frame that settles a turn: the transcript record is written first, and the frame that
// says the turn is over second. That frame is what sends a client back to REST, so a read it
// triggers must not be able to overtake the write and find a turn with no reply.
//
// The store's own lock is the clock here: while it is held nothing can reach the transcript, so a
// frame arriving during it is by definition a frame that overtook the record.
func TestFailedSpawnRecordsTheTurnBeforeReportingIt(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")
	job := &pkgTurns.Turn{
		ConversationID: conversation.ID, TurnID: "turn-1", Owner: "tester", StartedAt: time.Now(),
	}

	watcher := &Service{cfg: cfg, hub: hub, conversations: store, liveness: hub.IsRunning}
	watcher.bindAgents(hub.Agents)
	ts := httptest.NewServer(watcher.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello
	sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{conversation.ID}})
	readFrame(t, conn) // not_running

	entry, err := store.Entry(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	frames := make(chan map[string]any, 4)
	go func() {
		var frame map[string]any
		if err := conn.ReadJSON(&frame); err == nil {
			frames <- frame
		}
		close(frames)
	}()

	entry.Mu.Lock()
	go hub.FailTurn(job, "The Claude process could not be started: no such file")

	select {
	case frame := <-frames:
		entry.Mu.Unlock()
		t.Fatalf("frame %v arrived while the transcript was still locked: the client is sent back to "+
			"REST for a turn that has not been written", frame)
	case <-time.After(300 * time.Millisecond):
	}
	entry.Mu.Unlock()

	frame, ok := <-frames
	if !ok {
		t.Fatal("the socket closed without reporting the failed spawn")
	}
	if frame["type"] != "error" || frame["code"] != turnevents.ErrCodeSpawnFailed {
		t.Fatalf("frame = %v, want an error with code %s", frame, turnevents.ErrCodeSpawnFailed)
	}
	records := mustMessages(t, store, conversation.ID)
	if len(records) != 1 || records[0].Role != pkgConversations.RoleAssistant || !records[0].Interrupted {
		t.Fatalf("transcript = %+v, want the interrupted turn already recorded", records)
	}
}

// A turn that ran hands its CLI session to the conversation, so the next one resumes it. A turn
// that asked to resume one and exited without the CLI ever announcing a session did not run at all:
// the session is gone, and the conversation has to be told so rather than asking again for it
// forever. Nothing else produces that combination, which is why the two ids are read from one flag.
func TestFinishTurnRecordsTheSessionAndClearsALostOne(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")

	ran := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-1", SessionID: "sess-1", SawSession: true}
	hub.FinishTurn(ran, 0, false)
	meta, err := store.Get(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta.SessionID != "sess-1" || meta.SessionLost {
		t.Fatalf("meta = %+v, want the CLI's session recorded for the next turn to resume", meta)
	}

	lost := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-2", Resumed: true}
	hub.FinishTurn(lost, 1, false)
	meta, err = store.Get(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta.SessionID != "" || !meta.SessionLost {
		t.Errorf("meta = %+v, want the lost session cleared and flagged", meta)
	}
	records := mustMessages(t, store, conversation.ID)
	if len(records) == 0 || records[len(records)-1].Role != pkgConversations.RoleNotice {
		t.Fatalf("transcript = %+v, want a notice explaining that the history is no longer context", records)
	}

	// A turn that merely failed keeps its session: exiting non-zero after the CLI announced one says
	// nothing about whether it can be resumed.
	failed := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-3", Resumed: true,
		SessionID: "sess-2", SawSession: true}
	hub.FinishTurn(failed, 1, false)
	if meta, _ := store.Get(conversation.ID); meta.SessionID != "sess-2" || meta.SessionLost {
		t.Errorf("meta = %+v, want a failed turn's session kept", meta)
	}
}

// A stop is the user ending a turn, never the CLI refusing to resume one — and the two settle with
// the same exit code. Reading a stop as a lost session cleared a session that was fine and told the
// user Claude had forgotten the conversation, which was the opposite of true until the notice made
// it so.
func TestAStoppedTurnKeepsItsSession(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")
	if _, err := store.Update(conversation.ID, func(meta *pkgConversations.ConversationMeta) {
		meta.SessionID = "sess-1"
	}); err != nil {
		t.Fatal(err)
	}

	// The shape a stop in the first second of a resumed turn produces: stopped before the agent ever
	// announced the session it was continuing, and settled with exit -1.
	job := newRunningJob(conversation.ID, "")
	job.Resumed = true
	hub.PutJob(conversation.ID, job)
	if !hub.StopProcess(conversation.ID, "tester") {
		t.Fatal("stopProcess found no turn to stop")
	}

	meta, err := store.Get(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta.SessionID != "sess-1" || meta.SessionLost {
		t.Fatalf("meta = %+v, want the session kept: the user stopped the turn, the CLI did not refuse it", meta)
	}
	for _, rec := range mustMessages(t, store, conversation.ID) {
		if rec.Role == pkgConversations.RoleNotice {
			t.Error("a stopped turn must not tell the user its session expired")
		}
	}
}

// The session id reaches the disk when the CLI announces it, not when the turn ends — because a
// turn that is interrupted never ends. Without this the next turn spawns a fresh session with no
// --resume and no notice, and Claude has silently forgotten the conversation.
func TestTheSessionIsRecordedAsSoonAsTheCLIAnnouncesIt(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")

	job := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-1", StartedAt: time.Now(),
		Driver: &claudecli.ClaudeDriver{Stdin: &stdinRecorder{}}}
	hub.PutJob(conversation.ID, job)
	feedLine(hub, t, job, `{"type":"system","subtype":"init","session_id":"sess-1"}`)

	meta, err := store.Get(conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta.SessionID != "sess-1" || meta.SessionLost {
		t.Fatalf("meta = %+v, want the session on disk while the turn is still running", meta)
	}
}

// betweenTest is one hand-made turn behind a real socket and a real store: the pipe it writes to,
// the transcript it records into, and the frames a watching tab receives.
type betweenTest struct {
	t     *testing.T
	hub   *pkgTurns.Engine
	store *pkgConversations.ConversationStore
	meta  pkgConversations.ConversationMeta
	job   *pkgTurns.Turn
	stdin *stdinRecorder
	conn  *websocket.Conn
}

func newBetweenTest(t *testing.T) *betweenTest {
	t.Helper()
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	meta := mustCreateConversation(t, store, "")
	// The prompt's own record, as startTurn writes it before it spawns: a between lands after it,
	// which is the ordering the transcript assertions below are about.
	if _, err := store.AppendAndUpdate(meta.ID,
		pkgConversations.ConversationRecord{Role: pkgConversations.RoleUser, Text: "count to a hundred"}, nil); err != nil {
		t.Fatalf("record the prompt: %v", err)
	}

	stdin := &stdinRecorder{}
	job := &pkgTurns.Turn{
		ConversationID: meta.ID, TurnID: "turn-1",
		// The turn belongs to whoever this socket authenticates as, because a between is an action on
		// the turn rather than a look at it: with any other owner every case below would be refused
		// as somebody else's, which is its own test.
		Owner:      access.AnonymousIdentity.User,
		Driver:     &claudecli.ClaudeDriver{Stdin: stdin},
		PromptText: "count to a hundred", StartedAt: time.Now(),
	}
	srv.hub.PutJob(job.ConversationID, job)

	ts := httptest.NewServer(srv.handler())
	t.Cleanup(ts.Close)
	conn := dialClaude(t, ts.URL)
	t.Cleanup(func() { conn.Close() })
	readFrame(t, conn) // hello
	sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{meta.ID}})
	readFrame(t, conn) // sync

	return &betweenTest{t: t, hub: srv.hub, store: store, meta: meta, job: job, stdin: stdin, conn: conn}
}

func (b *betweenTest) send(text string) {
	b.t.Helper()
	sendFrame(b.t, b.conn, map[string]any{"type": "between", "conversationId": b.meta.ID, "text": text})
}

// TestBetweenReachesTheRunningTurn is the whole mechanism in one test: the text goes onto the live
// CLI's stdin as the `user` frame it enqueues, it is recorded as the user's own message marked as a
// between, and every subscriber is told.
func TestBetweenReachesTheRunningTurn(t *testing.T) {
	b := newBetweenTest(t)

	b.send("actually stop at ten")

	echo := readFrame(t, b.conn)
	if echo["type"] != "between" || echo["text"] != "actually stop at ten" {
		t.Fatalf("frame = %v, want the between echoed back", echo)
	}
	if echo["conversationId"] != b.meta.ID || echo["turnId"] != "turn-1" {
		t.Errorf("frame = %v, want both ids so a client can route and fence it", echo)
	}

	frames := b.stdin.frames(t)
	if len(frames) != 1 {
		t.Fatalf("wrote %d frames to the CLI, want 1: %v", len(frames), frames)
	}
	message, _ := frames[0]["message"].(map[string]any)
	if frames[0]["type"] != "user" || message["role"] != "user" {
		t.Fatalf("stdin frame = %v, want the CLI's own user message", frames[0])
	}
	// Verbatim: the attachment notes promptWithContext appends belong to a message that starts
	// a turn, and repeating them inside one would tell the model something it has already been told.
	if message["content"] != "actually stop at ten" {
		t.Errorf("content = %v, want the text alone with no footer", message["content"])
	}

	records, err := b.store.Messages(b.meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("transcript = %d records, want the prompt and the between", len(records))
	}
	last := records[1]
	if last.Role != pkgConversations.RoleUser || !last.Between || last.Text != "actually stop at ten" {
		t.Errorf("record = %+v, want the user's own message marked as a between", last)
	}
}

// TestBetweenIsReplayedBySync: a tab that was not watching when something was said into the turn
// still learns it. The record is already on disk, but a tab holding this turn does not re-read the
// transcript until it ends — so `sync` is the only place it can come from.
func TestBetweenIsReplayedBySync(t *testing.T) {
	b := newBetweenTest(t)

	b.send("and skip seven")
	readFrame(t, b.conn) // the echo
	b.send("and thirteen")
	readFrame(t, b.conn)

	sendFrame(t, b.conn, map[string]any{"type": "subscribe", "conversationIds": []string{b.meta.ID}})
	sync := readFrame(t, b.conn)
	if sync["type"] != "sync" {
		t.Fatalf("subscribe reply = %v, want sync", sync["type"])
	}
	betweens, _ := sync["betweens"].([]any)
	if len(betweens) != 2 || betweens[0] != "and skip seven" || betweens[1] != "and thirteen" {
		t.Errorf("sync betweens = %v, want both, in the order they were said", sync["betweens"])
	}
}

// TestBetweenRefusedWithNoRunningTurn covers every way there is nothing to say it into: a
// conversation that has no turn at all, a turn that has settled, and a pipe that has closed — which
// is the race a between is actually exposed to, since the CLI's stdin is closed the moment its
// `result` arrives. All three are refused and none of them writes anything.
func TestBetweenRefusedWithNoRunningTurn(t *testing.T) {
	t.Run("no turn", func(t *testing.T) {
		b := newBetweenTest(t)
		b.hub.RemoveJob(b.meta.ID)

		b.send("too late")

		frame := readFrame(t, b.conn)
		if frame["type"] != "error" || frame["code"] != turnevents.ErrCodeNoRunningTurn {
			t.Fatalf("frame = %v, want an error refusing it with no_running_turn", frame)
		}
		if frames := b.stdin.frames(t); len(frames) != 0 {
			t.Errorf("wrote %v to a turn that is not running, want nothing", frames)
		}
	})

	t.Run("settled turn", func(t *testing.T) {
		b := newBetweenTest(t)
		b.job.Mu.Lock()
		b.job.IsDone = true
		b.job.Mu.Unlock()

		b.send("too late")

		if frame := readFrame(t, b.conn); frame["code"] != turnevents.ErrCodeNoRunningTurn {
			t.Fatalf("frame = %v, want no_running_turn", frame)
		}
		if frames := b.stdin.frames(t); len(frames) != 0 {
			t.Errorf("wrote %v to a settled turn, want nothing", frames)
		}
	})

	t.Run("closed pipe", func(t *testing.T) {
		b := newBetweenTest(t)
		// Still registered and still not `isDone` — the shape of a turn whose CLI has just reported
		// its result. Only the agent knows, which is why what it answers is what decides.
		b.job.Agent().(*claudecli.ClaudeDriver).CloseStdin()

		b.send("too late")

		if frame := readFrame(t, b.conn); frame["code"] != turnevents.ErrCodeNoRunningTurn {
			t.Fatalf("frame = %v, want no_running_turn", frame)
		}
		// Nothing was announced and nothing was recorded: a between the pipe refused was never said.
		records, err := b.store.Messages(b.meta.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 1 {
			t.Errorf("transcript = %d records, want the prompt alone", len(records))
		}
	})
}

// TestBetweenIgnoresAnEmptyMessage: nothing was said, so nothing is written and nothing is refused.
// A refusal would put a notice on screen for a message the user never typed.
func TestBetweenIgnoresAnEmptyMessage(t *testing.T) {
	h, job, rec := newPermissionTestJob()

	h.HandleBetween(nil, access.Identity{User: "tester"},
		pkgTurns.Command{Type: "between", ConversationID: "c1", Text: "   \n "})

	if frames := rec.frames(t); len(frames) != 0 {
		t.Errorf("wrote %v for an empty between, want nothing", frames)
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	if len(job.Betweens) != 0 {
		t.Errorf("betweens = %v, want none", job.Betweens)
	}
}

// TestBetweenRefusedForAnotherUsersTurn: acting on somebody else's CLI process is not something an
// authenticated-but-different user gets to do — the same rule a `stop` is held to, and for the same
// reason: this one steers the turn rather than merely watching it.
func TestBetweenRefusedForAnotherUsersTurn(t *testing.T) {
	h, job, rec := newPermissionTestJob()

	h.HandleBetween(nil, access.Identity{User: "somebody-else"},
		pkgTurns.Command{Type: "between", ConversationID: "c1", Text: "let me in"})

	if frames := rec.frames(t); len(frames) != 0 {
		t.Errorf("wrote %v to another user's turn, want nothing", frames)
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	if len(job.Betweens) != 0 {
		t.Errorf("betweens = %v, want none", job.Betweens)
	}
}

// TestBetweenTakesALongMessage: a between is held to exactly what a prompt is held to — the frame
// cap, and the record cut — and to no rule of its own. A pasted stack trace is a normal thing to
// say into a turn, and a cap here could only be refused with a code about something other than the
// turn.
func TestBetweenTakesALongMessage(t *testing.T) {
	b := newBetweenTest(t)
	long := strings.Repeat("x", 40000)

	b.send(long)

	if echo := readFrame(t, b.conn); echo["type"] != "between" || echo["text"] != long {
		t.Fatalf("frame = %v, want the whole message echoed", echo["type"])
	}
	message, _ := b.stdin.frames(t)[0]["message"].(map[string]any)
	if message["content"] != long {
		t.Error("the CLI was handed something other than what was said")
	}
}

// TestBetweenIsNotWhatAConversationIsNamedAfter: the title comes from what was asked, and a remark
// made inside a turn is not that. It matters only for the one prompt that names a conversation
// nothing — a message of attachments and no words — which is exactly when this could fire.
func TestBetweenIsNotWhatAConversationIsNamedAfter(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "")

	if _, err := store.AppendAndUpdate(meta.ID,
		pkgConversations.ConversationRecord{Role: pkgConversations.RoleUser, Text: "look at this", Between: true}, nil); err != nil {
		t.Fatal(err)
	}

	updated, err := store.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != pkgConversations.DefaultConversationTitle {
		t.Errorf("title = %q, want it still waiting for a prompt to name it", updated.Title)
	}
}

// TestATurnRunsEndToEndOnAnAgentWithNoCLI is what the AgentDriver port is for: a whole turn —
// spawned, streaming, parked on a permission, answered, settled and recorded — with nothing on this
// host to spawn and no `claude` on PATH. It pins both halves of the seam at once: what the hub
// hands a driver, and what it makes of everything the driver says back.
func TestATurnRunsEndToEndOnAnAgentWithNoCLI(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	agent := &stubAgent{}
	srv.hub.Agents.Set(agentapi.AgentClaude, agent)
	mustMkdir(t, cfg.RootPath, "units")
	conversation := mustCreateConversation(t, store, "units")

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello

	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "summarise this unit",
		"permissionMode": runnerconfig.PermissionModeManual, "model": "opus", "effort": "high",
	})
	if start := readUntil(t, conn, "start"); start["permissionMode"] != runnerconfig.PermissionModeManual {
		t.Fatalf("start = %v, want the settings the turn actually runs with", start)
	}

	// What the hub handed over. The prompt is the user's text — the folder travels as the
	// working directory rather than as prose in it.
	driver := agent.waitForDriver(t)
	run := driver.spawnedWith()
	if run.Prompt != "summarise this unit" {
		t.Errorf("prompt = %q, want the message alone with no footer", run.Prompt)
	}
	if filepath.Base(run.WorkDir) != "units" {
		t.Errorf("workDir = %q, want the conversation's folder", run.WorkDir)
	}
	if run.Model != "opus" || run.Effort != "high" || run.PermissionMode != runnerconfig.PermissionModeManual {
		t.Errorf("run = %+v, want the settings the prompt asked for", run)
	}
	if run.Conversation != conversation.ID || run.Turn == "" {
		t.Errorf("run = %+v, want the turn named so a driver can log it", run)
	}

	// The session reaches the disk the moment the agent names it, because an interrupted turn never
	// reaches its own end.
	driver.session("sess-42")
	if msg := readUntil(t, conn, "session"); msg["sessionId"] != "sess-42" {
		t.Fatalf("session frame = %v, want the id the agent announced", msg)
	}
	if meta, _ := store.Get(conversation.ID); meta.SessionID != "sess-42" {
		t.Errorf("stored session = %q, want it on disk while the turn is still running", meta.SessionID)
	}

	driver.text("Voici le résumé.")
	if msg := readUntil(t, conn, "output"); msg["data"] != "Voici le résumé." {
		t.Fatalf("output frame = %v, want the block the agent produced", msg)
	}

	// Parked on a permission, and unparked by the decision the client sends back.
	driver.ask(&agentapi.AgentAsk{
		ID: "req-1", Tool: "Edit", Description: "notes.md",
		Input: map[string]any{"file_path": "notes.md"}, InputSummary: `{"file_path": "notes.md"}`,
	})
	if card := readUntil(t, conn, "permission_request"); card["toolName"] != "Edit" {
		t.Fatalf("permission_request = %v, want the ask relayed", card)
	}
	sendFrame(t, conn, map[string]any{
		"type": "permission_decision", "conversationId": conversation.ID,
		"requestId": "req-1", "behavior": "allow",
	})
	readUntil(t, conn, "permission_resolved")
	decisions := driver.decisions()
	if len(decisions) != 1 || decisions[0].askID != "req-1" || !decisions[0].decision.Allow {
		t.Fatalf("decisions = %+v, want the allow written back to the agent", decisions)
	}
	if input, _ := decisions[0].decision.Input.(map[string]any); input["file_path"] != "notes.md" {
		t.Errorf("decision input = %v, want the input the agent asked about, echoed back", decisions[0].decision.Input)
	}

	driver.finish(0)
	if done := readUntil(t, conn, "done"); done["exitCode"] != float64(0) {
		t.Fatalf("done = %v, want the exit code the agent ended with", done)
	}

	records := mustMessages(t, store, conversation.ID)
	if len(records) != 2 {
		t.Fatalf("transcript = %+v, want the prompt and the reply", records)
	}
	if records[1].Role != pkgConversations.RoleAssistant || len(records[1].Blocks) != 1 ||
		records[1].Blocks[0].Text != "Voici le résumé." {
		t.Errorf("reply record = %+v, want the turn's blocks in the order they happened", records[1])
	}
	if srv.hub.IsRunning(conversation.ID) {
		t.Error("the conversation is still busy after the turn ended")
	}
}

// The prompt that started a turn, the betweens said into it and the reply that settled it all
// carry the turn's id — which is what joins a record to the log lines written while it ran. The
// running marker carries it too, for the settle record of a turn nobody is left to ask about.
func TestTurnRecordsNameTheirTurn(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	agent := &stubAgent{}
	srv.hub.Agents.Set(agentapi.AgentClaude, agent)
	mustMkdir(t, cfg.RootPath, "units")
	conversation := mustCreateConversation(t, store, "units")

	ts := httptest.NewServer(srv.handler())
	defer ts.Close()
	conn := dialClaude(t, ts.URL)
	defer conn.Close()
	readFrame(t, conn) // hello
	sendFrame(t, conn, map[string]any{
		"type": "prompt", "conversationId": conversation.ID, "prompt": "hi",
	})
	readUntil(t, conn, "start")

	driver := agent.waitForDriver(t)
	turn := driver.spawnedWith().Turn
	if meta, _ := store.Get(conversation.ID); meta.RunningTurn != turn {
		t.Errorf("running turn = %q, want the turn that was just spawned", meta.RunningTurn)
	}
	driver.text("hello back")
	driver.finish(0)
	readUntil(t, conn, "done")

	records := mustMessages(t, store, conversation.ID)
	if len(records) != 2 || records[0].TurnID != turn || records[1].TurnID != turn {
		t.Fatalf("transcript = %+v, want the prompt and the reply naming turn %q", records, turn)
	}
	if meta, _ := store.Get(conversation.ID); meta.RunningTurn != "" {
		t.Errorf("running turn = %q, want it cleared with the turn", meta.RunningTurn)
	}
}

// The prompt's record keeps what the model was actually sent: the composed message, the briefing
// it travelled with, and — where a board played the turn — the standing instructions and the play
// itself. The reply carries the play too, so either record joins to the board without the other.
func TestPromptFilesWhatTheModelWasSent(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	srv := newSocketTestServerWith(t, cfg, store)
	agent := &stubAgent{}
	srv.hub.Agents.Set(agentapi.AgentClaude, agent)
	mustMkdir(t, cfg.RootPath, "units")
	conversation := mustCreateConversation(t, store, "units")

	job, refusal := srv.hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: conversation.ID, Prompt: "review this",
		PermissionMode: runnerconfig.PermissionModeBypass,
		Instructions:   "Be terse.",
		ManagedAgent:   "Reviewer", AgentRef: "agent-1",
		RunID: "run-1", FlowNodeID: "flow-node-1", Board: "major",
	})
	if refusal != nil {
		t.Fatalf("startTurnFor refused: %+v", refusal)
	}
	records := mustMessages(t, store, conversation.ID)
	if len(records) != 1 {
		t.Fatalf("transcript = %+v, want the prompt recorded before the spawn", records)
	}
	prompt := records[0]
	if prompt.ComposedPrompt != "review this" {
		t.Errorf("composed = %q, want the message the model was sent", prompt.ComposedPrompt)
	}
	if !strings.Contains(prompt.SystemPrompt, "Dashboard") ||
		!strings.Contains(prompt.SystemPrompt, "Be terse.") {
		t.Errorf("briefing = %q, want the rendering briefing with the instructions under it", prompt.SystemPrompt)
	}
	if prompt.Instructions != "Be terse." || prompt.PlayedBy != "Reviewer" || prompt.AgentRef != "agent-1" ||
		prompt.RunID != "run-1" || prompt.FlowNodeID != "flow-node-1" || prompt.Board != "major" {
		t.Errorf("prompt = %+v, want the play filed with what it was sent", prompt)
	}

	driver := agent.waitForDriver(t)
	driver.text("done")
	driver.finish(0)
	<-job.Settled
	records = mustMessages(t, store, conversation.ID)
	if len(records) != 2 {
		t.Fatalf("transcript = %+v, want the prompt and the reply", records)
	}
	if reply := records[1]; reply.PlayedBy != "Reviewer" || reply.RunID != "run-1" ||
		reply.FlowNodeID != "flow-node-1" || reply.Board != "major" {
		t.Errorf("reply = %+v, want the play carried onto the reply too", reply)
	}
}

// A between files where it landed in the reply: how many blocks had arrived when it was said —
// which the turn's records, prompt then betweens then reply, cannot otherwise show.
func TestBetweenRecordsWhereItLanded(t *testing.T) {
	b := newBetweenTest(t)
	b.hub.Apply(b.job, agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "one"}})
	b.hub.Apply(b.job, agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{Kind: agentapi.BlockKindText, Text: "two"}})
	readFrame(t, b.conn) // output
	readFrame(t, b.conn) // output

	b.send("actually stop at ten")
	readFrame(t, b.conn) // the echo

	records := mustMessages(t, b.store, b.meta.ID)
	if len(records) != 2 {
		t.Fatalf("transcript = %d records, want the prompt and the between", len(records))
	}
	landed := records[1]
	if landed.TurnID != "turn-1" || landed.AfterBlocks == nil || *landed.AfterBlocks != 2 {
		t.Errorf("between = %+v, want it filed two blocks into turn-1", landed)
	}
}

// A refusal for want of credentials reaches the client under the sign-in's own code rather than
// as a mid-turn complaint — it is the usage panel's Login that answers it, so the panel has to be
// able to tell it from a stream that stumbled. Anything else the agent reports stays `cli_error`.
func TestFailureMarkedAuthRequiredTravelsAsNotSignedIn(t *testing.T) {
	w := newBlockWatcher(t)
	w.hub.Apply(w.job, agentapi.AgentEvent{
		Kind:         agentapi.EventFailure,
		Message:      "not logged in: run /login to add an API key",
		AuthRequired: true,
	})
	w.hub.Apply(w.job, agentapi.AgentEvent{Kind: agentapi.EventFailure, Message: "the stream stumbled"})

	signedOut := readFrame(t, w.conn)
	if signedOut["type"] != "error" || signedOut["code"] != turnevents.ErrCodeNotSignedIn {
		t.Errorf("marked failure = %v, want an error with code %s", signedOut, turnevents.ErrCodeNotSignedIn)
	}
	if signedOut["message"] != "not logged in: run /login to add an API key" {
		t.Errorf("message = %v, want the agent's sentence beside the code", signedOut["message"])
	}
	complaint := readFrame(t, w.conn)
	if complaint["type"] != "error" || complaint["code"] != turnevents.ErrCodeCLIError {
		t.Errorf("unmarked failure = %v, want an error with code %s", complaint, turnevents.ErrCodeCLIError)
	}
}

// A notice travels to the client as its own frame and files nothing: no block, no failure
// notice — a turn that goes on to succeed keeps no trace of having once been quiet.
func TestNoticeTravelsAsItsOwnFrameAndFilesNothing(t *testing.T) {
	w := newBlockWatcher(t)
	w.hub.Apply(w.job, agentapi.AgentEvent{Kind: agentapi.EventNotice,
		Message: "Muse has been quiet for 2m0s; the turn is still running."})
	frame := readFrame(t, w.conn)
	if frame["type"] != "notice" ||
		frame["text"] != "Muse has been quiet for 2m0s; the turn is still running." {
		t.Errorf("notice = %v, want the driver's sentence as its own frame", frame)
	}
	if frame["conversationId"] != "conv-a" || frame["turnId"] != "turn-1" {
		t.Errorf("notice = %v, want it stamped with the conversation and the turn", frame)
	}
	w.job.Mu.Lock()
	defer w.job.Mu.Unlock()
	if len(w.job.Blocks) != 0 || w.job.FailureNotice != "" {
		t.Errorf("blocks = %+v failureNotice = %q, want nothing filed",
			w.job.Blocks, w.job.FailureNotice)
	}
}

// A notice with nothing to say says nothing: no frame goes out for an empty sentence.
func TestEmptyNoticeEmitsNoFrame(t *testing.T) {
	w := newBlockWatcher(t)
	w.hub.Apply(w.job, agentapi.AgentEvent{Kind: agentapi.EventNotice})
	_ = w.conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	var msg map[string]any
	if err := w.conn.ReadJSON(&msg); err == nil {
		t.Errorf("frame = %v, want nothing for an empty notice", msg)
	}
}

// The reply files why the turn ended: what the agent reported, what a spawn that never ran said,
// or what the CLI composed as the last block of a turn that failed after working. A stopped turn
// files nothing — being stopped is the story, and the interrupted flag tells it.
func TestFinishTurnFilesWhyItEnded(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")

	reported := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-1",
		FailureNotice: "stream error: unexpected status 401"}
	hub.FinishTurn(reported, 1, false)

	failed := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-2",
		Blocks: []agentapi.TurnBlock{{Kind: agentapi.BlockKindText, Text: "half an answer"},
			{Kind: agentapi.BlockKindText, Text: "API Error: the model overloaded"}}}
	hub.FinishTurn(failed, 1, false)

	quiet := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-3",
		Blocks: []agentapi.TurnBlock{{Kind: agentapi.BlockKindText, Text: "done"}}}
	hub.FinishTurn(quiet, 0, false)

	stopped := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-4",
		Blocks: []agentapi.TurnBlock{{Kind: agentapi.BlockKindText, Text: "half an answer"}}}
	hub.FinishTurn(stopped, -1, true)

	ended := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-5", Terminal: "cancelled"}
	hub.FinishTurn(ended, -1, false)

	records := mustMessages(t, store, conversation.ID)
	if len(records) != 5 {
		t.Fatalf("transcript = %+v, want one record per settled turn", records)
	}
	if records[0].EndReason != "stream error: unexpected status 401" {
		t.Errorf("reported end = %q, want what the agent said", records[0].EndReason)
	}
	if records[1].EndReason != "API Error: the model overloaded" {
		t.Errorf("failed end = %q, want the CLI's last block", records[1].EndReason)
	}
	if records[2].EndReason != "" {
		t.Errorf("clean end = %q, want nothing to explain", records[2].EndReason)
	}
	if records[3].EndReason != "" || !records[3].Interrupted {
		t.Errorf("stopped end = %+v, want the flag and no sentence", records[3])
	}
	if records[4].Terminal != "cancelled" {
		t.Errorf("terminal = %q, want the host's own word beside the number", records[4].Terminal)
	}

	// A turn that never ran files the spawn's own sentence.
	spawn := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-6", StartedAt: time.Now()}
	hub.FailTurn(spawn, "The Claude process could not be started: no such file")
	records = mustMessages(t, store, conversation.ID)
	if last := records[len(records)-1]; last.EndReason == "" || !strings.Contains(last.EndReason, "could not be started") {
		t.Errorf("spawn failure = %+v, want the sentence the user was shown", last)
	}
}

// The reply brackets the turn it settles — when it ran, how long the first block took, what each
// block's arrival was — and files what the turn cost in the agent's own figures.
func TestFinishTurnFilesTimingAndUsage(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")
	started := time.Now().Add(-2 * time.Second)

	job := &pkgTurns.Turn{
		ConversationID: conversation.ID, TurnID: "turn-1", StartedAt: started,
		FirstBlockAt: started.Add(300 * time.Millisecond),
		Blocks: []agentapi.TurnBlock{
			{Kind: agentapi.BlockKindText, Text: "hello", At: started.Add(300 * time.Millisecond)},
			{Kind: agentapi.BlockKindToolUse, Name: "Bash", At: started.Add(time.Second)},
		},
		Usage: &agentapi.TurnUsage{InputTokens: 120, OutputTokens: 34, ReasoningTokens: 20, TotalCostUSD: 0.012, Scope: agentapi.UsageScopeTurn},
	}
	hub.FinishTurn(job, 0, false)

	records := mustMessages(t, store, conversation.ID)
	if len(records) != 1 {
		t.Fatalf("transcript = %+v, want the settled turn", records)
	}
	reply := records[0]
	if reply.StartedAt == "" || reply.FinishedAt == "" {
		t.Errorf("reply = %+v, want the turn bracketed", reply)
	}
	if reply.DurationMs < 1900 {
		t.Errorf("duration = %dms, want the two seconds the turn ran", reply.DurationMs)
	}
	if reply.FirstBlockMs < 250 || reply.FirstBlockMs > 2000 {
		t.Errorf("first block = %dms, want the 300ms it took to arrive", reply.FirstBlockMs)
	}
	if len(reply.Blocks) != 2 || reply.Blocks[0].At == "" || reply.Blocks[1].At == "" {
		t.Errorf("blocks = %+v, want each arrival stamped", reply.Blocks)
	}
	if reply.Usage == nil || reply.Usage.InputTokens != 120 || reply.Usage.OutputTokens != 34 ||
		reply.Usage.ReasoningTokens != 20 || reply.Usage.TotalCostUSD != 0.012 || reply.Usage.Scope != agentapi.UsageScopeTurn {
		t.Errorf("usage = %+v, want the agent's own figures", reply.Usage)
	}
}

// A result names its call, and the hub files it onto that block: what the call returned, whether
// that was an error, and how long the call took. A result for a call the turn never made is
// dropped — the transcript shows what happened, not what cannot be placed.
func TestToolResultFilesOntoItsCall(t *testing.T) {
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	conversation := mustCreateConversation(t, store, "")
	job := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-1", StartedAt: time.Now()}

	hub.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventBlock, Block: agentapi.TurnBlock{
		Kind: agentapi.BlockKindToolUse, Name: "Bash", ToolUseID: "toolu_7",
	}})
	hub.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventToolResult, ToolUseID: "toolu_7",
		ToolResult: "a.md\nb.md", ToolExitCode: intPtr(0)})
	hub.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventToolResult, ToolUseID: "toolu_nobody", ToolResult: "lost"})
	hub.FinishTurn(job, 0, false)

	records := mustMessages(t, store, conversation.ID)
	if len(records) != 1 || len(records[0].Blocks) != 1 {
		t.Fatalf("transcript = %+v, want the one call and nothing invented", records)
	}
	block := records[0].Blocks[0]
	if block.Result != "a.md\nb.md" || block.IsError {
		t.Errorf("block = %+v, want the output filed on its call", block)
	}
	if block.ExitCode == nil || *block.ExitCode != 0 {
		t.Errorf("exitCode = %v, want the reported status", block.ExitCode)
	}
}

// Every way out of the pending set is filed: allowed and denied by a user, answered with the
// answers, allowed by the countdown, withdrawn by the agent — and still held when the turn
// settles. A replayed transcript shows every card the turn parked on.
func TestPermissionHistoryIsFiled(t *testing.T) {
	owner := access.Identity{User: "tester"}

	t.Run("decided by a user", func(t *testing.T) {
		h, job, _ := newPermissionTestJob()
		feed(h, t, job, canUseToolEvent("req-1"))
		h.HandlePermissionDecision(nil, owner, pkgTurns.Command{
			ConversationID: job.ConversationID, RequestID: "req-1", Behavior: "deny", Message: "not that file",
		})
		feed(h, t, job, askQuestionEvent("req-q"))
		h.HandleQuestionAnswer(nil, owner, pkgTurns.Command{
			ConversationID: job.ConversationID, RequestID: "req-q", Answers: []string{"first"},
		})
		feed(h, t, job, canUseToolEvent("req-2"))
		h.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventWithdraw, AskID: "req-2"})

		job.Mu.Lock()
		history := append([]pkgConversations.ConversationAsk{}, job.AskHistory...)
		job.Mu.Unlock()
		if len(history) != 3 {
			t.Fatalf("history = %+v, want the deny, the answer and the withdrawal", history)
		}
		if history[0].Outcome != pkgConversations.AskOutcomeDeny || history[0].DecidedBy != "tester" ||
			history[0].Tool != "Edit" || history[0].Description != "notes.md" {
			t.Errorf("deny = %+v, want what was asked and who refused it", history[0])
		}
		if history[1].Outcome != pkgConversations.AskOutcomeAllow || len(history[1].Questions) == 0 ||
			len(history[1].Answers) != 1 {
			t.Errorf("answer = %+v, want the questions with what came back", history[1])
		}
		if history[2].Outcome != pkgConversations.AskOutcomeCancelled || history[2].DecidedBy != "agent" {
			t.Errorf("withdrawal = %+v, want the agent's own cancellation", history[2])
		}
	})

	t.Run("allowed by the countdown", func(t *testing.T) {
		h, job, rec := newPermissionTestJobIn(runnerconfig.PermissionModeManualLive)
		feed(h, t, job, canUseToolEvent("req-1"))
		waitFrames(t, rec, 1)

		job.Mu.Lock()
		history := append([]pkgConversations.ConversationAsk{}, job.AskHistory...)
		job.Mu.Unlock()
		if len(history) != 1 || history[0].Outcome != pkgConversations.AskOutcomeAllow || history[0].DecidedBy != "countdown" {
			t.Errorf("history = %+v, want the countdown's own allow", history)
		}
	})

	t.Run("still held when the turn settles", func(t *testing.T) {
		store, cfg := newTurnRegistry(t)
		hub := assembly.NewEngine(cfg, store)
		conversation := mustCreateConversation(t, store, "")
		job := &pkgTurns.Turn{ConversationID: conversation.ID, TurnID: "turn-1", StartedAt: time.Now()}
		hub.ApplyAsk(job, &agentapi.AgentAsk{ID: "req-1", Tool: "Edit", Description: "notes.md",
			Input: map[string]any{"file_path": "notes.md"}, InputSummary: "notes.md"})
		hub.FinishTurn(job, -1, true)

		records := mustMessages(t, store, conversation.ID)
		if len(records) != 1 || len(records[0].Asks) != 1 {
			t.Fatalf("transcript = %+v, want the unanswered card filed", records)
		}
		if ask := records[0].Asks[0]; ask.Outcome != pkgConversations.AskOutcomeCancelled || ask.DecidedBy != "stop" {
			t.Errorf("ask = %+v, want the stop's own cancellation", ask)
		}
	})
}

func intPtr(n int) *int { return &n }

// The four side ports are optional. An agent that answers none of them leaves the endpoints behind
// them unmounted, so the panel disappears rather than failing on a route that exists and cannot
// work — which is exactly what a deployment with sign-in switched off already looks like. The
// Claude agent answers all four, which is why the surface is the one it has always been.
//
// Every agent is stubbed, because the options endpoint is mounted for *any* agent with something
// to publish: it answers per agent and one silent engine is no reason to take it off the air.
func TestAnAgentAnsweringNoSidePortsHasNoPanels(t *testing.T) {
	store, cfg := newTurnRegistry(t)

	hub := assembly.NewEngine(cfg, store)
	hub.Agents.Set(agentapi.AgentClaude, &stubAgent{})
	hub.Agents.Set(agentapi.AgentCodex, &stubAgent{})
	hub.Agents.Set(agentapi.AgentMuse, &stubAgent{})
	hub.Agents.Set(agentapi.AgentOpenCode, &stubAgent{})
	for _, entry := range hub.Agents.Entries {
		hub.Agents.Set(entry.Name, &stubAgent{})
	}
	bare := &Service{cfg: cfg, hub: hub, conversations: store, liveness: hub.IsRunning}
	bare.bindAgents(hub.Agents)

	for _, path := range []string{"/claude/usage", "/claude/options", "/claude/auth/status"} {
		if rec := do(bare, httptest.NewRequest(http.MethodGet, path, nil)); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s on an agent answering no side ports = %d, want 404", path, rec.Code)
		}
	}
	// The socket and the conversations are not side ports: they are the turn itself, and every agent
	// has them.
	if rec := do(bare, httptest.NewRequest(http.MethodGet, "/claude/conversations", nil)); rec.Code != http.StatusOK {
		t.Errorf("GET /claude/conversations = %d, want 200 whatever the agent answers", rec.Code)
	}

	// The Claude agent answers all of them, so every route is mounted. Read off Routes rather than
	// requested, because requesting them would run the CLI on the host — which is the very
	// dependency the port is here to remove.
	full := newSocketTestServerWith(t, cfg, store)
	if !full.offersUsage() || full.login == nil || !full.offersOptions() {
		t.Fatal("the Claude agent must answer every side port")
	}
	mounted := map[string]bool{}
	for _, route := range full.Routes() {
		mounted[route.Pattern] = true
	}
	for _, pattern := range []string{
		"GET /claude/usage", "GET /claude/options", "GET /claude/auth/status",
		"POST /claude/auth/login/start", "POST /claude/auth/login/code", "POST /claude/auth/login/cancel",
	} {
		if !mounted[pattern] {
			t.Errorf("%q is not mounted for the Claude agent, but it always has been", pattern)
		}
	}
}

// newTurnRegistry builds the registry a turn consults, over a fresh store root and a state
// directory of its own.
func newTurnRegistry(t *testing.T) (*pkgConversations.ConversationStore, *runnerconfig.Config) {
	t.Helper()
	cfg := &runnerconfig.Config{
		Config: &coreconfig.Config{AuthMode: "debug", RootPath: t.TempDir(), StatePath: t.TempDir(), MaxUploadBytes: 1 << 20},
		// What LoadConfig defaults it to. A hand-built Config leaves it false — fail closed — so the
		// tests that drive a `bypassPermissions` turn have to say so, exactly like a deployment does.
		BypassEnabled: true,
	}
	store, err := pkgConversations.NewConversationStore(filepath.Join(cfg.StatePath, pkgConversations.ConversationsDirName))
	if err != nil {
		t.Fatalf("newConversationStore: %v", err)
	}
	return store, cfg
}

// newSocketTestServer builds the minimum Server the socket needs, over a temp root.
func newSocketTestServer(t *testing.T, store *pkgConversations.ConversationStore) *Service {
	t.Helper()
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "debug", RootPath: t.TempDir(), MaxUploadBytes: 1 << 20}}
	return newSocketTestServerWith(t, cfg, store)
}

func newSocketTestServerWith(t *testing.T, cfg *runnerconfig.Config, store *pkgConversations.ConversationStore) *Service {
	t.Helper()
	hub := assembly.NewEngine(cfg, store)
	svc := &Service{
		cfg: cfg, hub: hub,
		conversations: store, liveness: hub.IsRunning,
	}
	// The side ports are wired off the hub's agents exactly as Start wires them, so the routes a test
	// reaches are the routes a deployment mounts.
	svc.bindAgents(hub.Agents)
	return svc
}

// readUntil reads frames until one of the given type arrives, so a test about a turn's own frames
// is not written around the registry broadcasts that travel beside them.
func readUntil(t *testing.T, conn *websocket.Conn, frameType string) map[string]any {
	t.Helper()
	for i := 0; i < 20; i++ {
		msg := readFrame(t, conn)
		if msg["type"] == frameType {
			return msg
		}
	}
	t.Fatalf("no %s frame arrived", frameType)
	return nil
}

// mustCreateConversation records a conversation in the given folder, bypassing the handler: these
// tests are about the socket, and the REST layer's own refusals are pinned elsewhere.
func mustCreateConversation(t *testing.T, store *pkgConversations.ConversationStore, folder string) pkgConversations.ConversationMeta {
	t.Helper()
	meta, err := store.Create(pkgConversations.ConversationMeta{
		Folder: folder, Owner: "tester",
		Model: agentapi.DefaultConversationModel, Effort: agentapi.DefaultConversationEffort,
		PermissionMode: runnerconfig.PermissionModeBypass, Thinking: true,
	})
	if err != nil {
		t.Fatalf("create a conversation in %q: %v", folder, err)
	}
	return meta
}

// newRunningJob is a turn on an agent that is running and says nothing — which is all stopProcess
// needs to have something to stop. It used to be `sleep 60` standing in for a CLI; a stub driver is
// the same fixture without a process, and it can be asked afterwards whether the stop reached it.
func newRunningJob(conversationID, folder string) *pkgTurns.Turn {
	driver := &stubDriver{events: make(chan agentapi.AgentEvent)}
	driver.drain()
	return &pkgTurns.Turn{
		ConversationID: conversationID, TurnID: "turn-" + conversationID,
		Owner: "tester", Folder: folder, Driver: driver, StartedAt: time.Now(),
	}
}

func dialClaude(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	return dialAt(t, serverURL, SocketPath)
}

// dialAt opens the turn socket on the path it is given, which is what lets one test say that both
// of them reach the same hub.
func dialAt(t *testing.T, serverURL, path string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(serverURL, "http")+path, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", path, err)
	}
	return conn
}

func sendFrame(t *testing.T, conn *websocket.Conn, frame map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(frame); err != nil {
		t.Fatalf("write %v: %v", frame["type"], err)
	}
}

func readFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var msg map[string]any
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("read: %v", err)
	}
	return msg
}
