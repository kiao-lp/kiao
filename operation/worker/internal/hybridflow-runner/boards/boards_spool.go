package boards

import (
	"encoding/json"
	"errors"
	"kiao/worker/internal/core/http"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// hybridflowSpoolFileName is the spool under the state directory: one JSON object per line, each a
// write the store has not been told yet — a mark, or a turn's bill.
const HybridflowSpoolFileName = "hybridflow-spool.jsonl"

// spoolFlushInterval is how often the sender retries a queue the link would not take. Enqueues
// wake it immediately, so this only paces the retries of an outage.
const spoolFlushInterval = 5 * time.Second

// spoolBreakerInterval is how long one failed call keeps the fast path closed: while it holds,
// writes are spooled and reads served from the cache without touching the network, so a hung store
// stalls a run once rather than at every mark. Any answer from the store — success or refusal —
// reopens it at once.
const spoolBreakerInterval = 30 * time.Second

const SpoolStart = "start"

const spoolReopen = "reopen"

const spoolHold = "hold"

const SpoolFinish = "finish"

const SpoolChat = "chat"

const spoolDrop = "drop"

const SpoolReady = "ready"

const spoolSettle = "settle"

const SpoolUsage = "usage"

// spoolUsage is one turn's bill, as a queued usage record carries it: the report whole, under
// the names the spool file already uses for the flat ones.
type spoolBill struct {
	ID               string `json:"id,omitempty"`
	Model            string `json:"model,omitempty"`
	ReportedAt       string `json:"reportedAt,omitempty"`
	InputTokens      int64  `json:"inputTokens,omitempty"`
	OutputTokens     int64  `json:"outputTokens,omitempty"`
	CacheReadTokens  int64  `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64  `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64  `json:"reasoningTokens,omitempty"`
	CostUsdMicros    *int64 `json:"costUsdMicros,omitempty"`
}

// spoolRecord is one mark the store has not been told: enough to replay the call it was queued
// from. Only ids and the written value travel — never a board, never a description.
type SpoolRecord struct {
	Op       string     `json:"op"`
	Handle   string     `json:"handle,omitempty"`
	FlowNode string     `json:"flowNode,omitempty"`
	Run      string     `json:"run,omitempty"`
	Status   string     `json:"status,omitempty"`
	Chat     string     `json:"chat,omitempty"`
	Usage    *spoolBill `json:"usage,omitempty"`
	At       int64      `json:"at"`
}

// spoolingHybridflowStore is BoardStore over a hybridflowStore that survives the link going down:
// writes are spooled to disk and sent asynchronously, reads fall back to the last board seen.
type SpoolingHybridflowStore struct {
	Inner *HybridflowStore
	// path is the spool file, or "" for a store held in memory only — a test, or a process with
	// no state directory.
	path string

	// The two clocks, as fields so a test can flush in milliseconds. Production never changes
	// them. Read under the lock: the sender loop is already running while a test sets them.
	flushInterval   time.Duration
	breakerInterval time.Duration

	mu     sync.Mutex
	closed bool
	// pending is the marks queued in order, oldest first. Every change is persisted with it, so
	// the file and the memory always say the same thing.
	pending []SpoolRecord
	// boards holds independent copies for reads and optimistic writes during an outage.
	boards map[string]*BoardContent
	// downUntil is the fast path being closed: a moment in the future while the link is known
	// down, the zero time once anything proves it back.
	downUntil time.Time

	wake chan struct{}
	done chan struct{}
	wg   sync.WaitGroup
}

var _ BoardStore = (*SpoolingHybridflowStore)(nil)

var _ AgentResolver = (*SpoolingHybridflowStore)(nil)

var _ RunnerResolver = (*SpoolingHybridflowStore)(nil)

// newSpoolingHybridflowStore wraps a live client, reloads whatever the spool still holds from an
// earlier process, and starts the sender. The spool directory is created with the first mark.
func NewSpoolingHybridflowStore(inner *HybridflowStore, spoolPath string) *SpoolingHybridflowStore {
	s := &SpoolingHybridflowStore{
		Inner: inner, path: spoolPath,
		flushInterval: spoolFlushInterval, breakerInterval: spoolBreakerInterval,
		boards: map[string]*BoardContent{},
		wake:   make(chan struct{}, 1), done: make(chan struct{}),
	}
	s.load()
	s.wg.Add(1)
	go s.flushLoop()
	return s
}

// testIntervals sets the two clocks from a test, under the lock the running sender reads them
// with.
func (s *SpoolingHybridflowStore) TestIntervals(flush, breaker time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushInterval, s.breakerInterval = flush, breaker
}

// Close stops the sender, letting a send in flight land. The queue stays on disk for the next
// process.
func (s *SpoolingHybridflowStore) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	close(s.done)
	s.mu.Unlock()
	s.wg.Wait()
	return nil
}

