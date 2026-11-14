package runnerhttp

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	opencodecli "kiao/worker/internal/hybridflow-runner/harnesses/opencode"
)

// opencodeHarnessAt is the OpenCode harness pointed at a binary of the test's choosing — the same seam
// codexHarnessAt is, and for the same reason.
func opencodeHarnessAt(cfg *runnerconfig.Config, binary string) *opencodecli.OpencodeHarness {
	harness := &opencodecli.OpencodeHarness{Cfg: cfg, Binary: binary, OptionsService: opencodecli.NewOpenCodeOptionsService(cfg)}
	harness.OptionsService.Catalogue = func() ([]byte, error) {
		return []byte("opencode/big-pickle\n"), nil
	}
	return harness
}
