package runnerhttp

import (
	"kiao/worker/internal/core/access"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	pkgSync "sync"
	"testing"
	"time"
)

// Hold the spawn and the final stream close separately: neither a Stop request
// nor a settled transcript proves that a driver has finished cleaning up.
type heldLifecycleDriver struct {
	*stubDriver
	entered chan struct{}
	release chan struct{}
}

func (d *heldLifecycleDriver) Spawn(run agentapi.AgentRun) error {
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
	first    pkgSync.Once
	driver   agentapi.AgentDriver
	fallback stubAgent
}

func (a *lifecycleTestAgent) Driver() agentapi.AgentDriver {
	var driver agentapi.AgentDriver
	a.first.Do(func() { driver = a.driver })
	if driver != nil {
		return driver
	}
	return a.fallback.Driver()
}

func newHeldTurn(t *testing.T) (*pkgTurns.Engine, *pkgConversations.ConversationStore, pkgConversations.ConversationMeta, *lifecycleTestAgent, *heldLifecycleDriver, func()) {
	t.Helper()
	store, cfg := newTurnRegistry(t)
	hub := assembly.NewEngine(cfg, store)
	driver := &heldLifecycleDriver{stubDriver: &stubDriver{events: make(chan agentapi.AgentEvent)},
		entered: make(chan struct{}), release: make(chan struct{})}
	agent := &lifecycleTestAgent{driver: driver}
	hub.Agents = &agentapi.AgentRegistry{Entries: []agentapi.AgentEntry{
		{Name: agentapi.AgentCodex, Agent: agent, Allowed: true},
	}}
	conversation, err := store.Create(pkgConversations.ConversationMeta{Agent: agentapi.AgentCodex, Owner: "tester",
		PermissionMode: runnerconfig.PermissionModeBypass, SessionID: "shared-session"})
	if err != nil {
		t.Fatal(err)
	}
	var once pkgSync.Once
	release := func() { once.Do(func() { close(driver.release) }) }
	t.Cleanup(func() {
		hub.Mu.Lock()
		var jobs []*pkgTurns.Turn
		for _, job := range hub.Jobs {
			jobs = append(jobs, job)
		}
		hub.Mu.Unlock()
		release()
		driver.finish(-1)
		hub.Shutdown()
		for _, job := range jobs {
			awaitProcessRelease(t, job)
		}
	})
	return hub, store, conversation, agent, driver, release
}

func awaitProcessRelease(t *testing.T, job *pkgTurns.Turn) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job.Mu.Lock()
		pending := job.ProcessPending
		job.Mu.Unlock()
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
				hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
					ConversationID: conversation.ID, Prompt: "first"})
			}()
			awaitLifecycleSignal(t, driver.entered, "the first spawn never started")
			if when == "after-spawn" {
				release()
				awaitLifecycleSignal(t, returned, "the first spawn never returned")
			}
			first := hub.GetJob(conversation.ID)
			if !hub.StopProcess(conversation.ID, "tester") {
				t.Fatal("the first turn was not stopped")
			}
			awaitLifecycleSignal(t, first.Settled, "the interruption was not recorded")
			if _, refusal := hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
				ConversationID: conversation.ID, Prompt: "second"}); refusal == nil || refusal.Code != turnevents.ErrCodeConversationBusy {
				t.Fatalf("restart = %+v, want busy until the old driver closes", refusal)
			}
			if count := hub.ActiveTurnCount(); count != 1 {
				t.Errorf("active turns = %d, want the draining turn to retain its capacity", count)
			}
			hub.SweepExpiredJobs(time.Now().Add(24 * time.Hour))
			if hub.GetJob(conversation.ID) != first {
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
			var second *pkgTurns.Turn
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				var refusal *agentfaults.TurnRefusal
				second, refusal = hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
					ConversationID: conversation.ID, Prompt: "second"})
				if refusal == nil {
					break
				}
				if refusal.Code != turnevents.ErrCodeConversationBusy {
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
			awaitLifecycleSignal(t, second.Settled, "the resumed turn never settled")
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
		hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
			ConversationID: conversation.ID, Prompt: "first"})
	}()
	awaitLifecycleSignal(t, driver.entered, "the spawn never started")
	job := hub.GetJob(conversation.ID)
	hub.Shutdown()
	release()
	awaitLifecycleSignal(t, returned, "the spawn never returned after shutdown")
	if !driver.wasStopped() {
		t.Error("the driver started during shutdown survived it")
	}
	if _, refusal := hub.StartTurnFor(nil, access.Identity{User: "tester"}, pkgTurns.TurnRequest{
		ConversationID: conversation.ID, Prompt: "second"}); refusal == nil {
		t.Error("shutdown accepted another execution")
	}
	driver.finish(-1)
	awaitProcessRelease(t, job)
}
