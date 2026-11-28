package boards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/http"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// HybridflowSpoolFileName holds writes awaiting durable acknowledgement, one JSON object per line.
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

const spoolTodo = "todo"

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

// SpoolRecord holds the ids and values needed to replay one write.
type SpoolRecord struct {
	Op               string          `json:"op"`
	Handle           string          `json:"handle,omitempty"`
	FlowNode         string          `json:"flowNode,omitempty"`
	Run              string          `json:"run,omitempty"`
	AfterPredecessor bool            `json:"afterPredecessor,omitempty"`
	Status           string          `json:"status,omitempty"`
	Chat             string          `json:"chat,omitempty"`
	Output           json.RawMessage `json:"output,omitempty"`
	Workflow         *WorkflowUpdate `json:"workflow,omitempty"`
	Usage            *spoolBill      `json:"usage,omitempty"`
	At               int64           `json:"at"`
}

// SpoolingHybridflowStore is BoardStore over a HybridflowStore that survives the link going down:
// writes are spooled to disk and sent asynchronously, reads fall back to the last board seen.
type SpoolingHybridflowStore struct {
	Inner *HybridflowStore
	// path is the spool file, or "" for a store held in memory only — a test, or a process with
	// no state directory.
	path  string
	files spoolFiles

	// The two clocks, as fields so a test can flush in milliseconds. Production never changes
	// them. Read under the lock: the sender loop is already running while a test sets them.
	flushInterval   time.Duration
	breakerInterval time.Duration

	mu     sync.Mutex
	closed bool
	// pending holds the persisted queue, oldest first. A replacement is published here only
	// after it is saved; a failed acknowledgement leaves the head available for replay.
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
		Inner: inner, path: spoolPath, files: osSpoolFiles{},
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

func (s *SpoolingHybridflowStore) Start(handle, flowNodeID, runID string, afterPredecessor ...bool) (*BoardContent, error) {
	arrival := len(afterPredecessor) > 0 && afterPredecessor[0]
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolStart, Handle: handle, FlowNode: flowNodeID, Run: runID, AfterPredecessor: arrival},
		func() (*BoardContent, error) { return s.Inner.Start(handle, flowNodeID, runID, arrival) },
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

func (s *SpoolingHybridflowStore) Finish(handle, flowNodeID, runID string, result PlayResult) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: SpoolFinish, Handle: handle, FlowNode: flowNodeID, Run: runID,
			Status: result.Status, Output: result.Output, Workflow: result.Workflow},
		func() (*BoardContent, error) { return s.Inner.Finish(handle, flowNodeID, runID, result) },
		func(board *BoardContent) {
			board.SetStatus(flowNodeID, result.Status)
			if node := board.FlowNode(flowNodeID); node != nil {
				node.Output = append(json.RawMessage(nil), result.Output...)
			}
			if update := result.Workflow; update != nil {
				board.Workflow(update.ID).MergeValues(update.Values)
			}
		})
}

