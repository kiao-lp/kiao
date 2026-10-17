package hybridflowrunner

import (
	"errors"
	"testing"
)

// The reader's report starts nil and answers what the reader filed: a pipe that simply
// ended is nothing, and only a failure says so.
func TestMSPConnReadError(t *testing.T) {
	conn := &mspConn{}
	if err := conn.readError(); err != nil {
		t.Fatalf("readError = %v, want nil for a pipe that simply ended", err)
	}
	conn.readErr = errors.New("bufio.Scanner: token too long")
	if err := conn.readError(); err == nil || err.Error() != "bufio.Scanner: token too long" {
		t.Fatalf("readError = %v, want the scanner's error", err)
	}
}
