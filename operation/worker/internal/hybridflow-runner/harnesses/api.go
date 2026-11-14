package harnesses

import (
	"kiao/worker/internal/core/equipment"
)

// MCPRegistry is queried on each prompt so toolbox changes take effect without restart.
// Nil means no MCP config and all harnesses with an available binary.
type MCPRegistry interface {
	MCPServers() []equipment.MCPServer
	HarnessGate
}
