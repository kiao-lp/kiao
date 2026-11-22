package muse

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

type museTestPipe struct {
	write  func([]byte) (int, error)
	closes atomic.Int32
}

func (p *museTestPipe) Write(line []byte) (int, error) { return p.write(line) }
func (p *museTestPipe) Close() error {
	p.closes.Add(1)
	return nil
}

func museApprovalStage(stage string) map[string]any {
	return map[string]any{
		"approvalId": "a1", "currentRequirementId": stage,
		"subject": map[string]any{"kind": "shell", "command": stage},
		"availableChoices": []any{map[string]any{
			"choiceId": stage, "decision": "approved", "scope": "once",
		}},
	}
}

func TestMuseAnswerRecognizesSettlementBeforeRPCResponse(t *testing.T) {
	driver := &MuseDriver{}
	first, ok := driver.approvalAsked(museApprovalStage("stage-1"))
	if !ok {
		t.Fatal("approval was not published")
	}
	conn := &MspConn{pending: map[int]chan mspResult{}, done: make(chan struct{})}
	var sent map[string]any
	var updated harnessapi.HarnessEvent
	pipe := &museTestPipe{write: func(line []byte) (int, error) {
		var frame struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if err := json.Unmarshal(line, &frame); err != nil {
			return 0, err
		}
		if frame.Method != "approval/decide" || frame.Params["sessionId"] != "session-1" {
			return 0, fmt.Errorf("unexpected command: %+v", frame)
		}
		sent = frame.Params
		if driver.asks.parked() {
			return 0, fmt.Errorf("answer still parks on the user while sending")
		}
		if event, withdraw := driver.asks.settleApproval(map[string]any{
			"approvalId": "a1", "decidedByCommandId": sent["commandId"],
		}); withdraw {
			return 0, fmt.Errorf("own settlement withdrew the request: %+v", event)
		}
		var reopened bool
		updated, reopened = driver.asks.updateApproval(museApprovalStage("stage-2"))
		if !reopened {
			return 0, fmt.Errorf("new stage did not reopen the request")
		}
		conn.mu.Lock()
		answer := conn.pending[frame.ID]
		delete(conn.pending, frame.ID)
		conn.mu.Unlock()
		answer <- mspResult{result: json.RawMessage(`{}`)}
		return len(line), nil
	}}
	conn.stdin = pipe
	driver.host.setConnection(conn)
	driver.host.opened("session-1", "turn-1", false)

	answered := make(chan error, 1)
	go func() { answered <- driver.Answer(first.Ask.ID, harnessapi.AskDecision{Allow: true}) }()
	select {
	case err := <-answered:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Answer held a state lock during RPC")
	}
	if sent["requirementId"] != "stage-1" || sent["choiceId"] != "stage-1" {
		t.Fatalf("command changed stage in flight: %+v", sent)
	}
	if first.Ask.Description != "stage-1" || updated.Ask.Description != "stage-2" {
		t.Fatalf("published requests changed: first=%+v updated=%+v", first.Ask, updated.Ask)
	}
	if !driver.asks.parked() {
		t.Fatal("the new stage must wait for its own answer")
	}
}

func TestMuseConcurrentAnswersCaptureOneApprovalStage(t *testing.T) {
	driver := &MuseDriver{}
	first, _ := driver.approvalAsked(museApprovalStage("initial"))
	var work sync.WaitGroup
	errors := make(chan error, 1)
	work.Go(func() {
		for i := range 1000 {
			driver.asks.updateApproval(museApprovalStage(fmt.Sprint(i)))
		}
	})
	work.Go(func() {
		for range 1000 {
			answer, err := driver.asks.prepare(first.Ask.ID, harnessapi.AskDecision{Allow: true})
			if err != nil {
				errors <- err
				return
			}
			if answer.params["requirementId"] != answer.params["choiceId"] {
				errors <- fmt.Errorf("mixed approval stages: %+v", answer.params)
				return
			}
			if first.Ask.Description != "initial" {
				errors <- fmt.Errorf("the previously published request was modified")
				return
			}
		}
	})
	work.Wait()
	select {
	case err := <-errors:
		t.Fatal(err)
	default:
	}
}

func TestMuseMSPCloseJoinsReaderWithUndrainedNotifications(t *testing.T) {
	pipe := &museTestPipe{}
	conn := &MspConn{
		stdin: pipe, notifs: make(chan MspNotification, 1),
		done: make(chan struct{}), closing: make(chan struct{}),
	}
	go conn.read(strings.NewReader(strings.Repeat(`{"method":"item/updated","params":{}}`+"\n", 1000)))
	<-conn.notifs
	var closers sync.WaitGroup
	for range 8 {
		closers.Go(conn.Close)
	}
	closed := make(chan struct{})
	go func() { closers.Wait(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("Close left its reader parked on notifications")
	}
	if pipe.closes.Load() != 1 {
		t.Fatalf("stdin closed %d times, want once", pipe.closes.Load())
	}
	select {
	case <-conn.done:
	default:
		t.Fatal("Close returned before its reader ended")
	}
}

func TestMuseConcurrentControlCallsReleaseHostAndStagingBeforeStreamCloses(t *testing.T) {
	driver, _ := museStubDriver(t, "ask")
	dir := t.TempDir()
	if err := driver.Spawn(harnessapi.HarnessRun{
		Prompt: "list files", WorkDir: dir, StoreRoot: dir,
		MCPConfig: `{}`, MCPToken: "turn-token",
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(driver.Stop)
	if event := museNext(t, driver.Events()); event.Kind != harnessapi.EventSession {
		t.Fatalf("first event = %+v", event)
	}
	ask := museNext(t, driver.Events())
	if ask.Kind != harnessapi.EventAsk {
		t.Fatalf("second event = %+v", ask)
	}
	conn, staging := driver.host.snapshot().conn, driver.stagingDir
	start := make(chan struct{})
	var controls sync.WaitGroup
	for _, call := range []func(){
		func() { _ = driver.Answer(ask.Ask.ID, harnessapi.AskDecision{Allow: true}) },
		func() { _ = driver.Say("continue") },
		driver.Stop, driver.Stop, conn.Close,
	} {
		controls.Go(func() { <-start; call() })
	}
	close(start)
	events := drainMuse(t, driver)
	controls.Wait()
	done := 0
	for i, event := range events {
		if event.Kind == harnessapi.EventDone {
			done++
			if i != len(events)-1 {
				t.Fatal("events followed the final done")
			}
		}
	}
	if done != 1 {
		t.Fatalf("done count = %d, want one", done)
	}
	if conn.cmd.ProcessState == nil {
		t.Fatal("event stream closed before the host was reaped")
	}
	if _, err := os.Stat(staging); !os.IsNotExist(err) {
		t.Fatalf("staged credential directory still exists after closure: %v", err)
	}
	if err := driver.Say("late message"); err == nil {
		t.Fatal("Say accepted input after the turn ended")
	}
}
