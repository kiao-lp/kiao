package opencode

import (
	"encoding/json"
	"kiao/worker/internal/core/equipment"
	"sort"
	"strings"
)

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
func buildOpenCodeMCPConfig(servers []equipment.MCPServer) string {
	if len(servers) == 0 {
		return ""
	}
	sorted := append([]equipment.MCPServer(nil), servers...)
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
func opencodeMCPEntry(server equipment.MCPServer) opencodeMCPServer {
	entry := opencodeMCPServer{Enabled: true}
	if server.Type == equipment.MCPHTTP {
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
