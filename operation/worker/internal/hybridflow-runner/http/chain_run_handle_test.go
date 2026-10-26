package runnerhttp

import (
	"encoding/json"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	"net/http"
	"strings"
	pkgSync "sync"
	"testing"
)

// memoryBoards is a BoardStore holding its boards in memory, under their handles: the shape the
// service implementation answers with, without a database beside the test. Claims included: a
// card is taken by one run, and a second run reaching for it is refused, exactly as the store
// refuses it — which is what makes a replay of a card a run never gave back fail here the way it
// fails there.
type memoryBoards struct {
	mu     pkgSync.Mutex
	boards map[string]*pkgBoards.BoardContent
	// settled is every run freed, in order: what a test reads to say a replay took the card back
	// rather than tripping over the run that held it.
	settled []string
	// usage is every bill filed, in order: what a test reads to say a turn reported its spend.
	usage []pkgBoards.UsageReport
}

var _ pkgBoards.BoardStore = (*memoryBoards)(nil)

func newMemoryBoards(t *testing.T, boards map[string]*pkgBoards.BoardContent) *memoryBoards {
	t.Helper()
	out := &memoryBoards{boards: map[string]*pkgBoards.BoardContent{}}
	for handle, board := range boards {
		out.boards[handle] = copyBoard(t, board)
	}
	return out
}

// copyBoard clones a board through its own encoding, so what the runner holds can never be what
// the store mutates under it — the same isolation the service implementation gets from parsing
// every board afresh.
func copyBoard(t *testing.T, board *pkgBoards.BoardContent) *pkgBoards.BoardContent {
	t.Helper()
	raw, err := json.Marshal(board)
	if err != nil {
		t.Fatalf("encode the board: %v", err)
	}
	var out pkgBoards.BoardContent
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode the board: %v", err)
	}
	return &out
}

func (m *memoryBoards) Board(handle string) (*pkgBoards.BoardContent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	board, ok := m.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	raw, err := json.Marshal(board)
	if err != nil {
		return nil, err
	}
	var out pkgBoards.BoardContent
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (m *memoryBoards) apply(handle, flowNodeID, runID string, change func(*pkgBoards.BoardContent) bool) (*pkgBoards.BoardContent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	board, ok := m.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	change(board)
	raw, err := json.Marshal(board)
	if err != nil {
		return nil, err
	}
	var out pkgBoards.BoardContent
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (m *memoryBoards) Start(handle, flowNodeID, runID string) (*pkgBoards.BoardContent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	board, ok := m.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such flow node on this board: " + flowNodeID}
	}
	if flowNode.Run != "" && flowNode.Run != runID {
		return nil, &httpkit.HTTPError{Status: http.StatusConflict,
			Msg: "flow node is already being played: run " + flowNode.Run + " has it"}
	}
	flowNode.Run = runID
	board.Start(flowNodeID)
	return m.copyLocked(board)
}

func (m *memoryBoards) copyLocked(board *pkgBoards.BoardContent) (*pkgBoards.BoardContent, error) {
	raw, err := json.Marshal(board)
	if err != nil {
		return nil, err
	}
	var out pkgBoards.BoardContent
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (m *memoryBoards) Reopen(handle, flowNodeID, runID string) (*pkgBoards.BoardContent, error) {
	return m.apply(handle, flowNodeID, runID, func(board *pkgBoards.BoardContent) bool { return board.Reopen(flowNodeID) })
}

func (m *memoryBoards) Hold(handle, flowNodeID, runID string) (*pkgBoards.BoardContent, error) {
	return m.apply(handle, flowNodeID, runID, func(board *pkgBoards.BoardContent) bool { return board.Hold(flowNodeID) })
}

func (m *memoryBoards) Finish(handle, flowNodeID, runID, status string) (*pkgBoards.BoardContent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	board, ok := m.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such flow node on this board: " + flowNodeID}
	}
	if flowNode.Run != runID {
		return nil, &httpkit.HTTPError{Status: http.StatusConflict,
			Msg: "card " + flowNodeID + " is not held by run " + runID}
	}
	flowNode.Run = ""
	board.SetStatus(flowNodeID, status)
	return m.copyLocked(board)
}

func (m *memoryBoards) Chat(handle, flowNodeID, chat string) (*pkgBoards.BoardContent, error) {
	return m.apply(handle, flowNodeID, "", func(board *pkgBoards.BoardContent) bool { return board.SetChat(flowNodeID, chat) })
}

func (m *memoryBoards) Drop(handle, flowNodeID, runID string) (*pkgBoards.BoardContent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	board, ok := m.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	// The guard is the whole of it: a card this run no longer holds is left exactly as it is,
	// which is the ordinary case rather than an error.
	if flowNode := board.FlowNode(flowNodeID); flowNode != nil && flowNode.Run == runID {
		flowNode.Run = ""
		board.SetStatus(flowNodeID, pkgBoards.FlowNodeStatusInterrupted)
	}
	return m.copyLocked(board)
}

func (m *memoryBoards) Ready(handle, flowNodeID string) (*pkgBoards.BoardContent, error) {
	return m.apply(handle, flowNodeID, "", func(board *pkgBoards.BoardContent) bool {
		return board.SetStatus(flowNodeID, pkgBoards.FlowNodeStatusReady)
	})
}

func (m *memoryBoards) ReportUsage(handle, flowNodeID string, report pkgBoards.UsageReport) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.boards[handle]; !ok {
		return &httpkit.HTTPError{Status: http.StatusNotFound, Msg: "no such board: " + handle}
	}
	m.usage = append(m.usage, report)
	return nil
}

