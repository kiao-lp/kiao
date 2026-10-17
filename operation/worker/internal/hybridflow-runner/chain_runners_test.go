package hybridflowrunner

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubRunners is the hybridflow-store's runners behind a map: the ids it holds.
type stubRunners struct {
	byID map[string]*managedRunner
}

func (s stubRunners) Runner(id string) (*managedRunner, error) {
	if found, ok := s.byID[id]; ok {
		return found, nil
	}
	return nil, ErrRunnerUnknown
}

func TestRunnerRefusalLetsUnpinnedCardsThrough(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.cfg.RunnerID = "runner-1"
	if refusal := rt.runner.runnerRefusal(flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{Agent: "agent-1"},
	}); refusal != "" {
		t.Errorf("refusal = %q, want a card pinned nowhere played anywhere", refusal)
	}
}

func TestRunnerRefusalLetsItsOwnRunnerThrough(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.cfg.RunnerID = "runner-1"
	if refusal := rt.runner.runnerRefusal(flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{Agent: "agent-1", Runner: "runner-1"},
	}); refusal != "" {
		t.Errorf("refusal = %q, want the card pinned here played", refusal)
	}
}

// A card pinned to another runner is refused by the runners' names rather than by ids nobody
// reads.
func TestRunnerRefusalNamesTheRunners(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.cfg.RunnerID = "runner-1"
	rt.runner.runners = stubRunners{byID: map[string]*managedRunner{
		"runner-1": {Name: "Desktop"},
		"runner-2": {Name: "Server"},
	}}
	refusal := rt.runner.runnerRefusal(flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{Agent: "agent-1", Runner: "runner-2"},
	})
	if !strings.Contains(refusal, "Server") || !strings.Contains(refusal, "Desktop") {
		t.Errorf("refusal = %q, want both runners named", refusal)
	}
	if strings.Contains(refusal, "runner-1") || strings.Contains(refusal, "runner-2") {
		t.Errorf("refusal = %q, want names rather than ids", refusal)
	}
}

// A service naming no runner is none of them: it plays unpinned cards and refuses every pinned
// one.
func TestRunnerRefusalWithoutAnOwnRunner(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.runner.runners = stubRunners{byID: map[string]*managedRunner{
		"runner-2": {Name: "Server"},
	}}
	refusal := rt.runner.runnerRefusal(flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{Agent: "agent-1", Runner: "runner-2"},
	})
	if !strings.Contains(refusal, "Server") || !strings.Contains(refusal, "names no runner") {
		t.Errorf("refusal = %q, want the pin and the missing identity named", refusal)
	}
}

// Where nothing resolves a name — no store is named — the refusal carries the id the card
// named, which is still the truth about it.
func TestRunnerRefusalCarriesTheIDWhereNothingResolves(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.cfg.RunnerID = "runner-1"
	if rt.runner.runners != nil {
		t.Fatal("a runner with no store must resolve nothing")
	}
	refusal := rt.runner.runnerRefusal(flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{Agent: "agent-1", Runner: "runner-2"},
	})
	if !strings.Contains(refusal, "runner-2") || !strings.Contains(refusal, "runner-1") {
		t.Errorf("refusal = %q, want both ids carried", refusal)
	}
}

// The play itself is refused before the agent is even resolved: where a card runs is asked ahead
// of what runs it.
func TestPlayableRefusesACardPinnedElsewhere(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[]}`)
	rt.cfg.RunnerID = "runner-1"
	rt.runner.runners = stubRunners{byID: map[string]*managedRunner{
		"runner-1": {Name: "Desktop"},
		"runner-2": {Name: "Server"},
	}}
	err := rt.runner.playable(&boardContent{}, flowNode{
		Type: flowNodeTypeAI, Title: "Do it",
		Settings: flowNodeSettings{
			Agent: "ghost", Effort: "high", Permission: "manualLive", Folder: "/",
			Runner: "runner-2",
		},
	})
	if err == nil {
		t.Fatal("a card pinned to another runner plays, want it refused")
	}
	if !strings.Contains(err.Error(), "Server") {
		t.Errorf("playable = %v, want the runner named", err)
	}
}

// The heartbeat runs only where there is a store to tell and an id to tell it as.
func TestStartRunnerHeartbeatNeedsBothHalves(t *testing.T) {
	if stop := startRunnerHeartbeat(nil, newHybridflowStore("http://127.0.0.1:1", "")); stop != nil {
		stop()
		t.Error("no config beats, want silence")
	}
	cfg := &Config{}
	if stop := startRunnerHeartbeat(cfg, newHybridflowStore("http://127.0.0.1:1", "")); stop != nil {
		stop()
		t.Error("no store and no runner id beats, want silence")
	}
	cfg.HybridflowURL = "http://127.0.0.1:1"
	if stop := startRunnerHeartbeat(cfg, newHybridflowStore(cfg.HybridflowURL, "")); stop != nil {
		stop()
		t.Error("no runner id beats, want silence")
	}
}

// The first beat goes out at once rather than after the first interval, so last seen is fresh
// from startup rather than fifteen seconds stale.
func TestStartRunnerHeartbeatBeatsAtOnce(t *testing.T) {
	beats := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("heartbeat = %s, want POST", r.Method)
		}
		beats <- r.URL.Path
		w.Write([]byte(`{"id":"runner-1","name":"Server","revision":1}`))
	}))
	defer server.Close()
	cfg := &Config{HybridflowURL: server.URL, RunnerID: "runner-1"}
	stop := startRunnerHeartbeat(cfg, newHybridflowStore(server.URL, ""))
	if stop == nil {
		t.Fatal("no heartbeat started")
	}
	defer stop()
	select {
	case path := <-beats:
		if path != "/runners/runner-1/heartbeat" {
			t.Errorf("heartbeat went to %q", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no beat within five seconds of startup")
	}
}

// Where the process names no runner, the root's own state directory is read: a runner.json beside
// dashboard.json names it, and a root without one is a service that names no runner.
func TestRunnerIDFromState(t *testing.T) {
	t.Run("missing is unconfigured", func(t *testing.T) {
		id, err := RunnerIDFromState(t.TempDir())
		if err != nil || id != "" {
			t.Errorf("RunnerIDFromState = %q, %v, want no runner and no error", id, err)
		}
	})
	t.Run("the file names the runner", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "runner.json"),
			[]byte("{\"runnerId\": \"runner-1\"}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		id, err := RunnerIDFromState(dir)
		if err != nil || id != "runner-1" {
			t.Errorf("RunnerIDFromState = %q, %v, want runner-1", id, err)
		}
	})
	t.Run("an empty file names none", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "runner.json"),
			[]byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		id, err := RunnerIDFromState(dir)
		if err != nil || id != "" {
			t.Errorf("RunnerIDFromState = %q, %v, want no runner and no error", id, err)
		}
	})
	// A half-written id must stop startup rather than play under no name, or the wrong one.
	t.Run("a broken file is an error", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "runner.json"),
			[]byte("{\"runnerId\":"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := RunnerIDFromState(dir); err == nil {
			t.Error("RunnerIDFromState = nil, want the broken file refused")
		}
	})
}
