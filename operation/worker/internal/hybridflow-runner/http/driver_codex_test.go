package runnerhttp

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	codexcli "kiao/worker/internal/hybridflow-runner/harnesses/codex"
	"testing"
)

// codexHarnessAt is the Codex harness pointed at a binary of the test's choosing — the same seam
// claudeAgentAt is, and for the same reason.
func codexHarnessAt(cfg *runnerconfig.Config, binary string) *codexcli.CodexHarness {
	harness := codexcli.NewCodexHarness(cfg)
	harness.Binary = binary
	harness.Login.Binary = binary
	harness.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"slug":"gpt-5.1-codex","display_name":"GPT-5.1 Codex",` +
			`"visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]}]}`), nil
	}
	return harness
}

func argsAfter(t *testing.T, args []string, flag string) []string {
	t.Helper()
	var values []string
	for i, arg := range args {
		if arg == flag && i+1 < len(args) {
			values = append(values, args[i+1])
		}
	}
	return values
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
