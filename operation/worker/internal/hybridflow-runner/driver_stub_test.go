package hybridflowrunner

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

// The agent a test drives.
//
// This is what the AgentDriver port buys beyond the seam itself: a turn can be spawned, streamed,
// answered and stopped with **no `claude` on PATH**. Before it, every test about the turn lifecycle
// either pointed the hub at a binary that does not exist — which only ever reaches the failure
// branch — or drove `sleep 60` and pretended it was an agent. Here the whole of a turn is written
// out by the test: the blocks it produces, what it asks, and how it ends.
//
// It is deliberately a *recording* stub rather than a scripted one. What the hub handed the driver
// is the interesting half of most of these assertions — the run it spawned with, the decisions it
// wrote back, what it said into a running turn — so all of it is kept and read afterwards.

// stubAgent makes stubDrivers and keeps them, so a test can reach the driver a turn was given
// without threading it through the hub.
type stubAgent struct {
	mu sync.Mutex
	// spawnErr, when set, is what every Spawn answers with — the sentence a turn that never ran is
	// refused with.
	spawnErr error
	drivers  []*stubDriver
}

func (a *stubAgent) Driver() AgentDriver {
	driver := &stubDriver{events: make(chan AgentEvent)}
	a.mu.Lock()
	driver.spawnErr = a.spawnErr
	a.drivers = append(a.drivers, driver)
	a.mu.Unlock()
	return driver
}

// claudeAgentAt is the Claude agent pointed at a binary of the test's choosing. It is what keeps one
// path in this package end to end over the real stream-json protocol: the board tests drive a whole
// turn — spawn, stream, settle, transcript — through a shell script standing in for the CLI.
func claudeAgentAt(cfg *Config, binary string) *claudeAgent {
	agent := &claudeAgent{cfg: cfg, binary: binary, options: newClaudeOptionsService(cfg)}
	// The options service is wired because the permission modes are read off it — the board refuses a
	// card asking for a mode its agent does not have — and stubbed because the effort levels are not
	// what these tests are about: reading them would spawn a `claude` the host need not have.
	agent.options.help = func() (string, error) { return "", errors.New("no CLI in this test") }
	return agent
}

// refusingAgent is an agent whose every spawn fails. It is how a test reaches the "the turn never
// ran" branch deterministically, with no `claude` on the host and nothing on the filesystem — what
// the CLI itself answers when its binary is missing is pinned in driver_claude_test.go.
func refusingAgent() *stubAgent {
	return &stubAgent{spawnErr: errors.New("The Claude process could not be started: no such file")}
}

// last is the driver of the most recent turn, or nil when none was spawned.
func (a *stubAgent) last() *stubDriver {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.drivers) == 0 {
		return nil
	}
	return a.drivers[len(a.drivers)-1]
}

// waitForDriver waits for a turn to be spawned and returns its driver. A turn started by the
// chain runner is started on a goroutine of its own, so a test that means to drive it has to
// wait for it rather than assume it is already there.
func (a *stubAgent) waitForDriver(t *testing.T) *stubDriver {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if driver := a.last(); driver != nil && driver.spawned() {
			return driver
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("no turn was spawned")
	return nil
}

// stubAnswer is one decision the hub wrote back, kept in the order they were written.
type stubAnswer struct {
	askID    string
	decision AskDecision
}

// stubDriver is one turn with nothing behind it. The test is the agent: it emits the blocks, asks
// the questions and decides when the turn ends.
type stubDriver struct {
	events chan AgentEvent
	end    sync.Once

	mu       sync.Mutex
	spawnErr error
	run      AgentRun
	started  bool
	answers  []stubAnswer
	said     []string
	stopped  bool
}

var _ AgentDriver = (*stubDriver)(nil)

func (d *stubDriver) Spawn(run AgentRun) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.spawnErr != nil {
		return d.spawnErr
	}
	d.run = run
	d.started = true
	return nil
}

func (d *stubDriver) Events() <-chan AgentEvent { return d.events }

func (d *stubDriver) Answer(askID string, decision AskDecision) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return errors.New("the stub agent has stopped")
	}
	d.answers = append(d.answers, stubAnswer{askID: askID, decision: decision})
	return nil
}

func (d *stubDriver) Say(text string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return errors.New("the stub agent has stopped")
	}
	d.said = append(d.said, text)
	return nil
}

// Stop ends the turn the way the real driver does: the kill is immediate, and the stream closes on
// its own goroutine with the exit code of a turn somebody ended. Blocking here would deadlock the
// caller, which is holding nothing but is about to settle the very turn this event is for.
func (d *stubDriver) Stop() {
	d.mu.Lock()
	d.stopped = true
	d.mu.Unlock()
	d.finish(-1)
}

// emit is the agent speaking. It blocks until the hub has acted on the event, which is what makes a
// test's next assertion safe to make.
func (d *stubDriver) emit(event AgentEvent) { d.events <- event }

// block, ask and session are the three events worth a shorthand.
func (d *stubDriver) block(block turnBlock) { d.emit(AgentEvent{Kind: agentBlock, Block: block}) }
func (d *stubDriver) text(s string) {
	d.block(turnBlock{kind: blockKindText, text: s})
}
func (d *stubDriver) ask(ask *AgentAsk) { d.emit(AgentEvent{Kind: agentAsk, Ask: ask}) }
func (d *stubDriver) session(id string) {
	d.emit(AgentEvent{Kind: agentSession, SessionID: id})
}

// finish ends the stream, once, whichever of the test and Stop gets there first.
func (d *stubDriver) finish(exitCode int) {
	d.end.Do(func() {
		go func() {
			d.events <- AgentEvent{Kind: agentDone, ExitCode: exitCode}
			close(d.events)
		}()
	})
}

// drain reads the stream and drops it, for a turn a test made by hand rather than spawned: nothing
// is consuming it, and Stop would otherwise leave its agentDone with nowhere to go.
func (d *stubDriver) drain() {
	go func() {
		for range d.events {
		}
	}()
}

func (d *stubDriver) spawned() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.started
}

func (d *stubDriver) spawnedWith() AgentRun {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.run
}

func (d *stubDriver) decisions() []stubAnswer {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]stubAnswer{}, d.answers...)
}

func (d *stubDriver) betweens() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string{}, d.said...)
}

func (d *stubDriver) wasStopped() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stopped
}

// ── the seam, driven from the CLI side ────────────────────────────────────────

// feed runs one raw CLI event through the driver's own translation and then through the hub's
// consumption of it. It is the two halves of the seam exercised together, which is what a live turn
// does — so a test written this way pins the CLI's protocol *and* what the hub makes of it, exactly
// as it did when the two were one function.
func (h *ClaudeHub) feed(t *testing.T, job *claudeJob, event map[string]any) {
	t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode the CLI event: %v", err)
	}
	h.feedLine(t, job, string(raw))
}

// feedLine is feed for an event a test writes out as JSON, including the malformed ones.
func (h *ClaudeHub) feedLine(t *testing.T, job *claudeJob, line string) {
	t.Helper()
	driver, ok := job.agent().(*claudeDriver)
	if !ok {
		t.Fatal("this turn is not running on the Claude driver")
	}
	for _, event := range driver.readEvent(line) {
		h.apply(job, event)
	}
}
