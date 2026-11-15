package runnerhttp

import (
	"encoding/json"
	"errors"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	claudecli "kiao/worker/internal/hybridflow-runner/harnesses/claude"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	pkgSync "sync"
	"testing"
	"time"
)

// stubHarness makes stubDrivers and keeps them, so a test can reach the driver a turn was given
// without threading it through the hub.
type stubHarness struct {
	mu pkgSync.Mutex
	// spawnErr, when set, is what every Spawn answers with — the sentence a turn that never ran is
	// refused with.
	spawnErr error
	drivers  []*stubDriver
}

func (a *stubHarness) Driver() harnessapi.HarnessDriver {
	driver := &stubDriver{events: make(chan harnessapi.HarnessEvent)}
	a.mu.Lock()
	driver.spawnErr = a.spawnErr
	a.drivers = append(a.drivers, driver)
	a.mu.Unlock()
	return driver
}

// claudeAgentAt is the Claude harness pointed at a binary of the test's choosing. It is what keeps one
// path in this package end to end over the real stream-json protocol: the board tests drive a whole
// turn — spawn, stream, settle, transcript — through a shell script standing in for the CLI.
func claudeAgentAt(cfg *runnerconfig.Config, binary string) *claudecli.ClaudeHarness {
	harness := &claudecli.ClaudeHarness{Cfg: cfg, Binary: binary, OptionsService: claudecli.NewClaudeOptionsService(cfg)}
	// The options service is wired because the permission modes are read off it — the board refuses a
	// card asking for a mode its harness does not have — and stubbed because the effort levels are not
	// what these tests are about: reading them would spawn a `claude` the host need not have.
	harness.OptionsService.Help = func() (string, error) { return "", errors.New("no CLI in this test") }
	return harness
}

// refusingHarness is a harness whose every spawn fails. It is how a test reaches the "the turn never
// ran" branch deterministically, with no `claude` on the host and nothing on the filesystem — what
// the CLI itself answers when its binary is missing is pinned in driver_claude_test.go.
func refusingHarness() *stubHarness {
	return &stubHarness{spawnErr: errors.New("The Claude process could not be started: no such file")}
}

// last is the driver of the most recent turn, or nil when none was spawned.
func (a *stubHarness) last() *stubDriver {
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
func (a *stubHarness) waitForDriver(t *testing.T) *stubDriver {
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
	decision harnessapi.AskDecision
}

// stubDriver is one turn with nothing behind it. The test is the harness: it emits the blocks, asks
// the questions and decides when the turn ends.
type stubDriver struct {
	events chan harnessapi.HarnessEvent
	end    pkgSync.Once

	mu       pkgSync.Mutex
	spawnErr error
	run      harnessapi.HarnessRun
	started  bool
	answers  []stubAnswer
	said     []string
	stopped  bool
}

var _ harnessapi.HarnessDriver = (*stubDriver)(nil)

func (d *stubDriver) Spawn(run harnessapi.HarnessRun) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.spawnErr != nil {
		return d.spawnErr
	}
	d.run = run
	d.started = true
	return nil
}

func (d *stubDriver) Events() <-chan harnessapi.HarnessEvent { return d.events }

func (d *stubDriver) Answer(askID string, decision harnessapi.AskDecision) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return errors.New("the stub harness has stopped")
	}
	d.answers = append(d.answers, stubAnswer{askID: askID, decision: decision})
	return nil
}

func (d *stubDriver) Say(text string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return errors.New("the stub harness has stopped")
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

// emit is the harness speaking. It blocks until the hub has acted on the event, which is what makes a
// test's next assertion safe to make.
func (d *stubDriver) emit(event harnessapi.HarnessEvent) { d.events <- event }

// block, ask and session are the three events worth a shorthand.
func (d *stubDriver) block(block harnessapi.TurnBlock) {
	d.emit(harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: block})
}

func (d *stubDriver) text(s string) {
	d.block(harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: s})
}

func (d *stubDriver) ask(ask *harnessapi.HarnessAsk) {
	d.emit(harnessapi.HarnessEvent{Kind: harnessapi.EventAsk, Ask: ask})
}

func (d *stubDriver) session(id string) {
	d.emit(harnessapi.HarnessEvent{Kind: harnessapi.EventSession, SessionID: id})
}

// finish ends the stream, once, whichever of the test and Stop gets there first.
func (d *stubDriver) finish(exitCode int) {
	d.end.Do(func() {
		go func() {
			d.events <- harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: exitCode}
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

func (d *stubDriver) spawnedWith() harnessapi.HarnessRun {
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

// feed runs one raw CLI event through the driver's own translation and then through the hub's
// consumption of it. It is the two halves of the seam exercised together, which is what a live turn
// does — so a test written this way pins the CLI's protocol *and* what the hub makes of it, exactly
// as it did when the two were one function.
func feed(h *pkgTurns.Engine, t *testing.T, job *pkgTurns.Turn, event map[string]any) {
	t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode the CLI event: %v", err)
	}
	feedLine(h, t, job, string(raw))
}

// feedLine is feed for an event a test writes out as JSON, including the malformed ones.
func feedLine(h *pkgTurns.Engine, t *testing.T, job *pkgTurns.Turn, line string) {
	t.Helper()
	driver, ok := job.Harness().(*claudecli.ClaudeDriver)
	if !ok {
		t.Fatal("this turn is not running on the Claude driver")
	}
	for _, event := range driver.ReadEvent(line) {
		h.Apply(job, event)
	}
}