func (s *SpoolingHybridflowStore) PassLimiter(ctx context.Context, handle, flowNodeID, runID string, revision int64, output json.RawMessage) (*FlowNode, string, error) {
	node, next, err := s.Inner.PassLimiter(ctx, handle, flowNodeID, runID, revision, output)
	if err != nil {
		return nil, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.downUntil = time.Time{}
	if cached := s.boards[handle]; cached != nil {
		if previous := cached.FlowNode(flowNodeID); previous != nil && previous.Revision < node.Revision {
			board := cloneBoard(cached)
			*board.FlowNode(flowNodeID) = *node
			s.boards[handle] = board
		}
	}
	return node, next, nil
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

func (s *SpoolingHybridflowStore) Todo(handle, flowNodeID string) (*BoardContent, error) {
	return s.write(handle, flowNodeID,
		SpoolRecord{Op: spoolTodo, Handle: handle, FlowNode: flowNodeID},
		func() (*BoardContent, error) { return s.Inner.Todo(handle, flowNodeID) },
		func(board *BoardContent) { board.SetStatus(flowNodeID, FlowNodeStatusTodo) })
}

// Drop is queued like any other write; the optimistic answer applies the guard — only a flow node
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

// ReportUsage persists a turn's bill before waking the sender. It returns any persistence
// error to the caller. The report id is saved with the bill so retries cannot count it twice.
func (s *SpoolingHybridflowStore) ReportUsage(handle, flowNodeID string, report UsageReport) error {
	if strings.TrimSpace(report.ID) == "" {
		report.ID = newUsageReportID()
		if report.ID == "" {
			return errors.New("cannot queue usage without a report id")
		}
	}
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
	return s.appendLocked(SpoolRecord{
		Op: SpoolUsage, Handle: handle, FlowNode: flowNodeID, Run: report.RunID,
		Usage: queued,
	})
}

// SettleRun frees the run's flow nodes live, or durably queues the release while the link is down.
// A queued release returns zero; a persistence failure returns an error so restart can retry.
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
	return 0, s.appendLocked(SpoolRecord{Op: spoolSettle, Run: runID})
}

// write tries the mark live and, where the link is down, queues it and answers optimistically. A
// refusal from the store itself — held, gone, malformed — is a live answer and is returned, never
// queued: queuing it would run a turn the store has already said no to.
func (s *SpoolingHybridflowStore) write(
	handle, flowNodeID string, rec SpoolRecord,
	live func() (*BoardContent, error), apply func(*BoardContent),
) (*BoardContent, error) {
	s.mu.Lock()
	down := time.Now().Before(s.downUntil) || s.hasPendingWorkflowLocked(handle)
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
// mark is not queued either: a run that never started holds no flow node to replay.
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
	if rec.Op == SpoolStart {
		if node := cached.FlowNode(rec.FlowNode); node != nil && node.IsGateway() &&
			(node.Status == FlowNodeStatusRunning || len(cached.GatewayWaiting(*node, rec.AfterPredecessor)) > 0) {
			return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "the gateway is running or waiting for its incoming branches"}
		}
	}
	if update := rec.Workflow; update != nil {
		node := cached.FlowNode(rec.FlowNode)
		if node == nil || node.Workflow != update.ID || cached.Workflow(update.ID) == nil {
			return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "the flow node's workflow has changed"}
		}
	}
	if err := s.appendLocked(rec); err != nil {
		return nil, err
	}
	optimistic := cloneBoard(cached)
	apply(optimistic)
	s.boards[handle] = optimistic
	return cloneBoard(optimistic), nil
}

// appendLocked commits the candidate queue before exposing it to the sender or the cache.
func (s *SpoolingHybridflowStore) appendLocked(rec SpoolRecord) error {
	rec.At = time.Now().UnixMilli()
	pending := make([]SpoolRecord, len(s.pending)+1)
	copy(pending, s.pending)
	pending[len(s.pending)] = rec
	if err := s.persistLocked(pending); err != nil {
		return fmt.Errorf("queue %s (board %q, flow node %q, run %q): %w", rec.Op, rec.Handle, rec.FlowNode, rec.Run, err)
	}
	s.pending = pending
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return nil
}

// Board reads the board live, falling back to the last one seen while the link is down. A live
// refusal — no such board — is returned rather than masked by a copy of what is gone.
func (s *SpoolingHybridflowStore) Board(handle string) (*BoardContent, error) {
	s.mu.Lock()
	down := time.Now().Before(s.downUntil) || s.hasPendingWorkflowLocked(handle)
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
	for {
		if err := s.flush(); err != nil {
			LogChainRun.Warn("cannot save the hybridflow spool after delivery", "error", err)
		}
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
		case <-timer.C:
		}
	}
}

// flush sends the queued marks head-first, stopping at the first the link will not take. The calls
// run without the lock — a send is a round trip — and the head is only dropped once the store has
// answered it and the reduced queue is saved. A failed save retains the head and stops this
// pass; a retry or restart sends it with the same ids, preserving upstream idempotence.
func (s *SpoolingHybridflowStore) flush() error {
	for {
		s.mu.Lock()
		if len(s.pending) == 0 {
			s.mu.Unlock()
			return nil
		}
		head := s.pending[0]
		s.mu.Unlock()

		board, err := s.send(head)

		s.mu.Lock()
		if err == nil || spoolTerminal(err) {
			if persistErr := s.persistLocked(s.pending[1:]); persistErr != nil {
				s.mu.Unlock()
				return fmt.Errorf("acknowledge queued %s (board %q, flow node %q): %w", head.Op, head.Handle, head.FlowNode, persistErr)
			}
			s.pending[0] = SpoolRecord{}
			s.pending = s.pending[1:]
			s.downUntil = time.Time{}
			if board != nil && head.Handle != "" && !s.hasPendingBoardLocked(head.Handle) {
				s.boards[head.Handle] = board
			}
			left := len(s.pending)
			s.mu.Unlock()
			if err == nil {
				LogChainRun.Info("the queued mark reached the store",
					"op", head.Op, "flowNode", head.FlowNode, "left", left)
			} else {
				LogChainRun.Warn("the queued mark was refused, dropping it",
					"op", head.Op, "flowNode", head.FlowNode, "left", left, "error", err)
			}
			continue
		}
		s.downUntil = time.Now().Add(s.breakerInterval)
		s.mu.Unlock()
		return nil
	}
}