func (m *memoryBoards) SettleRun(runID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.settled = append(m.settled, runID)
	freed := 0
	for _, board := range m.boards {
		for i := range board.FlowNodes {
			if board.FlowNodes[i].Run == runID {
				board.FlowNodes[i].Run = ""
				board.SetStatus(board.FlowNodes[i].ID, pkgBoards.FlowNodeStatusInterrupted)
				freed++
			}
		}
	}
	return freed, nil
}

// TestChainRunPlaysABoardNamedByItsHandle plays the chain through a store that knows the board
// under `major` and under nothing else: the name the browser sends is the name the runner asks
// the store for, with no document path anywhere in between.
func TestChainRunPlaysABoardNamedByItsHandle(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionEnd))
	rt.answers("The first answer.", "The second answer.")
	rt.runner.Boards = newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": rt.board()})

	run, err := rt.runner.Play(access.Identity{User: "tester"}, "major", "flow-node-1", "Nightly")
	if err != nil {
		t.Fatalf("play flow-node-1 of major: %v", err)
	}
	if run.Handle != "major" {
		t.Fatalf("run handle = %q, want the handle it was started on", run.Handle)
	}
	rt.waitIdle()

	board, err := rt.runner.Boards.Board("major")
	if err != nil {
		t.Fatalf("read the board back: %v", err)
	}
	for _, id := range []string{"flow-node-1", "flow-node-2"} {
		flowNode := board.FlowNode(id)
		if flowNode == nil {
			t.Fatalf("no flow node %s on the board", id)
		}
		if flowNode.Status != pkgBoards.FlowNodeStatusDone {
			t.Errorf("flow node %s status = %q, want done", id, flowNode.Status)
		}
		if flowNode.Body == "" {
			t.Errorf("flow node %s has no description left", id)
		}
	}
}

// TestChainRunPlayNamesNoBoard says what an empty name gets: a refusal, and not a read of
// whatever the store would make of nothing.
func TestChainRunPlayNamesNoBoard(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionEnd))
	if _, err := rt.runner.Play(access.Identity{User: "tester"}, "  ", "flow-node-1", ""); err == nil {
		t.Fatal("play with no board named: no error")
	}
}

// TestChainRunReplaysACardHeldByAGoneRun is the replay: a card whose run died holding it —
// the service restarted under it, the process went away — and which somebody set ready again.
// Playing it sends its body into the chat it already has, taking the card back from the run that
// is gone rather than tripping over it.
func TestChainRunReplaysACardHeldByAGoneRun(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionEnd))
	chat := mustCreateConversation(t, rt.convs, "/")
	boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": rt.board()})
	boards.mu.Lock()
	first := boards.boards["major"].FlowNode("flow-node-1")
	first.Run = "run-dead"
	first.Chat = chat.ID
	first.OnSuccess.FlowNode = ""
	boards.mu.Unlock()
	rt.runner.Boards = boards

	if _, err := rt.runner.Play(access.Identity{User: "tester"}, "major", "flow-node-1", "Replay"); err != nil {
		t.Fatalf("replay the card run-dead held: %v", err)
	}
	rt.waitIdle()

	boards.mu.Lock()
	settled := append([]string(nil), boards.settled...)
	boards.mu.Unlock()
	if len(settled) != 1 || settled[0] != "run-dead" {
		t.Errorf("settled runs = %q, want the gone run freed once", settled)
	}
	board, err := boards.Board("major")
	if err != nil {
		t.Fatalf("read the board back: %v", err)
	}
	played := board.FlowNode("flow-node-1")
	if played == nil {
		t.Fatal("no flow node flow-node-1 on the board")
	}
	if played.Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("flow node status = %q, want done", played.Status)
	}
	if played.Run != "" {
		t.Errorf("flow node run = %q, want the card free", played.Run)
	}
	if played.Chat != chat.ID {
		t.Errorf("flow node chat = %q, want the chat it already had (%s)", played.Chat, chat.ID)
	}
	prompts := rt.prompts()
	if len(prompts) != 1 || !strings.Contains(prompts[0], "Do the first thing.") {
		t.Errorf("prompts sent = %q, want the card's body sent once", prompts)
	}
}

