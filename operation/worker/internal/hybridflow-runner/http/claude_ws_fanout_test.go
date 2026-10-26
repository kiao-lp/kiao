package runnerhttp

import (
	"fmt"
	"github.com/gorilla/websocket"
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	claudecli "kiao/worker/internal/hybridflow-runner/agents/claude"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http/httptest"
	"strings"
	pkgSync "sync"
	"testing"
	"time"
)

// fanoutTest is one hub behind a real HTTP server, which is the only way to get a *wsConn: the hub
// writes to a gorilla connection, and a fake would be testing the fake.
type fanoutTest struct {
	t   *testing.T
	hub *pkgTurns.Engine
	url string
}

func newFanoutTest(t *testing.T) *fanoutTest {
	t.Helper()
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "debug", RootPath: t.TempDir(), MaxUploadBytes: 1 << 20}}
	hub := assembly.NewEngine(cfg, nil)
	srv := &Service{cfg: cfg, hub: hub}
	srv.bindAgents(hub.Agents)
	ts := httptest.NewServer(srv.handler())
	t.Cleanup(ts.Close)
	return &fanoutTest{t: t, hub: hub, url: ts.URL}
}

// connect dials a socket, reads its `hello`, and returns both the client end and the hub's own view
// of it — the latter because half of these assertions are about the hub's bookkeeping.
func (f *fanoutTest) connect() (*websocket.Conn, *turnevents.Client) {
	f.t.Helper()
	conn := dialClaude(f.t, f.url)
	f.t.Cleanup(func() { conn.Close() })

	hello := readFrame(f.t, conn)
	if hello["type"] != "hello" {
		f.t.Fatalf("first frame = %v, want hello", hello["type"])
	}
	socketID, _ := hello["socketId"].(string)

	// The socket is registered before `hello` is written, so it is already there by the time the
	// client has read it.
	f.hub.Mu.Lock()
	defer f.hub.Mu.Unlock()
	server := f.hub.Conns[socketID]
	if server == nil {
		f.t.Fatalf("socket %q is not in the hub's registry", socketID)
	}
	return conn, server
}

// subscribeTo subscribes over the wire and swallows the sync/not_running the hub answers with, so a
// test that is about a later frame reads that frame.
func (f *fanoutTest) subscribeTo(conn *websocket.Conn, conversationIDs ...string) {
	f.t.Helper()
	sendFrame(f.t, conn, map[string]any{"type": "subscribe", "conversationIds": conversationIDs})
	for range conversationIDs {
		readFrame(f.t, conn)
	}
}

// Two tabs watching the same conversation both see its output. This is the whole point of a
// subscriber set: the old socket held one session pointer, so the second tab saw nothing.
func TestFanoutReachesEverySubscriber(t *testing.T) {
	f := newFanoutTest(t)
	first, _ := f.connect()
	second, _ := f.connect()
	f.subscribeTo(first, "conv-a")
	f.subscribeTo(second, "conv-a")

	job := &pkgTurns.Turn{ConversationID: "conv-a", TurnID: "turn-1"}
	f.hub.Emit(job, map[string]any{"type": "output", "data": "hello"})

	for name, conn := range map[string]*websocket.Conn{"first": first, "second": second} {
		msg := readFrame(t, conn)
		if msg["type"] != "output" || msg["data"] != "hello" {
			t.Errorf("%s socket got %v, want the output frame", name, msg)
		}
	}
}

// A socket watching one conversation must never see another's. Under multiplexing this is what
// keeps four turns on one socket from bleeding into each other's bubbles.
func TestFanoutIsScopedToOneConversation(t *testing.T) {
	f := newFanoutTest(t)
	conn, _ := f.connect()
	f.subscribeTo(conn, "conv-a")

	f.hub.Emit(&pkgTurns.Turn{ConversationID: "conv-b", TurnID: "turn-2"},
		map[string]any{"type": "output", "data": "not yours"})
	f.hub.Emit(&pkgTurns.Turn{ConversationID: "conv-a", TurnID: "turn-1"},
		map[string]any{"type": "output", "data": "yours"})

	if msg := readFrame(t, conn); msg["data"] != "yours" {
		t.Errorf("got %v, want only the subscribed conversation's frame", msg)
	}
}

