package runnerhttp

import (
	opencodecli "kiao/worker/internal/hybridflow-runner/agents/opencode"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
)

// opencodeAgentAt is the OpenCode agent pointed at a binary of the test's choosing — the same seam
// codexAgentAt is, and for the same reason.
func opencodeAgentAt(cfg *runnerconfig.Config, binary string) *opencodecli.OpencodeAgent {
	agent := &opencodecli.OpencodeAgent{Cfg: cfg, Binary: binary, OptionsService: opencodecli.NewOpenCodeOptionsService(cfg)}
	agent.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte("opencode/big-pickle\n"), nil
	}
	return agent
}
