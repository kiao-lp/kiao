package hybridflowrunner

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/http"
)

type Config = runnerconfig.Config
type Service = runnerhttp.Service

func Start(cfg *Config, registry agentapi.MCPRegistry) (*Service, error) {
	return runnerhttp.Start(cfg, registry)
}