// Every conversation-scoped frame carries the conversation it belongs to, and every frame produced
// by a turn carries the turn as well. The client routes on the first and fences stragglers on the
// second, so a frame missing either is a frame it silently drops. A table over the emit sites,
// because the invariant has to hold for all of them and not just the ones with a test of their own.
func TestEveryEmittedFrameCarriesItsConversation(t *testing.T) {
	f := newFanoutTest(t)
	conn, _ := f.connect()
	f.subscribeTo(conn, "conv-a")
	job := &pkgTurns.Turn{ConversationID: "conv-a", TurnID: "turn-1",
		Driver: &claudecli.ClaudeDriver{Stdin: &stdinRecorder{}}}

	cases := []struct {
		name  string
		emit  func()
		want  string
		turnd bool // whether the frame belongs to a turn and must therefore carry turnId
	}{
		{"start", func() {
			f.hub.Emit(job, map[string]any{"type": "start", "folder": "units"})
		}, "start", true},
		{"session", func() {
			feed(f.hub, t, job, map[string]any{"type": "system", "session_id": "sess-1"})
		}, "session", true},
		{"output", func() {
			feed(f.hub, t, job, assistantTextEvent("hi"))
		}, "output", true},
		{"tool_use", func() {
			feed(f.hub, t, job, assistantToolEvent("Edit", "notes.md"))
		}, "tool_use", true},
		{"permission_request", func() {
			feed(f.hub, t, job, canUseToolEvent("req-1"))
		}, "permission_request", true},
		{"permission_resolved", func() {
			f.hub.CancelPermission(job, "req-1")
		}, "permission_resolved", true},
		{"cli error", func() {
			feedLine(f.hub, t, job, `{"type":"error","error":{"message":"boom"}}`)
		}, "error", true},
		{"done", func() {
			f.hub.Emit(job, map[string]any{"type": "done", "exitCode": 0})
		}, "done", true},
		{"stopped", func() {
			f.hub.EmitFor("conv-a", job.TurnID, map[string]any{"type": "stopped"})
		}, "stopped", true},
		{"refusal before a turn exists", func() {
			f.hub.EmitFor("conv-a", "", turnevents.ErrorFrame("conv-a", turnevents.ErrCodeConversationBusy, "busy"))
		}, "error", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.emit()
			msg := readFrame(t, conn)
			if msg["type"] != c.want {
				t.Fatalf("frame = %v, want a %s", msg, c.want)
			}
			if msg["conversationId"] != "conv-a" {
				t.Errorf("conversationId = %v, want conv-a — the client routes on it", msg["conversationId"])
			}
			if c.turnd && msg["turnId"] != "turn-1" {
				t.Errorf("turnId = %v, want turn-1 — the client fences stragglers on it", msg["turnId"])
			}
			if !c.turnd && msg["turnId"] != nil {
				t.Errorf("turnId = %v, want none: no turn exists to fence against", msg["turnId"])
			}
		})
	}
}

// A stopped turn's goroutine keeps draining a pipe that still has output in it. None of it may
// reach a client, because `stopped` has already settled the turn and a later `output` would reopen
// a bubble the user closed.
func TestSupersededJobEmitsNothing(t *testing.T) {
	f := newFanoutTest(t)
	conn, _ := f.connect()
	f.subscribeTo(conn, "conv-a")
	job := &pkgTurns.Turn{ConversationID: "conv-a", TurnID: "turn-1", Superseded: true}

	f.hub.Emit(job, map[string]any{"type": "output", "data": "straggler"})
	f.hub.Emit(job, map[string]any{"type": "done", "exitCode": 0})
	// The gate is on the job's own stream, not on the conversation: `stopped` itself has to get
	// through, or a stop would never be acknowledged. It doubles as the sentinel — if either frame
	// above had been delivered, it would be read here instead.
	f.hub.EmitFor(job.ConversationID, job.TurnID, map[string]any{"type": "stopped"})

	if msg := readFrame(t, conn); msg["type"] != "stopped" {
		t.Errorf("frame = %v, want stopped and nothing before it", msg)
	}
}

