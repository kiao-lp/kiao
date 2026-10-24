package opencode

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// stubHostBinary writes a stand-in CLI beside the files its script reads or records.
// The protocol and the script stay with each driver's test.
func stubHostBinary(t *testing.T, dir, name, script string) string {
	t.Helper()
	binary := filepath.Join(dir, name)
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatalf("write the stub host: %v", err)
	}
	return binary
}

// drainDriverEvents collects a turn to its end, or fails on a host that never ends it.
func drainDriverEvents(t *testing.T, driver agentapi.AgentDriver, timeout time.Duration) []agentapi.AgentEvent {
	t.Helper()
	var got []agentapi.AgentEvent
	done := make(chan struct{})
	go func() {
		defer close(done)
		for event := range driver.Events() {
			got = append(got, event)
		}
	}()
	select {
	case <-done:
		return got
	case <-time.After(timeout):
		t.Fatal("the turn never ended")
		return nil
	}
}
