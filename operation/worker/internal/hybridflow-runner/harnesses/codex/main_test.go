package codex

import (
	pkgProcess "kiao/worker/internal/core/process"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	if pkgProcess.RunHarnessProcessSupervisor() {
		return
	}
	os.Exit(m.Run())
}