// The same invariant when the stop lands *while* the turn is emitting, which is the ordinary case:
// a user presses Stop with output still streaming.
//
// The flag alone does not give it. Reading `superseded` and then releasing the job's lock before
// fanning out leaves a window: a frame that read `false` an instant before the stop set it is still
// written, and it is written after the `stopped` that overtook it. Held across the whole
// check-and-write, the gate closes that window — which is what this pins.
//
// Several goroutines emit, because one is not enough to explore the interleavings: what puts a frame
// in the window reliably is contention on the socket's write lock, where a frame already past the
// gate waits while the stop catches up. Rounds, for the same reason — each is an independent
// scheduling draw, and the invariant has to survive all of them, not the lucky ones.
func TestStoppedIsTheLastFrameOfAnEmittingTurn(t *testing.T) {
	f := newFanoutTest(t)
	conn, _ := f.connect()

	for round := 0; round < 24; round++ {
		conversationID := fmt.Sprintf("conv-%d", round)
		f.subscribeTo(conn, conversationID)
		job := &pkgTurns.Turn{ConversationID: conversationID, TurnID: "turn-1"}
		f.hub.PutJob(conversationID, job)

		var streaming pkgSync.WaitGroup
		for g := 0; g < 12; g++ {
			streaming.Add(1)
			go func() {
				defer streaming.Done()
				for i := 0; i < 150; i++ {
					f.hub.Emit(job, map[string]any{"type": "output", "data": "x"})
				}
			}()
		}
		f.hub.StopProcess(conversationID, "tester")
		streaming.Wait()

		// Everything before `stopped` is the turn's own output, and nothing may follow it. The
		// sentinel is what proves the "nothing": it is emitted only once every emitter has returned,
		// so a straggler would already be queued ahead of it and would be read here instead.
		for {
			msg := readFrame(t, conn)
			if msg["type"] == "stopped" {
				break
			}
			if msg["type"] != "output" {
				t.Fatalf("round %d: frame before stopped = %v, want the turn's own output", round, msg)
			}
		}
		f.hub.EmitFor(conversationID, "", map[string]any{"type": "not_running"})
		if msg := readFrame(t, conn); msg["type"] != "not_running" {
			t.Fatalf("round %d: frame after stopped = %v, want nothing before the sentinel", round, msg)
		}
	}
}

// Collecting a settled turn must not evict it. The old hub removed a job as soon as one client took
// its `done`; with two subscribers the first collector took it away from the second, and a client
// that read the transcript over REST just before subscribing would get `not_running` for a turn it
// had not seen finish.
func TestFinishedTurnIsNotEvictedByCollection(t *testing.T) {
	f := newFanoutTest(t)
	f.hub.PutJob("conv-a", &pkgTurns.Turn{
		ConversationID: "conv-a", TurnID: "turn-1", IsDone: true, ExitCode: 0,
		FinishedAt: time.Now(), StartedAt: time.Now(), PromptText: "go",
		Blocks: []agentapi.TurnBlock{{Kind: agentapi.BlockKindText, Text: "all done"}},
	})

	for _, name := range []string{"first", "second"} {
		conn, _ := f.connect()
		sendFrame(t, conn, map[string]any{"type": "subscribe", "conversationIds": []string{"conv-a"}})
		msg := readFrame(t, conn)
		if msg["type"] != "sync" {
			t.Fatalf("%s socket: subscribe reply = %v, want sync", name, msg)
		}
		if msg["running"] != false {
			t.Errorf("%s socket: running = %v, want false", name, msg["running"])
		}
		if got := syncBlockText(msg); got != "all done" {
			t.Errorf("%s socket: blocks = %v, want the whole reply", name, got)
		}
	}
	if f.hub.GetJob("conv-a") == nil {
		t.Error("the settled turn was evicted by being collected; only the janitor may evict")
	}
}

// A socket dying is not a turn dying. The whole feature rests on this: a tab that navigated away,
// crashed or was closed leaves its turns running, still recording, still parked on an unanswered
// permission request.
func TestDisconnectDropsSubscriptionsNotJobs(t *testing.T) {
	f := newFanoutTest(t)
	f.hub.PutJob("conv-a", &pkgTurns.Turn{ConversationID: "conv-a", TurnID: "turn-1"})
	conn, server := f.connect()
	f.subscribeTo(conn, "conv-a")
	if n := f.hub.SubscriberCount("conv-a"); n != 1 {
		t.Fatalf("subscribers = %d, want 1", n)
	}

	conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	for f.hub.SubscriberCount("conv-a") != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := f.hub.SubscriberCount("conv-a"); n != 0 {
		t.Errorf("subscribers = %d after the socket closed, want 0", n)
	}
	f.hub.Mu.Lock()
	_, stillRegistered := f.hub.Conns[server.Id]
	f.hub.Mu.Unlock()
	if stillRegistered {
		t.Error("the socket is still in the connection registry after closing")
	}
	if f.hub.GetJob("conv-a") == nil {
		t.Error("the turn was dropped with the socket; a turn outlives every socket watching it")
	}
}

