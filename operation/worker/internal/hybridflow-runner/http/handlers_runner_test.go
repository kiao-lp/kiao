package runnerhttp

import (
	"encoding/json"
	coreconfig "kiao/worker/internal/core/config"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// stopBeats ends the heartbeat a test started, under the same lock the service uses. Shutdown
// would do it too, but it also shuts a hub the tests here never built.
func (s *Service) stopBeats() {
	s.heartbeatMu.Lock()
	defer s.heartbeatMu.Unlock()
	if s.stopHeartbeat != nil {
		s.stopHeartbeat()
		s.stopHeartbeat = nil
	}
}

// The panel marks one runner "this machine" and offers "it's me" on the others, so the answer is
// the id and where it came from: a file the panel can save again, or an export it cannot.
func TestHandleRunnerIdentity(t *testing.T) {
	cases := []struct {
		name   string
		cfg    *runnerconfig.Config
		wantID string
		want   string
	}{
		{"no service configuration names none", nil, "", runnerSourceNone},
		{"no id names none", &runnerconfig.Config{}, "", runnerSourceNone},
		{"the file names the runner", &runnerconfig.Config{RunnerID: "runner-1"}, "runner-1", runnerSourceFile},
		{"the environment wins over the file", &runnerconfig.Config{RunnerID: "runner-1", RunnerFromEnv: true}, "runner-1", runnerSourceEnv},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := do(&Service{cfg: c.cfg}, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/runner", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body)
			}
			var got runnerIdentityDto
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("body is not the identity: %v (%s)", err, rec.Body)
			}
			if got.RunnerID != c.wantID || got.Source != c.want {
				t.Errorf("identity = %+v, want {%s %s}", got, c.wantID, c.want)
			}
		})
	}
}

// Saving runner.json adopts the id it names: the next beat and the next Play go out as the new
// runner, without a restart.
func TestSyncRunnerIdentityAdoptsTheFile(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runner.json"), "{\"runnerId\": \"runner-2\"}\n")
	s := &Service{cfg: &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, RunnerID: "runner-1"}}

	s.SyncRunnerIdentity()

	if got := s.cfg.CurrentRunnerID(); got != "runner-2" {
		t.Errorf("runner id = %q, want runner-2", got)
	}
}

// A service the environment named keeps its id: the export wins over the file for the life of the
// process, and the save is kept for a run without it.
func TestSyncRunnerIdentityKeepsTheEnvironment(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runner.json"), "{\"runnerId\": \"runner-2\"}\n")
	s := &Service{cfg: &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, RunnerID: "runner-1", RunnerFromEnv: true}}

	s.SyncRunnerIdentity()

	if got := s.cfg.CurrentRunnerID(); got != "runner-1" {
		t.Errorf("runner id = %q, want the environment's runner-1", got)
	}
}

// A document that cannot be read as one keeps the old identity: unlike at startup, a live service
// cannot stop over a PUT — and the file will still be refused then.
func TestSyncRunnerIdentityKeepsTheOldOneOnABrokenFile(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runner.json"), "{\"runnerId\":")
	s := &Service{cfg: &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, RunnerID: "runner-1"}}

	s.SyncRunnerIdentity()

	if got := s.cfg.CurrentRunnerID(); got != "runner-1" {
		t.Errorf("runner id = %q, want the old runner-1", got)
	}
}

// Adopting starts the heartbeat where none ran: a service that named no runner at startup beats
// from the save on.
func TestSyncRunnerIdentityStartsTheHeartbeat(t *testing.T) {
	beats := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		beats <- r.URL.Path
		w.Write([]byte(`{"id":"runner-2","name":"Server","revision":1}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runner.json"), "{\"runnerId\": \"runner-2\"}\n")
	s := &Service{
		cfg:            &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, HybridflowURL: server.URL},
		boardsUpstream: pkgBoards.NewHybridflowStore(server.URL, ""),
	}
	defer s.stopBeats()

	s.SyncRunnerIdentity()

	select {
	case path := <-beats:
		if path != "/runners/runner-2/heartbeat" {
			t.Errorf("heartbeat went to %q, want the adopted runner's", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no beat within five seconds of the save")
	}
}

// Adopting nothing stops the heartbeat where one ran: the service names no runner again, and no
// beat goes out under the old name — or under no name.
func TestSyncRunnerIdentityStopsTheHeartbeat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"runner-1","name":"Server","revision":1}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	s := &Service{
		cfg:            &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, HybridflowURL: server.URL, RunnerID: "runner-1"},
		boardsUpstream: pkgBoards.NewHybridflowStore(server.URL, ""),
	}
	s.stopHeartbeat = pkgBoards.StartRunnerHeartbeat(s.cfg, s.boardsUpstream)
	if s.stopHeartbeat == nil {
		t.Fatal("no heartbeat started")
	}
	defer s.stopBeats()

	mustWrite(t, filepath.Join(dir, "runner.json"), "{}\n")
	s.SyncRunnerIdentity()

	if s.stopHeartbeat != nil {
		t.Error("heartbeat still runs after the identity was saved away")
	}
	if got := s.cfg.CurrentRunnerID(); got != "" {
		t.Errorf("runner id = %q, want none", got)
	}
}

// Two saves at once must not stop the same heartbeat twice: a stop function closes a channel,
// which panics when closed twice.
func TestSyncRunnerIdentityIsSerialised(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"runner-1","name":"Server","revision":1}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "runner.json"), "{\"runnerId\": \"runner-1\"}\n")
	s := &Service{
		cfg:            &runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}, HybridflowURL: server.URL},
		boardsUpstream: pkgBoards.NewHybridflowStore(server.URL, ""),
	}
	defer s.stopBeats()

	done := make(chan struct{})
	for range 8 {
		go func() { s.SyncRunnerIdentity(); done <- struct{}{} }()
	}
	for range 8 {
		<-done
	}
	if s.stopHeartbeat == nil {
		t.Error("no heartbeat runs after concurrent saves")
	}
}
