package claude

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/filesystem"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"path/filepath"
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

func buildMCPConfig(servers []equipment.MCPServer) map[string]any {
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
func mcpConfigDir(cfg *runnerconfig.Config) string {
	return filepath.Join(cfg.StatePath, "mcp")
}

const legacyMCPConfigDirName = "claude-mcp"

// sweepMCPConfigs discards generated configs at startup so moved binaries or ports cannot persist.
func SweepMCPConfigs(cfg *runnerconfig.Config) {
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
func writeMCPConfig(cfg *runnerconfig.Config, servers []equipment.MCPServer) (string, error) {
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
	if err := filesystem.WriteFileAtomic(path, body, 0o600); err != nil {
		return "", fmt.Errorf("cannot write %s: %w", path, err)
	}
	return path, nil
}
