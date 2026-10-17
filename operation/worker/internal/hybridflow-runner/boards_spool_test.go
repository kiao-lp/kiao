package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"kiao/worker/internal/core"
)

// The spooling store against a fake hybridflow-store: what reaches it live, what is queued while
// it is down, and what lands once it is back.

// spoolFake is the hybridflow-store's board and agent surface, just enough of it for the runner's
// marks: the board read, the claim and release calls, the field patch, one agent read and the
// settle. `down` cuts the link with a 503; `fail` refuses one mark with a terminal status.
type spoolFake struct {
	mu       sync.Mutex
	down     bool
	boards   map[string]*boardContent
	agents   map[string]managedAgent
	received []string
	bills    []usagePayload
	fail     map[string]int
}

func newSpoolFake(boards map[string]*boardContent) *spoolFake {
	return &spoolFake{boards: boards, agents: map[string]managedAgent{}, fail: map[string]int{}}
}

func (f *spoolFake) setDown(down bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.down = down
}

func (f *spoolFake) snapshot() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.received...)
}

func (f *spoolFake) flowNodeOf(handle, flowNodeID string) *flowNode {
	f.mu.Lock()
	defer f.mu.Unlock()
	board, ok := f.boards[handle]
	if !ok {
		return nil
	}
	flowNode := board.flowNode(flowNodeID)
	if flowNode == nil {
		return nil
	}
	out := *flowNode
	return &out
}

func (f *spoolFake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"the store is down"}`))
		return
	}
	answer := func(status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")

	// GET /boards/{handle} — the board, whole.
	if r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "boards" {
		board, ok := f.boards[parts[1]]
		if !ok {
			answer(http.StatusNotFound, map[string]string{"error": "no such board"})
			return
		}
		answer(http.StatusOK, boardPayload{FlowNodes: board.FlowNodes})
		return
	}
	// POST /boards/{handle}/flow nodes/{id}/play — take the card.
	if r.Method == http.MethodPost && len(parts) == 5 && parts[0] == "boards" && parts[2] == "flow-nodes" && parts[4] == "play" {
		board, ok := f.boards[parts[1]]
		if !ok || board.flowNode(parts[3]) == nil {
			answer(http.StatusNotFound, map[string]string{"error": "no such card"})
			return
		}
		board.start(parts[3])
		f.received = append(f.received, "play "+parts[3])
		answer(http.StatusOK, board.flowNode(parts[3]))
		return
	}
	// POST /boards/{handle}/flow nodes/{id}/played — hand it back at a status.
	if r.Method == http.MethodPost && len(parts) == 5 && parts[0] == "boards" && parts[2] == "flow-nodes" && parts[4] == "played" {
		board, ok := f.boards[parts[1]]
		if !ok || board.flowNode(parts[3]) == nil {
			answer(http.StatusNotFound, map[string]string{"error": "no such card"})
			return
		}
		var payload struct {
			Status string `json:"status"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		f.received = append(f.received, "played "+parts[3]+" "+payload.Status)
		if status, forced := f.fail["played:"+parts[3]]; forced {
			answer(status, map[string]string{"error": "forced for the test"})
			return
		}
		board.setStatus(parts[3], payload.Status)
		answer(http.StatusOK, board.flowNode(parts[3]))
		return
	}
	// PATCH /boards/{handle}/flow nodes/{id} — one field of one card.
	if r.Method == http.MethodPatch && len(parts) == 4 && parts[0] == "boards" && parts[2] == "flow-nodes" {
		board, ok := f.boards[parts[1]]
		if !ok || board.flowNode(parts[3]) == nil {
			answer(http.StatusNotFound, map[string]string{"error": "no such card"})
			return
		}
		var payload map[string]string
		_ = json.NewDecoder(r.Body).Decode(&payload)
		for field, value := range payload {
			switch field {
			case "status":
				board.setStatus(parts[3], value)
				f.received = append(f.received, "patch "+parts[3]+" status")
			case "chat":
				board.setChat(parts[3], value)
				f.received = append(f.received, "patch "+parts[3]+" chat")
			}
		}
		answer(http.StatusOK, board.flowNode(parts[3]))
		return
	}
	// GET /agents/{id} — one managed agent.
	if r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "agents" {
		agent, ok := f.agents[parts[1]]
		if !ok {
			answer(http.StatusNotFound, map[string]string{"error": "no such agent"})
			return
		}
		answer(http.StatusOK, agent)
		return
	}
	// POST /runs/{run}/settle — free the run's cards.
	if r.Method == http.MethodPost && len(parts) == 3 && parts[0] == "runs" && parts[2] == "settle" {
		f.received = append(f.received, "settle "+parts[1])
		answer(http.StatusOK, map[string]int{"settled": 0})
		return
	}
	// POST /boards/{handle}/flow nodes/{id}/usage — file what a turn cost.
	if r.Method == http.MethodPost && len(parts) == 5 && parts[0] == "boards" && parts[2] == "flow-nodes" && parts[4] == "usage" {
		var payload usagePayload
		_ = json.NewDecoder(r.Body).Decode(&payload)
		f.received = append(f.received, "usage "+parts[3])
		f.bills = append(f.bills, payload)
		if status, forced := f.fail["usage:"+parts[3]]; forced {
			answer(status, map[string]string{"error": "forced for the test"})
			return
		}
		answer(http.StatusCreated, map[string]string{"id": payload.ID})
		return
	}
	answer(http.StatusNotFound, map[string]string{"error": "no such route"})
}

