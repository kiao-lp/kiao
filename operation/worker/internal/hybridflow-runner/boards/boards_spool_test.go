package boards

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

var spoolFailureStages = []string{"mkdir", "create", "write", "short-write", "sync", "close", "rename"}

type failingSpoolFiles struct {
	spoolFiles
	stage string
	err   error
}

func (f failingSpoolFiles) MkdirAll(path string, mode os.FileMode) error {
	if f.stage == "mkdir" {
		return f.err
	}
	return f.spoolFiles.MkdirAll(path, mode)
}

func (f failingSpoolFiles) CreateTemp(dir, pattern string) (spoolFile, error) {
	if f.stage == "create" {
		return nil, f.err
	}
	file, err := f.spoolFiles.CreateTemp(dir, pattern)
	if err != nil {
		return nil, err
	}
	return failingSpoolFile{spoolFile: file, stage: f.stage, err: f.err}, nil
}

func (f failingSpoolFiles) Rename(oldPath, newPath string) error {
	if f.stage == "rename" {
		return f.err
	}
	return f.spoolFiles.Rename(oldPath, newPath)
}

type failingSpoolFile struct {
	spoolFile
	stage string
	err   error
}

func (f failingSpoolFile) WriteString(data string) (int, error) {
	if f.stage == "write" || f.stage == "short-write" {
		n, err := f.spoolFile.WriteString(data[:len(data)/2])
		if f.stage == "write" {
			return n, f.err
		}
		return n, err
	}
	return f.spoolFile.WriteString(data)
}

func (f failingSpoolFile) Sync() error {
	if f.stage == "sync" {
		return f.err
	}
	return f.spoolFile.Sync()
}

func (f failingSpoolFile) Close() error {
	err := f.spoolFile.Close()
	if f.stage == "close" {
		return f.err
	}
	return err
}

// The sender is driven explicitly so failures and retries need no timer or permission changes.
func manualSpool(t *testing.T) *SpoolingHybridflowStore {
	t.Helper()
	return &SpoolingHybridflowStore{
		path: filepath.Join(t.TempDir(), HybridflowSpoolFileName), files: osSpoolFiles{},
		boards:    map[string]*BoardContent{"board": {FlowNodes: []FlowNode{{ID: "node"}}}},
		downUntil: time.Now().Add(time.Hour), breakerInterval: time.Hour,
		wake: make(chan struct{}, 1),
	}
}

func readSpool(t *testing.T, s *SpoolingHybridflowStore) []byte {
	t.Helper()
	data, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func assertSpoolMatchesMemory(t *testing.T, s *SpoolingHybridflowStore) {
	t.Helper()
	var want bytes.Buffer
	for _, rec := range s.pending {
		if err := json.NewEncoder(&want).Encode(rec); err != nil {
			t.Fatal(err)
		}
	}
	if data := readSpool(t, s); !bytes.Equal(data, want.Bytes()) {
		t.Fatalf("spool = %s, memory = %s", data, want.Bytes())
	}
	entries, err := os.ReadDir(filepath.Dir(s.path))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".spool-") {
			t.Errorf("temporary spool remains: %s", entry.Name())
		}
	}
}

type spoolUpstream struct {
	mu       sync.Mutex
	writes   []string
	bills    []UsagePayload
	accepted map[string]UsagePayload
	refuse   string
}

func newSpoolUpstream(t *testing.T) (*spoolUpstream, *HybridflowStore) {
	t.Helper()
	fake := &spoolUpstream{accepted: map[string]UsagePayload{}}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	return fake, NewHybridflowStore(server.URL, "token")
}

