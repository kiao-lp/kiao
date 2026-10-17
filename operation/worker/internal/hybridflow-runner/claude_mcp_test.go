package hybridflowrunner

import (
	"encoding/json"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// stageMCPBundle writes the dist/ layout BundledMCPServers expects, so a test exercises the real
// stat check instead of a path that happens to exist.
func stageMCPBundle(t *testing.T, scripts ...string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "dist"), 0o755); err != nil {
		t.Fatalf("cannot stage the bundle: %v", err)
	}
	for _, script := range scripts {
		if err := os.WriteFile(filepath.Join(dir, "dist", script), []byte("// stub\n"), 0o644); err != nil {
			t.Fatalf("cannot stage %s: %v", script, err)
		}
	}
	return dir
}

// TestBundledMCPServers pins what the staged bundle offers — above all that the credential is not a
// value in it. The token differs per turn, so a literal one here would be both wrong and a secret
// at rest.
func TestBundledMCPServers(t *testing.T) {
	bundle := stageMCPBundle(t, "index.js", "units-entry.js", "cv-entry.js", "hybridflow-entry.js")
	cfg := &Config{Config: &core.Config{Port: "18080", NodeBinary: "node"}, MCPPath: bundle, MCPServers: "units,cv"}

	servers, err := BundledMCPServers(cfg)
	if err != nil {
		t.Fatalf("BundledMCPServers: %v", err)
	}
	if len(servers) != 2 {
		t.Fatalf("servers = %v, want units and cv", servers)
	}
	units, ok := servers["units"]
	if !ok {
		t.Fatalf("servers = %v, want a units entry", servers)
	}
	if units.Name != "kiao-units" {
		t.Errorf("units is declared as %q, want kiao-units", units.Name)
	}
	if units.Command != "node" || units.Args[0] != filepath.Join(bundle, "dist", "units-entry.js") {
		t.Errorf("kiao-units runs %q %v, want node on the staged bundle", units.Command, units.Args)
	}
	// The loopback address, not the public one: the point of the in-service deployment is that the
	// turn edits the store this very process serves.
	if units.Env["WORKER_URL"] != "http://127.0.0.1:18080" {
		t.Errorf("WORKER_URL = %q, want this service on loopback", units.Env["WORKER_URL"])
	}
	if units.Env["KIAO_MCP_ACCESS_TOKEN"] != "${KIAO_MCP_TURN_TOKEN}" {
		t.Errorf("KIAO_MCP_ACCESS_TOKEN = %q, want the env reference the CLI expands per turn",
			units.Env["KIAO_MCP_ACCESS_TOKEN"])
	}

	// files is available but off by default — the CLI's own tools already reach the store.
	if _, ok := servers["files"]; ok {
		t.Errorf("files must not be offered unless it is asked for")
	}
	withFiles, err := BundledMCPServers(&Config{
		Config: &core.Config{Port: "18080", NodeBinary: "node"}, MCPPath: bundle, MCPServers: "files"})
	if err != nil {
		t.Fatalf("BundledMCPServers(files): %v", err)
	}
	if withFiles["files"].Name != "kiao-files" {
		t.Errorf("naming files must offer kiao-files, got %v", withFiles)
	}

	// hybridflow is available but off by default, like files: a turn that is not about a
	// board carries no board tools.
	if _, ok := servers["hybridflow"]; ok {
		t.Errorf("hybridflow must not be offered unless it is asked for")
	}
	withHybridflow, err := BundledMCPServers(&Config{
		Config: &core.Config{Port: "18080", NodeBinary: "node"}, MCPPath: bundle, MCPServers: "hybridflow"})
	if err != nil {
		t.Fatalf("BundledMCPServers(hybridflow): %v", err)
	}
	if withHybridflow["hybridflow"].Name != "kiao-hybridflow" {
		t.Errorf("naming hybridflow must offer kiao-hybridflow, got %v", withHybridflow)
	}

	// No bundle staged is the default, and it is not an error: the panel then shows those rows as
	// unavailable and a turn gets whatever else is registered.
	none, err := BundledMCPServers(&Config{Config: &core.Config{Port: "18080"}})
	if err != nil || len(none) != 0 {
		t.Errorf("BundledMCPServers(no bundle) = %v, %v; want nothing offered and no error", none, err)
	}
}

// TestBundledMCPServersRefusals: each of these reaches the operator at startup through
// Config.Validate, instead of reaching the user as a turn whose tools are quietly missing.
func TestBundledMCPServersRefusals(t *testing.T) {
	bundle := stageMCPBundle(t, "units-entry.js")

	if _, err := BundledMCPServers(&Config{Config: &core.Config{Port: "18080"}, MCPPath: bundle, MCPServers: "units,knowledge"}); err == nil {
		t.Errorf("an unknown server name must be refused, not dropped")
	}
	if _, err := BundledMCPServers(&Config{Config: &core.Config{Port: "18080"}, MCPPath: bundle, MCPServers: "units,cv"}); err == nil {
		t.Errorf("a server whose entrypoint is not staged must be refused")
	}
	if _, err := BundledMCPServers(&Config{Config: &core.Config{Port: "18080"}, MCPPath: bundle, MCPServers: " , "}); err == nil {
		t.Errorf("a bundle configured with no server must be refused")
	}
}

