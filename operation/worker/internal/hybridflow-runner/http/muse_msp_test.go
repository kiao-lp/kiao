package runnerhttp

import (
	"errors"
	musecli "kiao/worker/internal/hybridflow-runner/agents/muse"
	"testing"
)

// The reader's report starts nil and answers what the reader filed: a pipe that simply
// ended is nothing, and only a failure says so.
func TestMSPConnReadError(t *testing.T) {
	conn := &musecli.MspConn{}
	if err := conn.ReadError(); err != nil {
		t.Fatalf("readError = %v, want nil for a pipe that simply ended", err)
	}
	conn.ReadErr = errors.New("bufio.Scanner: token too long")
	if err := conn.ReadError(); err == nil || err.Error() != "bufio.Scanner: token too long" {
		t.Fatalf("readError = %v, want the scanner's error", err)
	}
}