func (s *SpoolingHybridflowStore) hasPendingBoardLocked(handle string) bool {
	for _, rec := range s.pending {
		if rec.Handle == handle {
			return true
		}
	}
	return false
}

// Keep local readers and successors on the optimistic board until workflow values reach the store.
func (s *SpoolingHybridflowStore) hasPendingWorkflowLocked(handle string) bool {
	for _, rec := range s.pending {
		if rec.Handle == handle && rec.Workflow != nil {
			return true
		}
	}
	return false
}

// send replays one queued mark: the write, and the board read back after it for the cache. A
// record naming no operation this build knows is refused rather than sent — it can only be one a
// newer build queued.
func (s *SpoolingHybridflowStore) send(rec SpoolRecord) (*BoardContent, error) {
	switch rec.Op {
	case SpoolStart:
		return s.Inner.Start(rec.Handle, rec.FlowNode, rec.Run, rec.AfterPredecessor)
	case spoolReopen:
		return s.Inner.Reopen(rec.Handle, rec.FlowNode, rec.Run)
	case spoolHold:
		return s.Inner.Hold(rec.Handle, rec.FlowNode, rec.Run)
	case SpoolFinish:
		return s.Inner.Finish(rec.Handle, rec.FlowNode, rec.Run, PlayResult{
			Status: rec.Status, Output: rec.Output, Workflow: rec.Workflow,
		})
	case SpoolChat:
		return s.Inner.Chat(rec.Handle, rec.FlowNode, rec.Chat)
	case spoolDrop:
		return s.Inner.Drop(rec.Handle, rec.FlowNode, rec.Run)
	case SpoolReady:
		return s.Inner.Ready(rec.Handle, rec.FlowNode)
	case spoolTodo:
		return s.Inner.Todo(rec.Handle, rec.FlowNode)
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

type spoolFile interface {
	Name() string
	WriteString(string) (int, error)
	Sync() error
	Close() error
}

type spoolFiles interface {
	MkdirAll(string, os.FileMode) error
	CreateTemp(string, string) (spoolFile, error)
	Rename(string, string) error
}

type osSpoolFiles struct{}

func (osSpoolFiles) MkdirAll(path string, mode os.FileMode) error { return os.MkdirAll(path, mode) }
func (osSpoolFiles) CreateTemp(dir, pattern string) (spoolFile, error) {
	return os.CreateTemp(dir, pattern)
}
func (osSpoolFiles) Rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }

// persistLocked atomically saves a candidate queue. Every failure leaves the previous file
// intact; the caller commits the candidate in memory only after a successful rename.
func (s *SpoolingHybridflowStore) persistLocked(pending []SpoolRecord) error {
	if s.path == "" {
		return nil
	}
	var out strings.Builder
	for _, rec := range pending {
		encoded, err := json.Marshal(rec)
		if err != nil {
			return fmt.Errorf("encode spool %q: %w", s.path, err)
		}
		out.Write(encoded)
		out.WriteByte('\n')
	}
	dir := filepath.Dir(s.path)
	if err := s.files.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create spool directory %q: %w", dir, err)
	}
	tmp, err := s.files.CreateTemp(dir, ".spool-*.jsonl")
	if err != nil {
		return fmt.Errorf("create temporary spool for %q: %w", s.path, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	n, writeErr := tmp.WriteString(out.String())
	if writeErr == nil && n != out.Len() {
		writeErr = io.ErrShortWrite
	}
	syncErr := tmp.Sync()
	closeErr := tmp.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return fmt.Errorf("write, sync or close spool %q: %w", s.path, errors.Join(writeErr, syncErr, closeErr))
	}
	if err := s.files.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("replace spool %q: %w", s.path, err)
	}
	return nil
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

func (s *SpoolingHybridflowStore) Schema(id string) (json.RawMessage, error) {
	return s.Inner.Schema(id)
}
