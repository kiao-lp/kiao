package hybridflowrunner

import (
	"encoding/json"
	"strings"
	"testing"

	"kiao/worker/internal/core"
)

// The rendering is the `mcp_servers` object of a settings.json: one entry per server, the stdio
// ones a command to start and the remote ones an endpoint to call.
func TestMuseMCPRendersBothKindsOfServer(t *testing.T) {
	fragment := buildMuseMCPConfig(mcpServersFixture())
	var servers map[string]map[string]any
	if err := json.Unmarshal([]byte(fragment), &servers); err != nil {
		t.Fatalf("fragment = %q, want a JSON object: %v", fragment, err)
	}
	files, ok := servers["kiao-files"]
	if !ok {
		t.Fatalf("fragment = %q, want the kiao-files server", fragment)
	}
	if files["transport"] != "stdio" || files["command"] != "/usr/bin/node" {
		t.Errorf("kiao-files = %v, want a stdio server started with node", files)
	}
	env, _ := files["env"].(map[string]any)
	if env["KIAO_MCP_ACCESS_TOKEN"] != museMCPPlaceholder {
		t.Errorf("kiao-files env = %v, want the token placeholder kept for the driver", env)
	}
	fetch, ok := servers["fetch"]
	if !ok {
		t.Fatalf("fragment = %q, want the fetch server", fragment)
	}
	if fetch["transport"] != "streamable_http" || fetch["url"] != "https://example.test/mcp" {
		t.Errorf("fetch = %v, want a streamable-HTTP server at its URL", fetch)
	}
	headers, _ := fetch["headers"].(map[string]any)
	if headers["X-Api-Key"] != "secret" {
		t.Errorf("fetch headers = %v, want the ledger's headers carried over", headers)
	}
	// A remote server has no command and a stdio one has no url: an empty value is a server Muse
	// would try to start and fail at, where an absent key is one it reads past.
	if _, has := fetch["command"]; has {
		t.Errorf("fetch = %v, want no command on a remote server", fetch)
	}
	if _, has := files["url"]; has {
		t.Errorf("kiao-files = %v, want no url on a stdio server", files)
	}
}

// No servers is no fragment at all, which runs the host with the user's own configuration
// untouched — the CLI the deployment configured by hand.
func TestMuseMCPWithNoServersIsNothing(t *testing.T) {
	if got := buildMuseMCPConfig(nil); got != "" {
		t.Errorf("fragment = %q, want nothing for a turn handed no servers", got)
	}
}

// A server without a name is not a server Muse could address, so it is left out rather than
// written under an empty key.
func TestMuseMCPSkipsNamelessServers(t *testing.T) {
	fragment := buildMuseMCPConfig([]core.MCPServer{{Type: core.MCPStdio, Command: "x"}})
	if fragment != "" {
		t.Errorf("fragment = %q, want nothing for a server with no name", fragment)
	}
}

// The turn token is substituted from the run, and every other placeholder from this process's
// environment — the two expansions Muse does not do itself. What is not set is left standing
// rather than emptied, and a bare `$` is nobody's placeholder.
func TestMuseMCPSubstitutesBothKindsOfCredential(t *testing.T) {
	t.Setenv("KIAO_TEST_MUSE_TOKEN", "from-env")
	fragment := `{"a":{"env":{"T":"${KIAO_MCP_TURN_TOKEN}","G":"Bearer ${KIAO_TEST_MUSE_TOKEN}","M":"${KIAO_TEST_MUSE_MISSING}","B":"price: $5"}}}`

	got := substituteMuseMCPPlaceholders(fragment, "turn-token")
	for _, want := range []string{
		`"T":"turn-token"`,
		`"G":"Bearer from-env"`,
		`"M":"${KIAO_TEST_MUSE_MISSING}"`,
		`"B":"price: $5"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("substituted = %q, want it to carry %s", got, want)
		}
	}
}
