package toolbox

import (
	"kiao/worker/internal/core/equipment"
	toolconfig "kiao/worker/internal/toolbox/config"
	"kiao/worker/internal/toolbox/install"
)

type Config = toolconfig.Config
type Service = install.Service

func Start(cfg *Config, bundled map[string]equipment.MCPServer, seed []string) (*Service, error) {
	return install.Start(cfg, bundled, seed)
}
