package codex

import (
	"kiao/worker/internal/core/equipment"
	pkgEquipment "kiao/worker/internal/core/equipment"
	"strings"
	"testing"
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

// The rendering is the whole `mcp_servers` table as one TOML inline table, because this CLI has no
// --mcp-config to point at a file with.
func TestCodexMCPRendersBothKindsOfServer(t *testing.T) {
	table := buildCodexMCPConfig(mcpServersFixture())

	if !strings.HasPrefix(table, "{ ") || !strings.HasSuffix(table, " }") {
		t.Fatalf("table = %q, want one inline table", table)
	}
	// Name order, so that two identical turns produce two identical argument lists: `fetch` before
	// `kiao-files` whatever order the toolbox happened to answer in.
	if strings.Index(table, "fetch") > strings.Index(table, "kiao-files") {
		t.Errorf("table = %q, want the servers in name order", table)
	}
	for _, want := range []string{
		`command = "/usr/bin/node"`,
		`args = ["/opt/kiao-mcp/dist/index.js"]`,
		`url = "https://example.test/mcp"`,
		`http_headers = { X-Api-Key = "secret" }`,
	} {
		if !strings.Contains(table, want) {
			t.Errorf("table = %q, want it to carry %s", table, want)
		}
	}
	// A remote server has no command and a stdio one has no url: a `command = ""` is a server Codex
	// would try to start and fail at, where an absent key is one it ignores.
	if strings.Contains(table, `command = ""`) || strings.Contains(table, `url = ""`) {
		t.Errorf("table = %q, want empty fields left out rather than written empty", table)
	}
}

// The placeholder is left standing by the rendering. It has to be: RenderMCP runs before the turn's
// token exists, and the driver is what substitutes it at spawn time.
func TestCodexMCPLeavesTheTokenPlaceholderToTheDriver(t *testing.T) {
	table := buildCodexMCPConfig(mcpServersFixture())
	if !strings.Contains(table, equipment.MCPTokenPlaceholder) {
		t.Errorf("table = %q, want the placeholder kept for the driver to substitute", table)
	}
}

// No servers is no override at all, which spawns exactly the CLI the deployment configured by hand.
func TestCodexMCPWithNoServersIsNoOverride(t *testing.T) {
	if got := buildCodexMCPConfig(nil); got != "" {
		t.Errorf("table = %q, want nothing for a turn handed no servers", got)
	}
}

// A value from the toolbox is not this service's to promise anything about, so it is escaped rather
// than trusted: an unescaped quote would end the string early and the whole override would parse as
// something else.
func TestCodexMCPEscapesWhatItIsGiven(t *testing.T) {
	table := buildCodexMCPConfig([]pkgEquipment.MCPServer{{
		Name: "odd name.v2", Type: pkgEquipment.MCPStdio, Command: `C:\tools\node.exe`,
		Env: map[string]string{"GREETING": "he said \"hi\"\nthen left"},
	}})
	for _, want := range []string{
		`"odd name.v2" = {`,
		`command = "C:\\tools\\node.exe"`,
		`"he said \"hi\"\nthen left"`,
	} {
		if !strings.Contains(table, want) {
			t.Errorf("table = %q, want it to carry %s", table, want)
		}
	}
}

// A control character has no place in a TOML basic string raw: it is a parse error rather than a
// curiosity, so it goes out as an escape.
func TestTomlStringEscapesControlCharacters(t *testing.T) {
	if got := tomlString("a\x01b"); got != `"a\u0001b"` {
		t.Errorf("tomlString = %q, want the control character escaped", got)
	}
}

// A bare key is left bare — a dash is legal in one, and `kiao-files` is what the model sees the
// server as — and anything outside that alphabet is quoted.
func TestTomlKeyQuotesOnlyWhatItMust(t *testing.T) {
	if got := tomlKey("kiao-files"); got != "kiao-files" {
		t.Errorf("tomlKey = %q, want a bare key left bare", got)
	}
	if got := tomlKey("has space"); got != `"has space"` {
		t.Errorf("tomlKey = %q, want a quoted key", got)
	}
}
