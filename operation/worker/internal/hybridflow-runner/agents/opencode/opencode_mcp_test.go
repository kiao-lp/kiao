package opencode

import (
	"encoding/json"
	"strings"
	"testing"
)

// The rendering is the `mcp` object of an OpenCode config document, because the turn carries it in
// OPENCODE_CONFIG_CONTENT.
func TestOpenCodeMCPRendersBothKindsOfServer(t *testing.T) {
	rendered := buildOpenCodeMCPConfig(mcpServersFixture())

	var document struct {
		MCP map[string]struct {
			Type        string            `json:"type"`
			Command     []string          `json:"command"`
			Environment map[string]string `json:"environment"`
			URL         string            `json:"url"`
			Headers     map[string]string `json:"headers"`
			Enabled     bool              `json:"enabled"`
		} `json:"mcp"`
	}
	if err := json.Unmarshal([]byte(rendered), &document); err != nil {
		t.Fatalf("rendered = %q, want a config document: %v", rendered, err)
	}
	files := document.MCP["kiao-files"]
	if files.Type != "local" {
		t.Errorf("kiao-files type = %q, want local", files.Type)
	}
	if len(files.Command) != 2 || files.Command[0] != "/usr/bin/node" {
		t.Errorf("kiao-files command = %q, want the command with its args", files.Command)
	}
	if files.Environment["WORKER_URL"] != "http://127.0.0.1:8080" {
		t.Errorf("kiao-files environment = %+v, want the plain values through", files.Environment)
	}
	if !files.Enabled {
		t.Error("kiao-files is not enabled")
	}
	fetch := document.MCP["fetch"]
	if fetch.Type != "remote" || fetch.URL != "https://example.test/mcp" {
		t.Errorf("fetch = %+v, want the remote endpoint", fetch)
	}
	if fetch.Headers["X-Api-Key"] != "secret" {
		t.Errorf("fetch headers = %+v, want the plain values through", fetch.Headers)
	}
	// A remote server has no command and a local one has no url: a written-empty field is a
	// server OpenCode would try to reach and fail at, where an absent key is one it ignores.
	if fetch.Command != nil || files.URL != "" {
		t.Errorf("rendered = %q, want empty fields left out rather than written empty", rendered)
	}
}

// The ledger's `${VAR}` becomes the `{env:VAR}` OpenCode expands from the turn's own environment.
// RenderMCP runs before the turn's token exists, so the reference — and not a value — is what
// travels; the driver is what sets the variable at spawn time.
func TestOpenCodeMCPTranslatesTheTokenPlaceholder(t *testing.T) {
	rendered := buildOpenCodeMCPConfig(mcpServersFixture())
	if strings.Contains(rendered, "${KIAO_MCP_TURN_TOKEN}") {
		t.Errorf("rendered = %q, want no ${...} surviving into the document", rendered)
	}
	if !strings.Contains(rendered, "{env:KIAO_MCP_TURN_TOKEN}") {
		t.Errorf("rendered = %q, want the token as an env substitution", rendered)
	}
	for _, tc := range []struct{ in, want string }{
		{"plain", "plain"},
		{"${TOKEN}", "{env:TOKEN}"},
		{"Bearer ${TOKEN} for ${OTHER}", "Bearer {env:TOKEN} for {env:OTHER}"},
		{"${}", "${}"},
		{"${UNCLOSED", "${UNCLOSED"},
	} {
		if got := opencodeEnvRef(tc.in); got != tc.want {
			t.Errorf("opencodeEnvRef(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// No servers is no document: the variable stays unset and the turn runs with the user's own
// configuration untouched.
func TestOpenCodeMCPWithNoServersIsNoDocument(t *testing.T) {
	if got := buildOpenCodeMCPConfig(nil); got != "" {
		t.Errorf("rendered = %q, want nothing for a turn with no servers", got)
	}
}
