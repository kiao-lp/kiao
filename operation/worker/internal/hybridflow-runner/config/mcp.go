package config

import (
	"fmt"
	"kiao/worker/internal/core/equipment"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// mcpEntrypoints maps KIAO_WORKER_MCP_SERVERS names (also used by bundled toolbox recipes)
// to server names and bundle scripts.
var mcpEntrypoints = map[string]struct {
	server string
	script string
}{
	// files_rename repairs links unlike a plain mv; the CLI already has direct file access.
	"files": {server: "kiao-files", script: "index.js"},
	// units and cv require deployment-provided overlays; missing scripts fail startup.
	"units":      {server: "kiao-units", script: "units-entry.js"},
	"cv":         {server: "kiao-cv", script: "cv-entry.js"},
	"hybridflow": {server: "kiao-hybridflow", script: "hybridflow-entry.js"},
}

// mcpServerNames preserves order and unknown names so validation can report configuration errors.
func mcpServerNames(csv string) []string {
	var names []string
	seen := map[string]bool{}
	for _, name := range strings.Split(csv, ",") {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

// BundledMCPServers describes the staged bundle for the toolbox without coupling the libraries.
// No staged bundle means no available bundled servers.
// The CLI expands ${KIAO_MCP_TURN_TOKEN} from its per-turn environment when launching servers;
// the credential itself must never enter the config file or process arguments.
func BundledMCPServers(cfg *Config) (map[string]equipment.MCPServer, error) {
	if strings.TrimSpace(cfg.MCPPath) == "" {
		return nil, nil
	}
	filesURL := "http://127.0.0.1:" + strings.TrimPrefix(strings.TrimSpace(cfg.Port), ":")

	servers := map[string]equipment.MCPServer{}
	for _, name := range mcpServerNames(cfg.MCPServers) {
		entry, ok := mcpEntrypoints[name]
		if !ok {
			return nil, fmt.Errorf("unknown MCP server %q; known: %s", name, knownMCPServers())
		}
		script := filepath.Join(cfg.MCPPath, "dist", entry.script)
		if _, err := os.Stat(script); err != nil {
			return nil, fmt.Errorf("MCP server %q: %s is not readable; is the kiao-mcp bundle built and staged?", name, script)
		}
		servers[name] = equipment.MCPServer{
			Name:    entry.server,
			Type:    equipment.MCPStdio,
			Command: cfg.NodeBinary,
			Args:    []string{script},
			Env: map[string]string{
				"WORKER_URL":            filesURL,
				"KIAO_MCP_ACCESS_TOKEN": "${KIAO_MCP_TURN_TOKEN}",
			},
		}
	}
	if len(servers) == 0 {
		return nil, fmt.Errorf("KIAO_WORKER_MCP_PATH is set but KIAO_WORKER_MCP_SERVERS names no server")
	}
	return servers, nil
}

// ConfiguredMCPServers seeds the toolbox ledger from KIAO_WORKER_MCP_SERVERS.
// Once the ledger exists, it is authoritative.
func ConfiguredMCPServers(cfg *Config) []string {
	if strings.TrimSpace(cfg.MCPPath) == "" {
		return nil
	}
	return mcpServerNames(cfg.MCPServers)
}

func knownMCPServers() string {
	names := make([]string, 0, len(mcpEntrypoints))
	for name := range mcpEntrypoints {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}
