package hybridflowrunner

import (
	"encoding/json"
	"sort"
	"strings"

	"kiao/worker/internal/core"
)

// The MCP servers an OpenCode turn is handed — the fourth rendering of the one ledger.
//
// **Which** servers a turn gets is the toolbox's answer and nobody else's: it hands over
// []core.MCPServer through the port in api.go, and every agent is given the same list. **How**
// they are said is per agent, and this is the OpenCode half of it. The Claude half writes a JSON
// document and passes its path with --mcp-config; Codex has no such flag, so the whole table
// travels as one TOML inline table on a `-c` override; OpenCode reads an `mcp` object out of its
// JSON configuration, so the document travels in the environment instead —
// `OPENCODE_CONFIG_CONTENT`, which the CLI merges over every other configuration source, and
// which no turn handed no servers sets at all.
//
// ── the credential, and why it is where Claude's is ───────────────────────────
//
// The rendering writes `{env:KIAO_MCP_TURN_TOKEN}` where the ledger's environment carries
// `${KIAO_MCP_TURN_TOKEN}`, and the CLI substitutes it from its own process environment when it
// loads the configuration. The credential therefore never lands in a file and never appears in
// `ps` — the Claude arrangement, in OpenCode's spelling.

// opencodeMCPServer is one server as the `mcp` object spells it: a process the CLI starts, or an
// endpoint it calls.
type opencodeMCPServer struct {
	Type        string            `json:"type"`
	Command     []string          `json:"command,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
	URL         string            `json:"url,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	Enabled     bool              `json:"enabled"`
}

// buildOpenCodeMCPConfig renders the servers as the config document the turn's environment
// carries, or "" for a turn with no servers at all — which is a turn spawned with the variable
// unset, and therefore exactly the CLI the deployment configured by hand.
func buildOpenCodeMCPConfig(servers []core.MCPServer) string {
	if len(servers) == 0 {
		return ""
	}
	sorted := append([]core.MCPServer(nil), servers...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	entries := make(map[string]opencodeMCPServer, len(sorted))
	for _, server := range sorted {
		entries[server.Name] = opencodeMCPEntry(server)
	}
	raw, err := json.Marshal(map[string]any{"mcp": entries})
	if err != nil {
		return ""
	}
	return string(raw)
}

// opencodeMCPEntry is one server as OpenCode spells it. The two kinds are the two ways it can reach
// one, and they share no field: a local server is a process it starts, a remote one an endpoint it
// calls. Anything the ledger left empty is left out rather than written as an empty value — a
// command of `[""]` is a server OpenCode would try to start and fail at, where an absent key is a
// server it ignores.
func opencodeMCPEntry(server core.MCPServer) opencodeMCPServer {
	entry := opencodeMCPServer{Enabled: true}
	if server.Type == core.MCPHTTP {
		entry.Type = "remote"
		entry.URL = strings.TrimSpace(server.URL)
		if len(server.Headers) > 0 {
			entry.Headers = opencodeEnvRefs(server.Headers)
		}
		return entry
	}
	entry.Type = "local"
	if command := strings.TrimSpace(server.Command); command != "" {
		entry.Command = append([]string{command}, server.Args...)
	}
	if len(server.Env) > 0 {
		entry.Environment = opencodeEnvRefs(server.Env)
	}
	return entry
}

// opencodeEnvRefs translates the ledger's `${VAR}` references into the `{env:VAR}` substitutions
// OpenCode expands when it loads the configuration. Anything else passes through unchanged.
func opencodeEnvRefs(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = opencodeEnvRef(value)
	}
	return out
}

func opencodeEnvRef(value string) string {
	var b strings.Builder
	for {
		start := strings.Index(value, "${")
		if start < 0 {
			b.WriteString(value)
			return b.String()
		}
		b.WriteString(value[:start])
		rest := value[start+2:]
		end := strings.Index(rest, "}")
		if end < 0 {
			b.WriteString(value[start:])
			return b.String()
		}
		name := strings.TrimSpace(rest[:end])
		if name == "" {
			b.WriteString(value[start : start+2+end+1])
		} else {
			b.WriteString("{env:" + name + "}")
		}
		value = rest[end+1:]
	}
}
