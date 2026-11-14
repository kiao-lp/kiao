package claude

import (
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClaudeIntermediateResultKeepsControlInputOpen(t *testing.T) {
	driver, stdin := newTranslator()
	driver.ReadEvent(`{"type":"system","subtype":"session_state_changed","state":"running"}`)
	driver.ReadEvent(`{"type":"result","subtype":"success","is_error":false}`)
	if stdin.isClosed() {
		t.Fatal("an intermediate result closed the control input before the continuation")
	}
	asks := driver.ReadEvent(`{"type":"control_request","request_id":"continuation","request":{` +
		`"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"continued.md"}}}`)
	if len(asks) != 1 || asks[0].Kind != harnessapi.EventAsk {
		t.Fatalf("continuation events = %+v, want its permission request", asks)
	}
	if err := driver.Answer(asks[0].Ask.ID, harnessapi.AskDecision{Allow: true, Input: asks[0].Ask.Input}); err != nil {
		t.Fatalf("the continuation could not be approved: %v", err)
	}
	if frames := stdin.frames(t); len(frames) != 1 || frames[0]["type"] != "control_response" {
		t.Fatalf("stdin frames = %+v, want the continuation's control response", frames)
	}
}

func TestClaudeWithoutSessionStateFailsExplicitly(t *testing.T) {
	driver, stdin := newTranslator()
	events := driver.ReadEvent(`{"type":"result","is_error":false}`)
	if len(events) != 1 || events[0].Kind != harnessapi.EventFailure || !strings.Contains(events[0].Message, "Update Claude Code") {
		t.Fatalf("events = %+v, want an explicit unsupported CLI failure", events)
	}
	if !stdin.isClosed() || driver.terminal != "session_state_unavailable" {
		t.Fatalf("stdin closed = %v, terminal = %q; want the incompatible process stopped", stdin.isClosed(), driver.terminal)
	}
	if events := driver.ReadEvent(`{"type":"assistant","message":{"content":[{"type":"text","text":"too late"}]}}`); len(events) != 0 {
		t.Fatalf("output after protocol failure = %+v, want none", events)
	}
}

func TestClaudeWithoutSessionStateStopsAndReapsItsProcess(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "claude")
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"--version\" ]; then echo claude-fixture; exit 0; fi\n" +
		"read -r line\n" +
		`printf '%s\n' '{"type":"result","is_error":false}'` + "\n" +
		"read -r line\n"
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	driver := (&ClaudeHarness{Binary: binary}).Driver()
	if err := driver.Spawn(harnessapi.HarnessRun{WorkDir: dir, StoreRoot: dir, Prompt: "hello"}); err != nil {
		t.Fatal(err)
	}
	defer driver.Stop()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	var failed, done bool
	for {
		select {
		case event, ok := <-driver.Events():
			if !ok {
				if !failed || !done {
					t.Fatalf("failed = %v, done = %v; want an explicit failure and a reaped process", failed, done)
				}
				return
			}
			if event.Kind == harnessapi.EventFailure {
				failed = strings.Contains(event.Message, "Update Claude Code")
			}
			if event.Kind == harnessapi.EventDone {
				done = event.ExitCode == -1 && event.Terminal == "session_state_unavailable"
			}
		case <-deadline.C:
			t.Fatal("the incompatible CLI stayed alive after its result")
		}
	}
}

func TestClaudeClosesInputOnlyWhenResultAndIdleMeet(t *testing.T) {
	for _, states := range [][]string{
		{"running", "result", "idle"},
		{"running", "idle", "result"},
		{"idle", "running", "result", "requires_action", "running", "result", "idle"},
	} {
		t.Run(states[0]+"/"+states[1], func(t *testing.T) {
			driver, stdin := newTranslator()
			for i, state := range states {
				line := `{"type":"system","subtype":"session_state_changed","state":"` + state + `"}`
				if state == "result" {
					line = `{"type":"result","is_error":false}`
				}
				driver.ReadEvent(line)
				if want := i == len(states)-1; stdin.isClosed() != want {
					t.Fatalf("after %v: stdin closed = %v, want %v", states[:i+1], stdin.isClosed(), want)
				}
			}
			if err := driver.Say("too late"); err == nil {
				t.Fatal("a finished run still accepted a message")
			}
		})
	}
}
