package hybridflowrunner

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"kiao/worker/internal/hybridflow-runner/http"
)

type Config = runnerconfig.Config
type Service = runnerhttp.Service

func Start(cfg *Config, registry harnessapi.MCPRegistry) (*Service, error) {
	return runnerhttp.Start(cfg, registry)
}
