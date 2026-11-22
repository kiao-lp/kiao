package muse

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

func TestMain(m *testing.M) {
	if os.Getenv("GO_WANT_MUSE_STUB") != "" {
		os.Exit(museStubMain())
	}
	os.Exit(m.Run())
}

// drainDriverEvents collects a turn to its end, or fails on a host that never ends it.
func drainDriverEvents(t *testing.T, driver harnessapi.HarnessDriver, timeout time.Duration) []harnessapi.HarnessEvent {
	t.Helper()
	var got []harnessapi.HarnessEvent
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

func mustWriteBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}
