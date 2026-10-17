package hybridflowrunner

import (
	"os"
	"testing"
)

// The suite runs as if both agent CLIs were installed.
//
// Which agents a deployment offers now depends on what is on the machine's PATH (agents.go,
// `offers`), and a suite that read the real one would pass or fail on whether the developer running
// it happens to have a `claude` — the very dependency driver_stub_test.go was written to remove.
// So the question is answered yes for the whole package, and the handful of tests that are *about*
// that question say otherwise for their own duration with `withCLIsOnPath`.
func TestMain(m *testing.M) {
	if RunAgentProcessSupervisor() {
		return
	}
	if dir := os.Getenv("GO_WANT_CODEX_OWNER"); dir != "" {
		os.Exit(codexOwnerMain(dir))
	}
	if os.Getenv("GO_WANT_MUSE_STUB") != "" {
		os.Exit(museStubMain())
	}
	cliOnPath = func(string) bool { return true }
	os.Exit(m.Run())
}

// withCLIsOnPath makes only the named CLIs findable, for a test about what a machine offers.
func withCLIsOnPath(t *testing.T, binaries ...string) {
	t.Helper()
	previous := cliOnPath
	t.Cleanup(func() { cliOnPath = previous })
	cliOnPath = func(binary string) bool {
		for _, candidate := range binaries {
			if candidate == binary {
				return true
			}
		}
		return false
	}
}
