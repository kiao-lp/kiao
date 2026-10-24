package claude

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

// stdinRecorder stands in for the CLI's stdin pipe and keeps the frames written to it.
type stdinRecorder struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	closed bool
}

// frames decodes the newline-delimited JSON written so far.
func (r *stdinRecorder) frames(t *testing.T) []map[string]any {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(r.buf.String()), "\n") {
		if line == "" {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			t.Fatalf("stdin frame %q is not JSON: %v", line, err)
		}
		out = append(out, frame)
	}
	return out
}

func (r *stdinRecorder) isClosed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

func (r *stdinRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.buf.Write(p)
}

func (r *stdinRecorder) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	return nil
}