// TestChainRunPlayRefusesACardARunIsPlaying is the other half: a card a live run holds is not
// taken from it, whatever its status says — somebody setting it ready by hand does not end the
// play, and the claim is left where it is.
func TestChainRunPlayRefusesACardARunIsPlaying(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionEnd))
	chat := mustCreateConversation(t, rt.convs, "/")
	boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": rt.board()})
	boards.mu.Lock()
	first := boards.boards["major"].FlowNode("flow-node-1")
	first.Run = "run-live"
	first.Chat = chat.ID
	boards.mu.Unlock()
	rt.runner.Boards = boards
	rt.runner.Mu.Lock()
	rt.runner.Runs = append(rt.runner.Runs, &playback.ChainRun{
		Id: "run-live", Name: "Live", Handle: "major",
		FlowNodeID: "flow-node-1", Chat: chat.ID, State: playback.ChainRunStatePlaying,
	})
	rt.runner.Mu.Unlock()

	if _, err := rt.runner.Play(access.Identity{User: "tester"}, "major", "flow-node-1", "Replay"); err == nil {
		t.Fatal("play a card a live run holds: no error")
	} else if !strings.Contains(err.Error(), "already playing") {
		t.Fatalf("play a card a live run holds: error = %q, want the run named as playing it", err)
	}
	boards.mu.Lock()
	settled := append([]string(nil), boards.settled...)
	boards.mu.Unlock()
	if len(settled) != 0 {
		t.Errorf("settled runs = %q, want the live run's claim untouched", settled)
	}
}

// TestChainRunRestartTakesBackACardHeldByAGoneRun: restarting an ended run plays again from
// the card it started on, and takes it back first where the run holding it is gone — a restart
// is a play under a name the list already holds.
func TestChainRunRestartTakesBackACardHeldByAGoneRun(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionEnd))
	chat := mustCreateConversation(t, rt.convs, "/")
	boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": rt.board()})
	boards.mu.Lock()
	first := boards.boards["major"].FlowNode("flow-node-1")
	first.Run = "run-dead"
	first.Chat = chat.ID
	first.OnSuccess.FlowNode = ""
	boards.mu.Unlock()
	rt.runner.Boards = boards
	rt.runner.Mu.Lock()
	rt.runner.Runs = append(rt.runner.Runs, &playback.ChainRun{
		Id: "run-old", Name: "Old", Handle: "major",
		RootFlowNodeID: "flow-node-1", FlowNodeID: "flow-node-1",
		Chat: chat.ID, State: playback.ChainRunStateEnded,
	})
	rt.runner.Mu.Unlock()

	if _, err := rt.runner.Restart(access.Identity{User: "tester"}, "run-old"); err != nil {
		t.Fatalf("restart onto the card run-dead held: %v", err)
	}
	rt.waitIdle()

	boards.mu.Lock()
	settled := append([]string(nil), boards.settled...)
	boards.mu.Unlock()
	if len(settled) != 1 || settled[0] != "run-dead" {
		t.Errorf("settled runs = %q, want the gone run freed once", settled)
	}
	board, err := boards.Board("major")
	if err != nil {
		t.Fatalf("read the board back: %v", err)
	}
	played := board.FlowNode("flow-node-1")
	if played == nil {
		t.Fatal("no flow node flow-node-1 on the board")
	}
	if played.Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("flow node status = %q, want done", played.Status)
	}
	if played.Chat != chat.ID {
		t.Errorf("flow node chat = %q, want the chat it already had (%s)", played.Chat, chat.ID)
	}
}