func (s *SpoolingHybridflowStore) Start(handle, flowNodeID, runID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolStart, Handle: handle, FlowNode: flowNodeID, Run: runID},
		func() (*BoardContent, error) { return s.Inner.Start(handle, flowNodeID, runID) },
		func(board *BoardContent) { board.Start(flowNodeID) })
}

func (s *SpoolingHybridflowStore) Reopen(handle, flowNodeID, runID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: spoolReopen, Handle: handle, FlowNode: flowNodeID, Run: runID},
		func() (*BoardContent, error) { return s.Inner.Reopen(handle, flowNodeID, runID) },
		func(board *BoardContent) { board.Reopen(flowNodeID) })
}

func (s *SpoolingHybridflowStore) Hold(handle, flowNodeID, runID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: spoolHold, Handle: handle, FlowNode: flowNodeID, Run: runID},
		func() (*BoardContent, error) { return s.Inner.Hold(handle, flowNodeID, runID) },
		func(board *BoardContent) { board.Hold(flowNodeID) })
}

func (s *SpoolingHybridflowStore) Finish(handle, flowNodeID, runID, status string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolFinish, Handle: handle, FlowNode: flowNodeID, Run: runID, Status: status},
		func() (*BoardContent, error) { return s.Inner.Finish(handle, flowNodeID, runID, status) },
		func(board *BoardContent) { board.SetStatus(flowNodeID, status) })
}

func (s *SpoolingHybridflowStore) Chat(handle, flowNodeID, chat string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolChat, Handle: handle, FlowNode: flowNodeID, Chat: chat},
		func() (*BoardContent, error) { return s.Inner.Chat(handle, flowNodeID, chat) },
		func(board *BoardContent) { board.SetChat(flowNodeID, chat) })
}

func (s *SpoolingHybridflowStore) Ready(handle, flowNodeID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolReady, Handle: handle, FlowNode: flowNodeID},
		func() (*BoardContent, error) { return s.Inner.Ready(handle, flowNodeID) },
		func(board *BoardContent) { board.SetStatus(flowNodeID, FlowNodeStatusReady) })
}

// Drop is queued like any other write; the optimistic answer applies the guard — only a card
// still marked as being worked on is given back.
func (s *SpoolingHybridflowStore) Drop(handle, flowNodeID, runID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: spoolDrop, Handle: handle, FlowNode: flowNodeID, Run: runID},
		func() (*BoardContent, error) { return s.Inner.Drop(handle, flowNodeID, runID) },
		func(board *BoardContent) {
			flowNode := board.FlowNode(flowNodeID)
			if flowNode == nil || (flowNode.Status != FlowNodeStatusRunning && flowNode.Status != FlowNodeStatusWaitingRefresh) {
				return
			}
			board.SetStatus(flowNodeID, FlowNodeStatusInterrupted)
		})
}