// newSpoolTestStore wraps the fake in a spooling store flushing in milliseconds, over a spool file
// of its own.
func newSpoolTestStore(t *testing.T, fake *spoolFake) (*spoolingHybridflowStore, string) {
	t.Helper()
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	spoolPath := filepath.Join(t.TempDir(), hybridflowSpoolFileName)
	store := newSpoolingHybridflowStore(newHybridflowStore(server.URL, "token"), spoolPath)
	store.testIntervals(10*time.Millisecond, 50*time.Millisecond)
	t.Cleanup(func() { _ = store.Close() })
	return store, spoolPath
}

// spoolLines reads the spool file back as its records. A missing file is an empty queue, not an
// error.
func spoolLines(t *testing.T, spoolPath string) []spoolRecord {
	t.Helper()
	data, err := os.ReadFile(spoolPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatalf("read the spool: %v", err)
	}
	var out []spoolRecord
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var rec spoolRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("a spooled line is not a record: %v", err)
		}
		out = append(out, rec)
	}
	return out
}

func waitForSpool(t *testing.T, what string, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func spoolBoard() *boardContent {
	return &boardContent{
		FlowNodes: []flowNode{
			{ID: "flow-node-1", Title: "First", Body: "Do the first thing."},
			{ID: "flow-node-2", Title: "Second", Body: "Do the second thing."},
		},
	}
}

// While the store is up, marks go straight through: the spool stays empty and the answer is the
// store's own.
func TestSpoolingStoreWritesThroughWhenUp(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	board, err := store.Start("major", "flow-node-1", "run-1")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != flowNodeStatusRunning {
		t.Fatalf("taken flow node = %+v, want it running", flowNode)
	}
	if _, err := store.Chat("major", "flow-node-1", "conv-1"); err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if got := fake.snapshot(); len(got) != 2 || got[0] != "play flow-node-1" || got[1] != "patch flow-node-1 chat" {
		t.Fatalf("the store saw %v, want the two marks in order", got)
	}
	if lines := spoolLines(t, spoolPath); len(lines) != 0 {
		t.Fatalf("the spool holds %d records, want none while the store is up", len(lines))
	}
}

// Offering the card a turn again goes through like any other mark — and like any other mark it is
// queued while the link is down and replayed once it is back.
func TestSpoolingStoreReadyOffersTheCardAgain(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	board, err := store.Ready("major", "flow-node-1")
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != "" {
		t.Fatalf("readied flow node = %+v, want it waiting to be played", flowNode)
	}
	if got := fake.snapshot(); len(got) != 1 || got[0] != "patch flow-node-1 status" {
		t.Fatalf("the store saw %v, want the status patched", got)
	}

	if _, err := store.Board("major"); err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)
	board, err = store.Ready("major", "flow-node-1")
	if err != nil {
		t.Fatalf("Ready while down: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != "" {
		t.Fatalf("readied flow node = %+v, want it waiting from the cache", flowNode)
	}
	lines := spoolLines(t, spoolPath)
	if len(lines) != 1 || lines[0].Op != spoolReady {
		t.Fatalf("the spool holds %v, want the ready mark queued", lines)
	}
	fake.setDown(false)
	waitForSpool(t, "the queue to flush", func() bool {
		return len(spoolLines(t, spoolPath)) == 0
	})
	if got := fake.snapshot(); got[len(got)-1] != "patch flow-node-1 status" {
		t.Fatalf("the store saw %v, want the ready mark replayed last", got)
	}
}

// While it is down, marks are answered from the cache and queued as JSONL; once it is back, the
// sender replays them in order and the spool empties.
func TestSpoolingStoreSpoolsWhileDownAndFlushesWhenUp(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	if _, err := store.Board("major"); err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)

	board, err := store.Start("major", "flow-node-1", "run-1")
	if err != nil {
		t.Fatalf("Start while down: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != flowNodeStatusRunning {
		t.Fatalf("taken flow node = %+v, want it running from the cache", flowNode)
	}
	if _, err := store.Chat("major", "flow-node-1", "conv-1"); err != nil {
		t.Fatalf("Chat while down: %v", err)
	}
	board, err = store.Finish("major", "flow-node-1", "run-1", flowNodeStatusDone)
	if err != nil {
		t.Fatalf("Finish while down: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != flowNodeStatusDone || flowNode.Chat != "conv-1" {
		t.Fatalf("finished flow node = %+v, want it done in its chat", flowNode)
	}
	lines := spoolLines(t, spoolPath)
	if len(lines) != 3 || lines[0].Op != spoolStart || lines[1].Op != spoolChat || lines[2].Op != spoolFinish {
		t.Fatalf("the spool holds %v, want the three marks in order", lines)
	}
	if got := fake.snapshot(); len(got) != 0 {
		t.Fatalf("the store saw %v while down, want nothing", got)
	}

	fake.setDown(false)
	waitForSpool(t, "the queue to flush", func() bool {
		return len(fake.snapshot()) == 3 && len(spoolLines(t, spoolPath)) == 0
	})
	if got := fake.snapshot(); len(got) != 3 ||
		got[0] != "play flow-node-1" || got[1] != "patch flow-node-1 chat" || got[2] != "played flow-node-1 done" {
		t.Fatalf("the store saw %v, want the three marks in order", got)
	}
	board, err = store.Board("major")
	if err != nil {
		t.Fatalf("Board after the flush: %v", err)
	}
	if flowNode := board.flowNode("flow-node-1"); flowNode == nil || flowNode.Status != flowNodeStatusDone || flowNode.Chat != "conv-1" {
		t.Fatalf("flushed flow node = %+v, want it done in its chat", flowNode)
	}
}

// Reads fall back to the cached board while the link is down — a refused connection as well as a
// 503 — but a board never read has nothing to fall back to, and a live refusal is never masked by
// a copy of what is gone.
func TestSpoolingStoreReadsBoardsFromCacheWhileDown(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	primed, err := store.Board("major")
	if err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)
	cached, err := store.Board("major")
	if err != nil {
		t.Fatalf("Board while down: %v", err)
	}
	if cached.flowNode("flow-node-1") == nil || cached.flowNode("flow-node-1").Title != primed.flowNode("flow-node-1").Title {
		t.Fatalf("cached board = %+v, want the board as primed", cached.FlowNodes)
	}
	if _, err := store.Board("ghost"); err == nil {
		t.Fatal("a board never read while down: no error")
	}
	fake.setDown(false)
	if _, err := store.Board("ghost"); err == nil {
		t.Fatal("a board nothing holds while up: no error")
	}

	// A store that is gone, not one answering 503s: the sender is stopped so the address can be
	// repointed at a dead port without racing it.
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	store.inner.base = "http://127.0.0.1:1"
	if _, err := store.Board("major"); err != nil {
		t.Fatalf("Board with the store gone: %v", err)
	}
	board, err := store.Start("major", "flow-node-2", "run-9")
	if err != nil {
		t.Fatalf("Start with the store gone: %v", err)
	}
	if flowNode := board.flowNode("flow-node-2"); flowNode == nil || flowNode.Status != flowNodeStatusRunning {
		t.Fatalf("taken flow node = %+v, want it running from the cache", flowNode)
	}
	if lines := spoolLines(t, spoolPath); len(lines) != 1 || lines[0].Op != spoolStart {
		t.Fatalf("the spool holds %v, want the one queued mark", lines)
	}
}

// A queued mark the store refuses at flush time is dropped and the queue moves past it, rather
// than retrying what a retry cannot fix.
func TestSpoolingStoreDropsRefusedMarksAndKeepsGoing(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	if _, err := store.Board("major"); err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)
	if _, err := store.Finish("major", "flow-node-1", "run-1", flowNodeStatusDone); err != nil {
		t.Fatalf("Finish while down: %v", err)
	}
	if _, err := store.Chat("major", "flow-node-1", "conv-9"); err != nil {
		t.Fatalf("Chat while down: %v", err)
	}

	fake.mu.Lock()
	fake.fail["played:flow-node-1"] = http.StatusConflict
	fake.mu.Unlock()
	fake.setDown(false)
	waitForSpool(t, "the queue to drain", func() bool { return len(spoolLines(t, spoolPath)) == 0 })
	if got := fake.snapshot(); len(got) != 2 ||
		got[0] != "played flow-node-1 done" || got[1] != "patch flow-node-1 chat" {
		t.Fatalf("the store saw %v, want the refused mark attempted and the next one sent", got)
	}
}