func (f *spoolUpstream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		_ = json.NewEncoder(w).Encode(BoardContent{FlowNodes: []FlowNode{{ID: "node", Status: FlowNodeStatusRunning}}})
		return
	}
	f.writes = append(f.writes, r.URL.Path)
	if r.URL.Path == f.refuse {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/usage") {
		var bill UsagePayload
		if err := json.NewDecoder(r.Body).Decode(&bill); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.bills = append(f.bills, bill)
		if _, exists := f.accepted[bill.ID]; !exists {
			f.accepted[bill.ID] = bill
		}
	}
	_, _ = w.Write([]byte(`{"settled":0}`))
}

func restartSpool(t *testing.T, s *SpoolingHybridflowStore) {
	t.Helper()
	restarted := NewSpoolingHybridflowStore(s.Inner, s.path)
	// Close waits for the initial replay; no retry timer is needed for an available upstream.
	if err := restarted.Close(); err != nil {
		t.Fatal(err)
	}
	if data := readSpool(t, restarted); len(data) != 0 {
		t.Fatalf("spool after restart = %s, want it drained", data)
	}
}

func TestSpoolAppendPersistenceFailures(t *testing.T) {
	operations := []struct {
		name string
		op   string
		call func(*testing.T, *SpoolingHybridflowStore) error
	}{
		{"usage", SpoolUsage, func(t *testing.T, s *SpoolingHybridflowStore) error {
			return s.ReportUsage("board", "node", UsageReport{ID: "usage-1", RunID: "run", InputTokens: 123})
		}},
		{"settle", spoolSettle, func(t *testing.T, s *SpoolingHybridflowStore) error {
			settled, err := s.SettleRun("run")
			if settled != 0 {
				t.Errorf("settled = %d, want zero for a queued release", settled)
			}
			return err
		}},
		{"mark", SpoolStart, func(t *testing.T, s *SpoolingHybridflowStore) error {
			board, err := s.Start("board", "node", "run")
			if err != nil && board != nil {
				t.Error("failed Start returned an optimistic board")
			}
			return err
		}},
	}
	for _, operation := range operations {
		for _, stage := range spoolFailureStages {
			t.Run(operation.name+"/"+stage, func(t *testing.T) {
				s := manualSpool(t)
				fake, inner := newSpoolUpstream(t)
				s.Inner = inner
				if _, err := s.Chat("board", "node", "persisted-chat"); err != nil {
					t.Fatal(err)
				}
				<-s.wake
				before := readSpool(t, s)
				pending := append([]SpoolRecord(nil), s.pending...)
				cached := cloneBoard(s.boards["board"])
				cause := errors.New("injected " + stage + " failure")
				s.files = failingSpoolFiles{spoolFiles: osSpoolFiles{}, stage: stage, err: cause}
				wantErr := cause
				if stage == "short-write" {
					wantErr = io.ErrShortWrite
				}
				if err := operation.call(t, s); !errors.Is(err, wantErr) {
					t.Fatalf("error = %v, want %v", err, wantErr)
				}
				if !reflect.DeepEqual(s.pending, pending) || !reflect.DeepEqual(s.boards["board"], cached) {
					t.Fatal("failed append changed the queue or optimistic cache")
				}
				if !bytes.Equal(readSpool(t, s), before) {
					t.Fatal("failed append changed the persisted queue")
				}
				select {
				case <-s.wake:
					t.Fatal("failed append woke the sender")
				default:
				}
				assertSpoolMatchesMemory(t, s)

				s.files = osSpoolFiles{}
				if err := operation.call(t, s); err != nil {
					t.Fatalf("retry: %v", err)
				}
				if len(s.pending) != 2 || s.pending[0].Chat != "persisted-chat" || s.pending[1].Op != operation.op {
					t.Fatalf("queue after retry = %+v", s.pending)
				}
				if operation.name == "mark" && s.boards["board"].FlowNode("node").Status != FlowNodeStatusRunning {
					t.Fatal("successful retry did not update the optimistic cache")
				}
				assertSpoolMatchesMemory(t, s)
				restartSpool(t, s)
				fake.mu.Lock()
				defer fake.mu.Unlock()
				if len(fake.writes) != 2 {
					t.Fatalf("writes after restart = %v, want exactly the two persisted records", fake.writes)
				}
			})
		}
	}
}

