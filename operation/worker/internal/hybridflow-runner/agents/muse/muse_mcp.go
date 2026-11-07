package muse

import (
	"encoding/json"
	"kiao/worker/internal/core/equipment"
	"os"
	"sort"
	"strings"
)

// RenderMCP precedes token creation; the driver substitutes this placeholder at spawn time.
const museMCPPlaceholder = "${KIAO_MCP_TURN_TOKEN}"

// The turn credential must come from the run, never the process environment.
const museTurnTokenVar = "KIAO_MCP_TURN_TOKEN"

// buildMuseMCPConfig renders the mcp_servers object, omitting empty fields.
// An empty result leaves the deployment's CLI configuration untouched.
func BuildMuseMCPConfig(servers []equipment.MCPServer) string {
	if len(servers) == 0 {
		return ""
	}
	sorted := append([]equipment.MCPServer(nil), servers...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	entries := make(map[string]any, len(sorted))
	for _, server := range sorted {
		if server.Name == "" {
			continue
		}
		entries[server.Name] = museMCPEntry(server)
	}
	if len(entries) == 0 {
		return ""
	}
	rendered, err := json.Marshal(entries)
	if err != nil {
		return ""
	}
	return string(rendered)
}

func museMCPEntry(server equipment.MCPServer) map[string]any {
	entry := map[string]any{}
	if server.Type == equipment.MCPHTTP {
		entry["transport"] = "streamable_http"
		if url := strings.TrimSpace(server.URL); url != "" {
			entry["url"] = url
		}
		if len(server.Headers) > 0 {
			entry["headers"] = museMCPMap(server.Headers)
		}
		return entry
	}
	entry["transport"] = "stdio"
	if command := strings.TrimSpace(server.Command); command != "" {
		entry["command"] = command
	}
	if len(server.Args) > 0 {
		entry["args"] = append([]string(nil), server.Args...)
	}
	if len(server.Env) > 0 {
		entry["env"] = museMCPMap(server.Env)
	}
	return entry
}

// Omit empty headers and environment values rather than sending empty credentials.
func museMCPMap(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for key, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		out[key] = value
	}
	return out
}

// Expand only ${VAR}, preserving bare $ in literal arguments. The turn token comes
// from the run; other variables come from the process environment. Unset variables
// remain literal so a credential disappearing after server selection fails at that server.
func substituteMuseMCPPlaceholders(fragment, token string) string {
	withToken := strings.ReplaceAll(fragment, museMCPPlaceholder, token)
	var out strings.Builder
	rest := withToken
	for {
		dollar := strings.Index(rest, "${")
		if dollar < 0 {
			out.WriteString(rest)
			return out.String()
		}
		out.WriteString(rest[:dollar])
		rest = rest[dollar+2:]
		end := strings.Index(rest, "}")
		if end < 0 {
			out.WriteString("${")
			out.WriteString(rest)
			return out.String()
		}
		name := rest[:end]
		rest = rest[end+1:]
		if value, ok := os.LookupEnv(name); ok && value != "" {
			out.WriteString(value)
		} else {
			out.WriteString("${" + name + "}")
		}
	}
}