// What is still queued at shutdown is reloaded by the next process and sent once the link is back.
func TestSpoolSurvivesRestart(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	if _, err := store.Board("major"); err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)
	if _, err := store.Start("major", "flow-node-1", "run-1"); err != nil {
		t.Fatalf("Start while down: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if lines := spoolLines(t, spoolPath); len(lines) != 1 {
		t.Fatalf("the spool holds %d records after the restart, want the one queued mark", len(lines))
	}

	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	fake.setDown(false)
	restarted := newSpoolingHybridflowStore(newHybridflowStore(server.URL, "token"), spoolPath)
	restarted.testIntervals(10*time.Millisecond, 50*time.Millisecond)
	t.Cleanup(func() { _ = restarted.Close() })
	waitForSpool(t, "the reloaded mark to land", func() bool {
		return len(fake.snapshot()) == 1 && len(spoolLines(t, spoolPath)) == 0
	})
	if got := fake.snapshot(); len(got) != 1 || got[0] != "play flow-node-1" {
		t.Fatalf("the store saw %v, want the reloaded mark", got)
	}
}

// Managed agents are cached like boards: a play resolves them before every card, so a chain
// walking across an outage reads the last definition seen. Unknown stays unknown.
func TestSpoolingStoreCachesAgents(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	fake.agents["agent-1"] = managedAgent{Name: "Reviewer", Platform: "claude", Model: "opus", Instructions: "Be concise."}
	store, _ := newSpoolTestStore(t, fake)

	found, err := store.Agent("agent-1")
	if err != nil {
		t.Fatalf("Agent: %v", err)
	}
	fake.setDown(true)
	cached, err := store.Agent("agent-1")
	if err != nil {
		t.Fatalf("Agent while down: %v", err)
	}
	if *cached != *found {
		t.Fatalf("cached agent = %+v, want %+v", cached, found)
	}
	fake.setDown(false)
	if _, err := store.Agent("ghost"); !errors.Is(err, ErrAgentUnknown) {
		t.Fatalf("an id nothing holds = %v, want unknown rather than a failure", err)
	}
}

