package runnerhttp

import (
	codexcli "kiao/worker/internal/hybridflow-runner/agents/codex"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"testing"
)

// codexAgentAt is the Codex agent pointed at a binary of the test's choosing — the same seam
// claudeAgentAt is, and for the same reason.
func codexAgentAt(cfg *runnerconfig.Config, binary string) *codexcli.CodexAgent {
	agent := codexcli.NewCodexAgent(cfg)
	agent.Binary = binary
	agent.Login.Binary = binary
	agent.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte(`{"models":[{"slug":"gpt-5.1-codex","display_name":"GPT-5.1 Codex",` +
			`"visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]}]}`), nil
	}
	return agent
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