// `hello` is what a reconnecting tab uses to work out what to re-subscribe to, so it has to name
// the conversations with a turn running right now — and only those.
func TestHelloListsRunningConversations(t *testing.T) {
	f := newFanoutTest(t)
	f.hub.PutJob("conv-running", &pkgTurns.Turn{ConversationID: "conv-running"})
	f.hub.PutJob("conv-settled", &pkgTurns.Turn{
		ConversationID: "conv-settled", IsDone: true, FinishedAt: time.Now(),
	})

	conn := dialClaude(t, f.url)
	defer conn.Close()
	hello := readFrame(t, conn)

	running, _ := hello["runningConversations"].([]any)
	if len(running) != 1 || running[0] != "conv-running" {
		t.Errorf("runningConversations = %v, want only the live turn", hello["runningConversations"])
	}
	if max, _ := hello["maxConcurrentTurns"].(float64); int(max) != f.hub.MaxTurns {
		t.Errorf("maxConcurrentTurns = %v, want %d", hello["maxConcurrentTurns"], f.hub.MaxTurns)
	}
}

// A registry frame goes to every open socket, subscribed or not. That is the one thing a
// subscription-scoped fan-out cannot do, and it is what keeps a conversation list live in a tab that
// is looking at a document instead.
func TestRegistryFrameReachesAnUnsubscribedSocket(t *testing.T) {
	f := newFanoutTest(t)
	conn, _ := f.connect()

	f.hub.BroadcastRegistry(map[string]any{
		"type": "conversation_deleted", "conversationId": "conv-a",
	})

	msg := readFrame(t, conn)
	if msg["type"] != "conversation_deleted" || msg["conversationId"] != "conv-a" {
		t.Errorf("frame = %v, want conversation_deleted for conv-a", msg)
	}
}

// Watching someone else's turn is fine — visibility is the registry's call. Killing it is not.
func TestStopFromAnotherUserIsRefused(t *testing.T) {
	f := newFanoutTest(t)
	conn, server := f.connect()
	f.subscribeTo(conn, "conv-a")
	driver := &stubDriver{events: make(chan agentapi.AgentEvent)}
	driver.drain()
	f.hub.PutJob("conv-a", &pkgTurns.Turn{
		ConversationID: "conv-a", TurnID: "turn-1", Owner: "alice", Driver: driver,
	})

	f.hub.HandleStop(server, access.Identity{User: "mallory"}, pkgTurns.Command{ConversationID: "conv-a"})
	msg := readFrame(t, conn)
	if msg["type"] != "error" || msg["code"] != turnevents.ErrCodeNotPermitted {
		t.Fatalf("stop by another user = %v, want an error with code %s", msg, turnevents.ErrCodeNotPermitted)
	}
	if !f.hub.IsRunning("conv-a") {
		t.Error("the turn was stopped by a user who does not own it")
	}

	f.hub.HandleStop(server, access.Identity{User: "alice"}, pkgTurns.Command{ConversationID: "conv-a"})
	if msg := readFrame(t, conn); msg["type"] != "stopped" {
		t.Errorf("stop by the owner = %v, want stopped", msg)
	}
	if !driver.wasStopped() {
		t.Error("the owner's stop did not reach the agent")
	}
}

// assistantTextEvent and assistantToolEvent are the two shapes of the CLI's `assistant` event this
// service reads: a finished text block, and a tool call.
func assistantTextEvent(text string) map[string]any {
	return assistantEvent("msg-1", map[string]any{"type": "text", "text": text})
}

func assistantToolEvent(name, path string) map[string]any {
	return assistantEvent("msg-1", map[string]any{
		"type": "tool_use", "name": name, "input": map[string]any{"file_path": path},
	})
}

// assistantEvent builds one `assistant` event from the content blocks it is given, in that order.
// The message id is carried because the CLI carries it — several events share one, each announcing
// a different finished block of that message — and never because a block is identified by it.
func assistantEvent(messageID string, blocks ...map[string]any) map[string]any {
	content := make([]any, 0, len(blocks))
	for _, block := range blocks {
		content = append(content, block)
	}
	return map[string]any{"type": "assistant", "message": map[string]any{
		"id": messageID, "content": content,
	}}
}

// syncBlockText joins the text a `sync` frame's blocks carry, for a test that only cares that the
// reply came back whole.
func syncBlockText(frame map[string]any) string {
	var sb strings.Builder
	blocks, _ := frame["blocks"].([]any)
	for _, blockAny := range blocks {
		block, _ := blockAny.(map[string]any)
		if block["kind"] == agentapi.BlockKindText {
			sb.WriteString(protocol.AsString(block["text"]))
		}
	}
	return sb.String()
}