// ReportUsage files what a turn cost by queueing it and returning: no live try, no optimistic
// board, no network on the caller. A usage report changes no card, so there is no refusal the
// run must hear before its next turn — and the sender the enqueue wakes posts it at once, so
// queueing first costs a healthy deployment nothing and an outage nothing either. What the run
// is promised is that the bill is filed, on this process's disk, before this returns.
func (s *SpoolingHybridflowStore) ReportUsage(handle, flowNodeID string, report UsageReport) error {
	queued := &spoolBill{
		ID: report.ID, Model: report.Model,
		InputTokens: report.InputTokens, OutputTokens: report.OutputTokens,
		CacheReadTokens: report.CacheReadTokens, CacheWriteTokens: report.CacheWriteTokens,
		ReasoningTokens: report.ReasoningTokens, CostUsdMicros: report.CostUsdMicros,
	}
	if !report.ReportedAt.IsZero() {
		queued.ReportedAt = report.ReportedAt.UTC().Format(time.RFC3339)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending = append(s.pending, SpoolRecord{
		Op: SpoolUsage, Handle: handle, FlowNode: flowNodeID, Run: report.RunID,
		Usage: queued, At: time.Now().UnixMilli(),
	})
	s.persistLocked()
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return nil
}

// SettleRun frees the run's cards live, or queues the freeing where the link is down and reports
// nothing held: the restart that calls this is over either way, and the cards are freed by the
// sender rather than left claiming a run that is gone.
func (s *SpoolingHybridflowStore) SettleRun(runID string) (int, error) {
	s.mu.Lock()
	down := time.Now().Before(s.downUntil)
	s.mu.Unlock()
	if !down {
		settled, err := s.Inner.SettleRun(runID)
		if err == nil {
			s.mu.Lock()
			s.downUntil = time.Time{}
			s.mu.Unlock()
			return settled, nil
		}
		if spoolTerminal(err) {
			return 0, err
		}
		s.mu.Lock()
		s.downUntil = time.Now().Add(s.breakerInterval)
		s.mu.Unlock()
		LogChainRun.Warn("hybridflow store unreachable, spooling the settle", "run", runID, "error", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending = append(s.pending, SpoolRecord{Op: spoolSettle, Run: runID, At: time.Now().UnixMilli()})
	s.persistLocked()
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return 0, nil
}

// write tries the mark live and, where the link is down, queues it and answers optimistically. A
// refusal from the store itself — held, gone, malformed — is a live answer and is returned, never
// queued: queuing it would run a turn the store has already said no to.
func (s *SpoolingHybridflowStore) write(
	handle, flowNodeID string, rec SpoolRecord,
	live func() (*BoardContent, error), apply func(*BoardContent),
) (*BoardContent, error) {
	s.mu.Lock()
	down := time.Now().Before(s.downUntil)
	s.mu.Unlock()
	if !down {
		board, err := live()
		if err == nil {
			s.mu.Lock()
			s.boards[handle] = cloneBoard(board)
			s.downUntil = time.Time{}
			s.mu.Unlock()
			return board, nil
		}
		if spoolTerminal(err) {
			return nil, err
		}
		s.mu.Lock()
		s.downUntil = time.Now().Add(s.breakerInterval)
		s.mu.Unlock()
		LogChainRun.Warn("hybridflow store unreachable, spooling the mark",
			"op", rec.Op, "flowNode", flowNodeID, "error", err)
	}
	return s.enqueue(rec, handle, apply)
}

// enqueue files the mark on the spool and answers from the cached board with the mark applied to
// the copy. The cache keeps the optimistic board, so the reads behind it see the run's own marks
// while the link is down. Without a cached board there is nothing honest to answer with, and the
// mark is not queued either: a run that never started holds no card to replay.
func (s *SpoolingHybridflowStore) enqueue(
	rec SpoolRecord, handle string, apply func(*BoardContent),
) (*BoardContent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cached, ok := s.boards[handle]
	if !ok {
		return nil, &httpkit.HTTPError{
			Status: http.StatusServiceUnavailable,
			Msg:    "the hybridflow store could not be reached, and no board is cached for " + handle,
		}
	}
	rec.At = time.Now().UnixMilli()
	s.pending = append(s.pending, rec)
	s.persistLocked()
	optimistic := cloneBoard(cached)
	apply(optimistic)
	s.boards[handle] = optimistic
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return cloneBoard(optimistic), nil
}

// Board reads the board live, falling back to the last one seen while the link is down. A live
// refusal — no such board — is returned rather than masked by a copy of what is gone.
func (s *SpoolingHybridflowStore) Board(handle string) (*BoardContent, error) {
	s.mu.Lock()
	down := time.Now().Before(s.downUntil)
	cached, ok := s.boards[handle]
	s.mu.Unlock()
	if down && ok {
		return cloneBoard(cached), nil
	}
	board, err := s.Inner.Board(handle)
	if err == nil {
		s.mu.Lock()
		s.boards[handle] = cloneBoard(board)
		s.downUntil = time.Time{}
		s.mu.Unlock()
		return board, nil
	}
	if spoolTerminal(err) {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.downUntil = time.Now().Add(s.breakerInterval)
	if cached, ok := s.boards[handle]; ok {
		LogChainRun.Warn("hybridflow store unreachable, reading the board from the cache",
			"board", handle, "error", err)
		return cloneBoard(cached), nil
	}
	return nil, err
}

// New conversations require a live publication read. Existing conversations use their snapshot.
func (s *SpoolingHybridflowStore) Agent(id string) (*ManagedAgent, error) {
	return s.Inner.Agent(id)
}

// Runner reads one runner live, with no spool behind it. A name is only ever resolved for the
// wording of a refusal — the decision itself compares ids — so a runner that cannot be read is a
// refusal carrying the id, and caching it would be keeping a name nobody asked to keep.
func (s *SpoolingHybridflowStore) Runner(id string) (*ManagedRunner, error) {
	return s.Inner.Runner(id)
}

// spoolTerminal is a failure no retry can fix: the store answered, and what it said about this
// mark will still be true in five seconds. Everything else — unreachable, timed out, 5xx, refused
// credentials — keeps the record queued.
func spoolTerminal(err error) bool {
	var refused *httpkit.HTTPError
	if !errors.As(err, &refused) {
		return false
	}
	switch refused.Status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict:
		return true
	}
	return false
}

// flushLoop sends the queue whenever it grows and retries it on the clock, until closed.
func (s *SpoolingHybridflowStore) flushLoop() {
	defer s.wg.Done()
	s.flush()
	for {
		s.mu.Lock()
		interval := s.flushInterval
		s.mu.Unlock()
		timer := time.NewTimer(interval)
		select {
		case <-s.done:
			timer.Stop()
			return
		case <-s.wake:
			timer.Stop()
			s.flush()
		case <-timer.C:
			s.flush()
		}
	}
}

// flush sends the queued marks head-first, stopping at the first the link will not take. The calls
// run without the lock — a send is a round trip — and the head is only dropped once the store has
// answered it, so a process killed mid-send replays the record after the restart.
func (s *SpoolingHybridflowStore) flush() {
	for {
		s.mu.Lock()
		if len(s.pending) == 0 {
			s.mu.Unlock()
			return
		}
		head := s.pending[0]
		s.mu.Unlock()

		board, err := s.send(head)

		s.mu.Lock()
		if err == nil {
			s.pending[0] = SpoolRecord{}
			s.pending = s.pending[1:]
			if board != nil && head.Handle != "" {
				s.boards[head.Handle] = board
			}
			s.downUntil = time.Time{}
			left := len(s.pending)
			s.persistLocked()
			s.mu.Unlock()
			LogChainRun.Info("the queued mark reached the store",
				"op", head.Op, "flowNode", head.FlowNode, "left", left)
			continue
		}
		if spoolTerminal(err) {
			s.pending[0] = SpoolRecord{}
			s.pending = s.pending[1:]
			s.downUntil = time.Time{}
			left := len(s.pending)
			s.persistLocked()
			s.mu.Unlock()
			LogChainRun.Warn("the queued mark was refused, dropping it",
				"op", head.Op, "flowNode", head.FlowNode, "left", left, "error", err)
			continue
		}
		s.downUntil = time.Now().Add(s.breakerInterval)
		s.mu.Unlock()
		return
	}
}

// send replays one queued mark: the write, and the board read back after it for the cache. A
// record naming no operation this build knows is refused rather than sent — it can only be one a
// newer build queued.
func (s *SpoolingHybridflowStore) send(rec SpoolRecord) (*BoardContent, error) {
	switch rec.Op {
	case SpoolStart:
		return s.Inner.Start(rec.Handle, rec.FlowNode, rec.Run)
	case spoolReopen:
		return s.Inner.Reopen(rec.Handle, rec.FlowNode, rec.Run)
	case spoolHold:
		return s.Inner.Hold(rec.Handle, rec.FlowNode, rec.Run)
	case SpoolFinish:
		return s.Inner.Finish(rec.Handle, rec.FlowNode, rec.Run, rec.Status)
	case SpoolChat:
		return s.Inner.Chat(rec.Handle, rec.FlowNode, rec.Chat)
	case spoolDrop:
		return s.Inner.Drop(rec.Handle, rec.FlowNode, rec.Run)
	case SpoolReady:
		return s.Inner.Ready(rec.Handle, rec.FlowNode)
	case spoolSettle:
		_, err := s.Inner.SettleRun(rec.Run)
		return nil, err
	case SpoolUsage:
		// A bill with nothing in it is a record an older build cannot have queued — usage
		// records have always carried their payload — so it is refused rather than filed as
		// zeros, which would read as free.
		if rec.Usage == nil {
			return nil, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "a spooled usage record holds no bill"}
		}
		report := UsageReport{
			ID: rec.Usage.ID, RunID: rec.Run, Model: rec.Usage.Model,
			InputTokens: rec.Usage.InputTokens, OutputTokens: rec.Usage.OutputTokens,
			CacheReadTokens: rec.Usage.CacheReadTokens, CacheWriteTokens: rec.Usage.CacheWriteTokens,
			ReasoningTokens: rec.Usage.ReasoningTokens, CostUsdMicros: rec.Usage.CostUsdMicros,
		}
		if at, err := time.Parse(time.RFC3339, rec.Usage.ReportedAt); err == nil {
			report.ReportedAt = at
		}
		return nil, s.Inner.ReportUsage(rec.Handle, rec.FlowNode, report)
	default:
		return nil, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "unknown spooled mark: " + rec.Op}
	}
}

// load reads the spool back into memory. A line that is not a record is dropped with a warning —
// it cannot be replayed — and the next persist rewrites the file without it.
func (s *SpoolingHybridflowStore) load() {
	if s.path == "" {
		return
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if !os.IsNotExist(err) {
			LogChainRun.Warn("cannot read the spooled marks", "path", s.path, "error", err)
		}
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var rec SpoolRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil || rec.Op == "" {
			LogChainRun.Warn("cannot read a spooled mark, dropping it", "path", s.path)
			continue
		}
		s.pending = append(s.pending, rec)
	}
	if len(s.pending) > 0 {
		LogChainRun.Info("spooled marks loaded", "count", len(s.pending))
	}
}

// persistLocked rewrites the spool with the queue as it stands, atomically: a crash lands on the
// old file or the new one, never on half a write. A file that cannot be written is a warning, not
// a failure — the memory still holds the queue, and only a crash on top would lose it.
func (s *SpoolingHybridflowStore) persistLocked() {
	if s.path == "" {
		return
	}
	var out strings.Builder
	for _, rec := range s.pending {
		encoded, err := json.Marshal(rec)
		if err != nil {
			LogChainRun.Warn("cannot write the spooled marks", "path", s.path, "error", err)
			return
		}
		out.Write(encoded)
		out.WriteByte('\n')
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		LogChainRun.Warn("cannot write the spooled marks", "path", s.path, "error", err)
		return
	}
	tmp, err := os.CreateTemp(dir, ".spool-*.jsonl")
	if err != nil {
		LogChainRun.Warn("cannot write the spooled marks", "path", s.path, "error", err)
		return
	}
	tmpName := tmp.Name()
	_, writeErr := tmp.WriteString(out.String())
	syncErr := tmp.Sync()
	closeErr := tmp.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		_ = os.Remove(tmpName)
		LogChainRun.Warn("cannot write the spooled marks", "path", s.path)
		return
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		_ = os.Remove(tmpName)
		LogChainRun.Warn("cannot write the spooled marks", "path", s.path, "error", err)
	}
}

// cloneBoard copies a board through its own encoding, so what the cache holds can never be what a
// caller mutates under it.
func cloneBoard(board *BoardContent) *BoardContent {
	if board == nil {
		return nil
	}
	raw, err := json.Marshal(board)
	if err != nil {
		return board
	}
	var out BoardContent
	if err := json.Unmarshal(raw, &out); err != nil {
		return board
	}
	return &out
}