// The run across an outage, end to end: both turns play with the link cut, their marks queue on
// the spool, and the board is updated once the store is back.
func TestChainRunContinuesWhileHybridflowStoreIsDown(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	rt.answers("The first answer.", "The second answer.")

	fake := newSpoolFake(map[string]*boardContent{"major": rt.board()})
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	spoolPath := filepath.Join(t.TempDir(), hybridflowSpoolFileName)
	spooled := newSpoolingHybridflowStore(newHybridflowStore(server.URL, "token"), spoolPath)
	spooled.testIntervals(10*time.Millisecond, 50*time.Millisecond)
	t.Cleanup(func() { _ = spooled.Close() })
	rt.runner.boards = spooled

	if _, err := spooled.Board("major"); err != nil {
		t.Fatalf("prime the cache: %v", err)
	}
	fake.setDown(true)
	if _, err := rt.runner.play(core.Identity{User: "tester"}, "major", "flow-node-1", "Nightly"); err != nil {
		t.Fatalf("play while down: %v", err)
	}
	rt.waitIdle()

	if last := rt.last(); last == nil || last.State != chainRunStateEnded {
		t.Fatalf("the run is %+v, want it ended", last)
	}
	if prompts := rt.prompts(); len(prompts) != 2 {
		t.Fatalf("%d turns played while down, want the two of the chain", len(prompts))
	}
	// Take, chat and finish for each of the two cards.
	if lines := spoolLines(t, spoolPath); len(lines) != 6 {
		t.Fatalf("the spool holds %d records, want the six marks of the chain", len(lines))
	}
	if got := fake.snapshot(); len(got) != 0 {
		t.Fatalf("the store saw %v while down, want nothing", got)
	}

	fake.setDown(false)
	waitForSpool(t, "the board to be updated", func() bool { return len(spoolLines(t, spoolPath)) == 0 })
	for _, id := range []string{"flow-node-1", "flow-node-2"} {
		flowNode := fake.flowNodeOf("major", id)
		if flowNode == nil || flowNode.Status != flowNodeStatusDone || flowNode.Chat == "" {
			t.Fatalf("flow node %s = %+v, want it done in its chat", id, flowNode)
		}
	}
}

