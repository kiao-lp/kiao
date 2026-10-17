package hybridflowrunner

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kiao/worker/internal/core"
)

// The toolbox selects MCP servers; this file describes bundled servers and serializes
// the CLI config per turn so registry changes need no restart.
type mcpServerEntry struct {
	Type    string            `json:"type"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

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
func BundledMCPServers(cfg *Config) (map[string]core.MCPServer, error) {
	if strings.TrimSpace(cfg.MCPPath) == "" {
		return nil, nil
	}
	filesURL := "http://127.0.0.1:" + strings.TrimPrefix(strings.TrimSpace(cfg.Port), ":")

	servers := map[string]core.MCPServer{}
	for _, name := range mcpServerNames(cfg.MCPServers) {
		entry, ok := mcpEntrypoints[name]
		if !ok {
			return nil, fmt.Errorf("unknown MCP server %q; known: %s", name, knownMCPServers())
		}
		script := filepath.Join(cfg.MCPPath, "dist", entry.script)
		if _, err := os.Stat(script); err != nil {
			return nil, fmt.Errorf("MCP server %q: %s is not readable; is the kiao-mcp bundle built and staged?", name, script)
		}
		servers[name] = core.MCPServer{
			Name:    entry.server,
			Type:    core.MCPStdio,
			Command: cfg.NodeBinary,
			Args:    []string{script},
			Env: map[string]string{
				"WORKER_URL":     filesURL,
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

func buildMCPConfig(servers []core.MCPServer) map[string]any {
	entries := map[string]mcpServerEntry{}
	for _, server := range servers {
		entries[server.Name] = mcpServerEntry{
			Type:    server.Type,
			Command: server.Command,
			Args:    server.Args,
			URL:     server.URL,
			Headers: server.Headers,
			Env:     server.Env,
		}
	}
	return map[string]any{"mcpServers": entries}
}

// mcpConfigDir keeps generated configs in service state, outside content listings and source control.
func mcpConfigDir(cfg *Config) string {
	return filepath.Join(cfg.StatePath, "mcp")
}

const legacyMCPConfigDirName = "claude-mcp"

// sweepMCPConfigs discards generated configs at startup so moved binaries or ports cannot persist.
func sweepMCPConfigs(cfg *Config) {
	_ = os.RemoveAll(filepath.Join(cfg.StatePath, legacyMCPConfigDirName))
	dir := mcpConfigDir(cfg)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		_ = os.Remove(filepath.Join(dir, entry.Name()))
	}
}

// writeMCPConfig returns the --mcp-config path, or empty for no servers.
// Content-addressed files are reused across turns; registry changes take effect on the next turn.
func writeMCPConfig(cfg *Config, servers []core.MCPServer) (string, error) {
	if len(servers) == 0 {
		return "", nil
	}
	body, err := json.MarshalIndent(buildMCPConfig(servers), "", "  ")
	if err != nil {
		return "", fmt.Errorf("cannot encode the MCP configuration: %w", err)
	}
	body = append(body, '\n')

	digest := sha256.Sum256(body)
	dir := mcpConfigDir(cfg)
	path := filepath.Join(dir, hex.EncodeToString(digest[:8])+".json")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", dir, err)
	}
	if err := core.WriteFileAtomic(path, body, 0o600); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", path, err)
	}
	return path, nil
}

func (h *ClaudeHub) mcpServers() []core.MCPServer {
	if h.registry == nil {
		return nil
	}
	return h.registry.MCPServers()
}

// needsTurnToken grants callback credentials only to bundled servers, not third-party servers.
func (h *ClaudeHub) needsTurnToken(servers []core.MCPServer) bool {
	for _, server := range servers {
		if h.bundledNames[server.Name] {
			return true
		}
	}
	return false
}