func TestSpoolEncodingFailureKeepsQueueAndCache(t *testing.T) {
	s := manualSpool(t)
	if _, err := s.Chat("board", "node", "persisted-chat"); err != nil {
		t.Fatal(err)
	}
	before := readSpool(t, s)
	if board, err := s.Finish("board", "node", "run", PlayResult{Status: FlowNodeStatusDone, Output: json.RawMessage(`{`)}); err == nil || board != nil {
		t.Fatalf("Finish = %v, %v, want an encoding error", board, err)
	}
	if !bytes.Equal(readSpool(t, s), before) || len(s.pending) != 1 || s.boards["board"].FlowNode("node").Status == FlowNodeStatusDone {
		t.Fatal("encoding failure changed the queue or cache")
	}
	assertSpoolMatchesMemory(t, s)
}

func TestSpoolAcknowledgementPersistenceFailures(t *testing.T) {
	for _, refused := range []bool{false, true} {
		for _, stage := range spoolFailureStages {
			name := "accepted/"
			if refused {
				name = "refused/"
			}
			t.Run(name+stage, func(t *testing.T) {
				s := manualSpool(t)
				fake, inner := newSpoolUpstream(t)
				s.Inner = inner
				if refused {
					fake.refuse = "/boards/board/flow-nodes/node/play"
				}
				if _, err := s.Start("board", "node", "run"); err != nil {
					t.Fatal(err)
				}
				if _, err := s.Finish("board", "node", "run", PlayResult{Status: FlowNodeStatusDone, Output: json.RawMessage(`{"result":1}`)}); err != nil {
					t.Fatal(err)
				}
				cached := cloneBoard(s.boards["board"])
				before := readSpool(t, s)
				cause := errors.New("injected " + stage + " failure")
				s.files = failingSpoolFiles{spoolFiles: osSpoolFiles{}, stage: stage, err: cause}
				wantErr := cause
				if stage == "short-write" {
					wantErr = io.ErrShortWrite
				}
				if err := s.flush(); !errors.Is(err, wantErr) {
					t.Fatalf("flush error = %v, want %v", err, wantErr)
				}
				if !bytes.Equal(readSpool(t, s), before) || len(s.pending) != 2 || !reflect.DeepEqual(s.boards["board"], cached) {
					t.Fatal("failed acknowledgement changed the queue or optimistic cache")
				}
				if board, err := s.Board("board"); err != nil || !reflect.DeepEqual(board, cached) {
					t.Fatalf("Board after failed acknowledgement = %+v, %v, want the optimistic board", board, err)
				}
				assertSpoolMatchesMemory(t, s)
				restartSpool(t, s)
				fake.mu.Lock()
				defer fake.mu.Unlock()
				want := []string{"/boards/board/flow-nodes/node/play", "/boards/board/flow-nodes/node/play", "/boards/board/flow-nodes/node/played"}
				if !reflect.DeepEqual(fake.writes, want) {
					t.Fatalf("writes = %v, want %v", fake.writes, want)
				}
			})
		}
	}
}

