package hybridflowrunner

import (
	"sync"
	"testing"
	"time"

	"kiao/worker/internal/core"
)

// Hold the spawn and the final stream close separately: neither a Stop request
// nor a settled transcript proves that a driver has finished cleaning up.
type heldLifecycleDriver struct {
	*stubDriver
	entered chan struct{}
	release chan struct{}
}

func (d *heldLifecycleDriver) Spawn(run AgentRun) error {
	if err := d.stubDriver.Spawn(run); err != nil {
		return err
	}
	close(d.entered)
	<-d.release
	return nil
}

func (d *heldLifecycleDriver) Stop() {
	d.mu.Lock()
	d.stopped = true
	d.mu.Unlock()
}

type lifecycleTestAgent struct {
	first    sync.Once
	driver   AgentDriver
	fallback stubAgent
}

func (a *lifecycleTestAgent) Driver() AgentDriver {
	var driver AgentDriver
	a.first.Do(func() { driver = a.driver })
	if driver != nil {
		return driver
	}
	return a.fallback.Driver()
}

func newHeldTurn(t *testing.T) (*ClaudeHub, *ConversationStore, conversationMeta, *lifecycleTestAgent, *heldLifecycleDriver, func()) {
	t.Helper()
	store, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, store)
	driver := &heldLifecycleDriver{stubDriver: &stubDriver{events: make(chan AgentEvent)},
		entered: make(chan struct{}), release: make(chan struct{})}
	agent := &lifecycleTestAgent{driver: driver}
	hub.agents = &agentRegistry{entries: []agentEntry{
		{name: agentCodex, agent: agent, allowed: true},
	}}
	conversation, err := store.create(conversationMeta{Agent: agentCodex, Owner: "tester",
		PermissionMode: permissionModeBypass, SessionID: "shared-session"})
	if err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() { once.Do(func() { close(driver.release) }) }
	t.Cleanup(func() {
		hub.mu.Lock()
		var jobs []*claudeJob
		for _, job := range hub.jobs {
			jobs = append(jobs, job)
		}
		hub.mu.Unlock()
		release()
		driver.finish(-1)
		hub.shutdown()
		for _, job := range jobs {
			awaitProcessRelease(t, job)
		}
	})
	return hub, store, conversation, agent, driver, release
}

func awaitProcessRelease(t *testing.T, job *claudeJob) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job.mu.Lock()
		pending := job.processPending
		job.mu.Unlock()
		if !pending {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("the driver never released its execution reservation")
}

func awaitLifecycleSignal(t *testing.T, signal <-chan struct{}, message string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(3 * time.Second):
		t.Fatal(message)
	}
}

func TestInterruptedTurnRetainsReservationUntilDriverCloses(t *testing.T) {
	for _, when := range []string{"during-spawn", "after-spawn"} {
		t.Run(when, func(t *testing.T) {
			hub, store, conversation, agent, driver, release := newHeldTurn(t)
			returned := make(chan struct{})
			go func() {
				defer close(returned)
				hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
					conversationID: conversation.ID, prompt: "first"})
			}()
			awaitLifecycleSignal(t, driver.entered, "the first spawn never started")
			if when == "after-spawn" {
				release()
				awaitLifecycleSignal(t, returned, "the first spawn never returned")
			}
			first := hub.getJob(conversation.ID)
			if !hub.stopProcess(conversation.ID, "tester") {
				t.Fatal("the first turn was not stopped")
			}
			awaitLifecycleSignal(t, first.settled, "the interruption was not recorded")
			if _, refusal := hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
				conversationID: conversation.ID, prompt: "second"}); refusal == nil || refusal.code != errCodeConversationBusy {
				t.Fatalf("restart = %+v, want busy until the old driver closes", refusal)
			}
			if count := hub.activeTurnCount(); count != 1 {
				t.Errorf("active turns = %d, want the draining turn to retain its capacity", count)
			}
			hub.sweepExpiredJobs(time.Now().Add(24 * time.Hour))
			if hub.getJob(conversation.ID) != first {
				t.Fatal("the janitor released a conversation whose driver is still alive")
			}
			release()
			awaitLifecycleSignal(t, returned, "the stopped spawn never returned")
			if !driver.wasStopped() {
				t.Fatal("the driver published after interruption was not stopped")
			}
			driver.finish(-1)

			// Retrying becomes possible only once the stream has closed. It resumes
			// the same session and cannot overlap the interrupted execution.
			var second *claudeJob
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				var refusal *turnRefusal
				second, refusal = hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
					conversationID: conversation.ID, prompt: "second"})
				if refusal == nil {
					break
				}
				if refusal.code != errCodeConversationBusy {
					t.Fatalf("restart = %+v", refusal)
				}
				time.Sleep(5 * time.Millisecond)
			}
			if second == nil {
				t.Fatal("the conversation stayed busy after cleanup")
			}
			next := agent.fallback.last()
			if next == nil || next.spawnedWith().SessionID != "shared-session" {
				t.Fatal("the next execution did not resume the interrupted session")
			}
			next.finish(0)
			awaitLifecycleSignal(t, second.settled, "the resumed turn never settled")
			records := mustMessages(t, store, conversation.ID)
			if len(records) != 4 || !records[1].Interrupted || records[3].Interrupted {
				t.Fatalf("transcript = %+v, want one interruption followed by one resumed reply", records)
			}
		})
	}
}

func TestShutdownStopsDriverStillSpawning(t *testing.T) {
	hub, _, conversation, _, driver, release := newHeldTurn(t)
	returned := make(chan struct{})
	go func() {
		defer close(returned)
		hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
			conversationID: conversation.ID, prompt: "first"})
	}()
	awaitLifecycleSignal(t, driver.entered, "the spawn never started")
	job := hub.getJob(conversation.ID)
	hub.shutdown()
	release()
	awaitLifecycleSignal(t, returned, "the spawn never returned after shutdown")
	if !driver.wasStopped() {
		t.Error("the driver started during shutdown survived it")
	}
	if _, refusal := hub.startTurnFor(nil, core.Identity{User: "tester"}, turnRequest{
		conversationID: conversation.ID, prompt: "second"}); refusal == nil {
		t.Error("shutdown accepted another execution")
	}
	driver.finish(-1)
	awaitProcessRelease(t, job)
}