// A usage report files by queueing and returning, and the sender the enqueue wakes posts it
// at once: filed and sent within the same breath, with the bill whole.
func TestSpoolingStoreQueuesUsageFirstAndPostsItAtOnce(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)

	micros := int64(23400)
	report := UsageReport{
		ID: "usage-1", RunID: "run-1", Model: "muse-spark",
		ReportedAt:  time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC),
		InputTokens: 100, OutputTokens: 50, CacheReadTokens: 10, CacheWriteTokens: 5,
		ReasoningTokens: 20, CostUsdMicros: &micros,
	}
	if err := store.ReportUsage("major", "flow-node-1", report); err != nil {
		t.Fatalf("ReportUsage: %v", err)
	}
	waitForSpool(t, "the bill to post", func() bool { return len(fake.snapshot()) == 1 })
	if got := fake.snapshot(); len(got) != 1 || got[0] != "usage flow-node-1" {
		t.Fatalf("the store saw %v, want the bill posted", got)
	}
	fake.mu.Lock()
	bills := append([]usagePayload(nil), fake.bills...)
	fake.mu.Unlock()
	if len(bills) != 1 {
		t.Fatalf("the store saw %d bills, want one", len(bills))
	}
	bill := bills[0]
	if bill.ID != "usage-1" || bill.Run != "run-1" || bill.Model != "muse-spark" ||
		bill.InputTokens != 100 || bill.OutputTokens != 50 ||
		bill.CacheReadTokens != 10 || bill.CacheWriteTokens != 5 || bill.ReasoningTokens != 20 {
		t.Errorf("bill = %+v", bill)
	}
	if bill.CostUsdMicros == nil || *bill.CostUsdMicros != 23400 {
		t.Errorf("cost = %v, want 23400", bill.CostUsdMicros)
	}
	if bill.ReportedAt != "2026-10-12T10:00:00Z" {
		t.Errorf("reported at = %q", bill.ReportedAt)
	}
	waitForSpool(t, "the spool to empty", func() bool { return len(spoolLines(t, spoolPath)) == 0 })
}

// With the link down, a usage report still files — on the disk, with the bill whole —
// rather than failing the play. Once the link is back, the sender replays it like any other
// queued write.
func TestSpoolingStoreFilesUsageWhileDownAndReplaysItWhenUp(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	store, spoolPath := newSpoolTestStore(t, fake)
	fake.setDown(true)

	micros := int64(1000)
	if err := store.ReportUsage("major", "flow-node-1", UsageReport{
		ID: "usage-2", RunID: "run-1", InputTokens: 200, CostUsdMicros: &micros,
	}); err != nil {
		t.Fatalf("ReportUsage while down: %v", err)
	}
	lines := spoolLines(t, spoolPath)
	if len(lines) != 1 || lines[0].Op != spoolUsage || lines[0].Usage == nil {
		t.Fatalf("the spool holds %v, want the bill queued", lines)
	}
	if lines[0].Usage.ID != "usage-2" || lines[0].Usage.InputTokens != 200 ||
		lines[0].Usage.CostUsdMicros == nil || *lines[0].Usage.CostUsdMicros != 1000 {
		t.Errorf("queued bill = %+v", lines[0].Usage)
	}
	if got := fake.snapshot(); len(got) != 0 {
		t.Fatalf("the store saw %v while down, want nothing", got)
	}

	fake.setDown(false)
	waitForSpool(t, "the bill to replay", func() bool { return len(fake.snapshot()) == 1 })
	if got := fake.snapshot(); got[0] != "usage flow-node-1" {
		t.Fatalf("the store saw %v, want the bill replayed", got)
	}
	waitForSpool(t, "the spool to empty", func() bool { return len(spoolLines(t, spoolPath)) == 0 })
}

// A bill the store refuses at flush time is dropped, not retried: no retry fixes a 400.
func TestSpoolingStoreDropsARefusedUsageBill(t *testing.T) {
	fake := newSpoolFake(map[string]*boardContent{"major": spoolBoard()})
	fake.fail["usage:flow-node-1"] = http.StatusBadRequest
	store, spoolPath := newSpoolTestStore(t, fake)

	if err := store.ReportUsage("major", "flow-node-1", UsageReport{ID: "usage-3", RunID: "run-1"}); err != nil {
		t.Fatalf("ReportUsage: %v", err)
	}
	waitForSpool(t, "the bill to be refused", func() bool { return len(fake.snapshot()) == 1 })
	waitForSpool(t, "the spool to empty", func() bool { return len(spoolLines(t, spoolPath)) == 0 })
}