func TestSpoolUsageReplayKeepsReportID(t *testing.T) {
	for _, restart := range []bool{false, true} {
		for _, id := range []string{"usage-1", ""} {
			name := "retry/" + id
			if restart {
				name = "restart/" + id
			}
			t.Run(name, func(t *testing.T) {
				s := manualSpool(t)
				fake, inner := newSpoolUpstream(t)
				s.Inner = inner
				micros := int64(23400)
				report := UsageReport{
					ID: id, RunID: "run", Model: "model", ReportedAt: time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC),
					InputTokens: 100, OutputTokens: 50, CacheReadTokens: 20, CacheWriteTokens: 10,
					ReasoningTokens: 15, CostUsdMicros: &micros,
				}
				if err := s.ReportUsage("board", "node", report); err != nil {
					t.Fatal(err)
				}
				queuedID := s.pending[0].Usage.ID
				if queuedID == "" || (id != "" && queuedID != id) {
					t.Fatalf("queued id = %q, supplied %q", queuedID, id)
				}
				if err := s.ReportUsage("board", "node", UsageReport{ID: "usage-2", InputTokens: 200}); err != nil {
					t.Fatal(err)
				}
				cause := errors.New("injected rename failure")
				s.files = failingSpoolFiles{spoolFiles: osSpoolFiles{}, stage: "rename", err: cause}
				if err := s.flush(); !errors.Is(err, cause) {
					t.Fatalf("flush = %v", err)
				}
				assertSpoolMatchesMemory(t, s)
				if restart {
					restartSpool(t, s)
				} else {
					s.files = osSpoolFiles{}
					if err := s.flush(); err != nil {
						t.Fatalf("retry flush: %v", err)
					}
					assertSpoolMatchesMemory(t, s)
					if len(s.pending) != 0 {
						t.Fatal("retry left records pending")
					}
					restartSpool(t, s)
				}
				fake.mu.Lock()
				defer fake.mu.Unlock()
				if len(fake.bills) != 3 || !reflect.DeepEqual(fake.bills[0], fake.bills[1]) || fake.bills[0].ID != queuedID {
					t.Fatalf("replayed bills = %+v, want the first bill unchanged on retry", fake.bills)
				}
				var tokens int64
				for _, bill := range fake.accepted {
					tokens += bill.InputTokens
				}
				if len(fake.accepted) != 2 || tokens != 300 {
					t.Fatalf("accepted bills = %+v, want two reports totaling 300 tokens", fake.accepted)
				}
			})
		}
	}
}

func TestSpoolFailedAcknowledgementKeepsConcurrentAppend(t *testing.T) {
	s := manualSpool(t)
	headSent := make(chan struct{})
	headReply := make(chan struct{})
	var firstSend, releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(headReply) }) }
	fake := &spoolUpstream{accepted: map[string]UsagePayload{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/play") {
			firstSend.Do(func() {
				close(headSent)
				<-headReply
			})
		}
		fake.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(release)
	s.Inner = NewHybridflowStore(server.URL, "token")
	if _, err := s.Start("board", "node", "run"); err != nil {
		t.Fatal(err)
	}
	flushed := make(chan error, 1)
	go func() { flushed <- s.flush() }()
	select {
	case <-headSent:
	case <-time.After(5 * time.Second):
		t.Fatal("sender did not reach the upstream")
	}
	board, err := s.Finish("board", "node", "run", PlayResult{Status: FlowNodeStatusDone, Output: json.RawMessage(`{"result":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	cause := errors.New("injected rename failure")
	s.mu.Lock()
	s.files = failingSpoolFiles{spoolFiles: osSpoolFiles{}, stage: "rename", err: cause}
	s.mu.Unlock()
	release()
	select {
	case err := <-flushed:
		if !errors.Is(err, cause) {
			t.Fatalf("flush = %v, want %v", err, cause)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("sender did not return the persistence failure")
	}
	if len(s.pending) != 2 || s.pending[0].Op != SpoolStart || s.pending[1].Op != SpoolFinish {
		t.Fatalf("pending = %+v, want both the transmitted and concurrently appended marks", s.pending)
	}
	if cached, err := s.Board("board"); err != nil || !reflect.DeepEqual(cached, board) {
		t.Fatalf("Board = %+v, %v, want the optimistic completion", cached, err)
	}
	assertSpoolMatchesMemory(t, s)
	s.files = osSpoolFiles{}
	if err := s.flush(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	assertSpoolMatchesMemory(t, s)
	if len(s.pending) != 0 {
		t.Fatal("retry did not drain the queue")
	}
}
