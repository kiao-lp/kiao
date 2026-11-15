package runnerhttp

import (
	"kiao/worker/internal/core/equipment"
	pkgEquipment "kiao/worker/internal/core/equipment"
)

// mcpServersFixture is the ledger as the toolbox hands it over: one of ours, which calls this
// service back and therefore carries the turn-token placeholder, and one that reaches the open web.
func mcpServersFixture() []pkgEquipment.MCPServer {
	return []pkgEquipment.MCPServer{
		{
			Name: "kiao-files", Type: pkgEquipment.MCPStdio, Command: "/usr/bin/node",
			Args: []string{"/opt/kiao-mcp/dist/index.js"},
			Env: map[string]string{
				"WORKER_URL":            "http://127.0.0.1:8080",
				"KIAO_MCP_ACCESS_TOKEN": equipment.MCPTokenPlaceholder,
			},
		},
		{
			Name: "fetch", Type: pkgEquipment.MCPHTTP, URL: "https://example.test/mcp",
			Headers: map[string]string{"X-Api-Key": "secret"},
		},
	}
}