// TestBuildMCPConfig pins the document's shape for the two kinds of server a turn can be handed:
// a process the CLI starts, and an endpoint it calls.
func TestBuildMCPConfig(t *testing.T) {
	doc := buildMCPConfig([]core.MCPServer{
		{Name: "fetch", Type: core.MCPStdio, Command: "/toolbox/bin/mcp-server-fetch"},
		{Name: "github", Type: core.MCPHTTP, URL: "https://api.githubcopilot.com/mcp/",
			Headers: map[string]string{"Authorization": "Bearer ${GITHUB_TOKEN}"}},
	})
	servers, _ := doc["mcpServers"].(map[string]mcpServerEntry)
	if len(servers) != 2 {
		t.Fatalf("servers = %v, want both", servers)
	}
	if servers["fetch"].Command != "/toolbox/bin/mcp-server-fetch" || servers["fetch"].Type != "stdio" {
		t.Errorf("fetch = %+v, want the absolute command the toolbox resolved", servers["fetch"])
	}
	if servers["github"].URL != "https://api.githubcopilot.com/mcp/" {
		t.Errorf("github = %+v, want the endpoint", servers["github"])
	}
	// The credential is an env reference the CLI expands, never a value: a secret written here
	// would be a secret at rest in the state directory.
	if servers["github"].Headers["Authorization"] != "Bearer ${GITHUB_TOKEN}" {
		t.Errorf("github headers = %v, want the env reference", servers["github"].Headers)
	}
}

// TestWriteMCPConfig covers the default — off — the file the flag points at, and the property that
// makes writing it on the spawn path cheap: the same set of servers is the same file.
func TestWriteMCPConfig(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}}

	if path, err := writeMCPConfig(cfg, nil); err != nil || path != "" {
		t.Errorf("writeMCPConfig(nothing registered) = %q, %v; want it off", path, err)
	}

	servers := []core.MCPServer{{Name: "kiao-units", Type: core.MCPStdio, Command: "node", Args: []string{"/bundle/units-entry.js"}}}
	path, err := writeMCPConfig(cfg, servers)
	if err != nil {
		t.Fatalf("writeMCPConfig: %v", err)
	}
	if !strings.HasPrefix(path, filepath.Join(cfg.StatePath, "mcp")) {
		t.Errorf("path = %q, want it in the state directory, not in the store", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600", info.Mode().Perm())
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var parsed map[string]map[string]map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("the generated configuration is not valid JSON: %v", err)
	}
	if len(parsed["mcpServers"]) != 1 {
		t.Errorf("generated servers = %v, want one", parsed["mcpServers"])
	}

	// The same set answers the same path — which is what makes this callable per turn — and a
	// changed set answers a different one, so a turn is never handed a document describing a set
	// the panel has since changed.
	again, err := writeMCPConfig(cfg, servers)
	if err != nil || again != path {
		t.Errorf("writeMCPConfig(same servers) = %q, %v; want the same file", again, err)
	}
	changed, err := writeMCPConfig(cfg, append(servers, core.MCPServer{Name: "fetch", Type: core.MCPStdio, Command: "/bin/fetch"}))
	if err != nil || changed == path {
		t.Errorf("writeMCPConfig(a different set) = %q, %v; want a file of its own", changed, err)
	}

	// And a restart throws them all away, because each one names paths and a port that move with a
	// deployment.
	sweepMCPConfigs(cfg)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("the generated configurations must not survive a restart")
	}
}

// TestSweepMCPConfigsRemovesLegacyDir: the directory was claude-mcp before it became mcp, and a
// deployment that ran the old name still carries it with its stale generated files. Startup removes
// it whole — like the new directory, everything in there was written per turn and is worth nothing
// across a restart.
func TestSweepMCPConfigsRemovesLegacyDir(t *testing.T) {
	cfg := &Config{Config: &core.Config{StatePath: t.TempDir()}}
	legacy := filepath.Join(cfg.StatePath, "claude-mcp")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatalf("cannot stage the legacy directory: %v", err)
	}
	stale := filepath.Join(legacy, "deadbeef.json")
	if err := os.WriteFile(stale, []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("cannot stage a stale configuration: %v", err)
	}
	sweepMCPConfigs(cfg)
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Errorf("the legacy directory is still there after a sweep")
	}
}

// TestClaudeArgsMCP pins that the two flags travel together and only when configured. Handing the
// CLI --mcp-config without --strict-mcp-config would also load whatever <HOME>/.claude.json holds,
// which on a server deployment is state a turn can write; omitting both is what leaves the
// developer's own registered servers alone when nothing is registered here.
func TestClaudeArgsMCP(t *testing.T) {
	base := claudeRun{model: "opus", effort: "high", permissionMode: permissionModeManual}

	if got := strings.Join(claudeArgs(base), " "); strings.Contains(got, "--mcp-config") ||
		strings.Contains(got, "--strict-mcp-config") {
		t.Errorf("args = %q, want no MCP flags when none is configured", got)
	}

	configured := base
	configured.mcpConfigPath = "/state/mcp/abc.json"
	got := strings.Join(claudeArgs(configured), " ")
	if !strings.Contains(got, "--mcp-config /state/mcp/abc.json") {
		t.Errorf("args = %q, want the generated configuration", got)
	}
	if !strings.Contains(got, "--strict-mcp-config") {
		t.Errorf("args = %q, want the turn held to the service's servers alone", got)
	}
}

// TestNeedsTurnToken: the credential exists for the servers that call this service back, and a
// fetcher that reaches the open web is handed nothing.
func TestNeedsTurnToken(t *testing.T) {
	hub := &ClaudeHub{bundledNames: map[string]bool{"kiao-units": true, "kiao-cv": true}}

	if hub.needsTurnToken([]core.MCPServer{{Name: "fetch"}, {Name: "duckduckgo"}}) {
		t.Errorf("a turn with only third-party servers must not be issued a store credential")
	}
	if !hub.needsTurnToken([]core.MCPServer{{Name: "fetch"}, {Name: "kiao-units"}}) {
		t.Errorf("a turn holding a kiao-mcp server needs the credential it calls back with")
	}
	if hub.needsTurnToken(nil) {
		t.Errorf("a turn with no servers needs no credential")
	}
}
