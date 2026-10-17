package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A named log file gets every line stdout gets, appended rather than truncated — and nothing
// else changes about the log.
func TestInitLogFileMirrorsStdout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "svc.log")
	t.Setenv("KIAO_WORKER_LOG_FILE", path)
	defer logSink.set(os.Stdout)
	InitLogFile()
	Logger.Info("the mirrored line", "marker", "mirror-me")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("log file: %v", err)
	}
	if !strings.Contains(string(content), "mirror-me") {
		t.Errorf("log file = %q, want the line stdout got", content)
	}
	if mode, err := os.Stat(path); err != nil || mode.Mode().Perm() != 0o600 {
		t.Errorf("log file mode = %v, want 0600", mode.Mode())
	}
}

// A file that cannot be opened is a warning, never a breakage: the sink keeps whatever it had,
// and the service keeps serving.
func TestInitLogFileFailureKeepsTheSink(t *testing.T) {
	first := filepath.Join(t.TempDir(), "first.log")
	t.Setenv("KIAO_WORKER_LOG_FILE", first)
	defer logSink.set(os.Stdout)
	InitLogFile()
	Logger.Info("before", "marker", "line-one")
	t.Setenv("KIAO_WORKER_LOG_FILE", filepath.Join(t.TempDir(), "no-such-dir", "x.log"))
	InitLogFile()
	Logger.Info("after", "marker", "line-two")
	content, err := os.ReadFile(first)
	if err != nil {
		t.Fatalf("log file: %v", err)
	}
	if !strings.Contains(string(content), "line-one") || !strings.Contains(string(content), "line-two") {
		t.Errorf("log file = %q, want both lines on the sink a failed attach did not break", content)
	}
}

// Unset, attaching is a no-op: the sink stays stdout alone.
func TestInitLogFileUnsetIsStdoutAlone(t *testing.T) {
	t.Setenv("KIAO_WORKER_LOG_FILE", "")
	InitLogFile()
	logSink.mu.Lock()
	defer logSink.mu.Unlock()
	if logSink.w != os.Stdout {
		t.Errorf("sink = %T, want stdout alone", logSink.w)
	}
}
