package turns

import (
	"kiao/worker/internal/core/equipment"
)

func (h *Engine) mcpServers() []equipment.MCPServer {
	if h.Registry == nil {
		return nil
	}
	return h.Registry.MCPServers()
}

// needsTurnToken grants callback credentials only to bundled servers, not third-party servers.
func (h *Engine) NeedsTurnToken(servers []equipment.MCPServer) bool {
	for _, server := range servers {
		if h.BundledNames[server.Name] {
			return true
		}
	}
	return false
}
