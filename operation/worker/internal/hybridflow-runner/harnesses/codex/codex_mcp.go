package codex

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/process"
	"slices"
	"sort"
	"strings"
	"time"
)

// buildCodexMCPConfig returns a deterministic TOML inline table. An empty result leaves
// the deployment's CLI configuration untouched (no mcp_servers override).
func buildCodexMCPConfig(servers []equipment.MCPServer) string {
	if servers == nil {
		return ""
	}
	if len(servers) == 0 {
		return "{}"
	}
	sorted := append([]equipment.MCPServer(nil), servers...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	entries := make([]string, 0, len(sorted))
	for _, server := range sorted {
		entries = append(entries, tomlKey(server.Name)+" = "+codexMCPEntry(server))
	}
	return "{ " + strings.Join(entries, ", ") + " }"
}

// Codex merges overrides with its own MCP settings. Disable inherited entries
// by name without supplying a transport or changing the rest of its settings.
func excludeUnavailableMCP(binary, dir, config string, unavailable []string) string {
	if len(unavailable) == 0 {
		return config
	}
	result := process.RunProc([]string{binary, "mcp", "list", "--json"}, dir, 2*time.Second, nil)
	var inherited []struct {
		Name string `json:"name"`
	}
	if !result.OK() || json.Unmarshal([]byte(result.Stdout), &inherited) != nil {
		return config
	}
	var entries []string
	if active := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(config, "{"), "}")); active != "" {
		entries = append(entries, active)
	}
	for _, server := range inherited {
		if slices.Contains(unavailable, server.Name) {
			entries = append(entries, tomlKey(server.Name)+" = { enabled = false }")
		}
	}
	return "{ " + strings.Join(entries, ", ") + " }"
}

// Omit empty fields: an empty command makes Codex try to start an invalid server.
func codexMCPEntry(server equipment.MCPServer) string {
	var fields []string
	if server.Type == equipment.MCPHTTP {
		if url := strings.TrimSpace(server.URL); url != "" {
			fields = append(fields, "url = "+tomlString(url))
		}
		literal, environment := map[string]string{}, map[string]string{}
		for key, value := range server.Headers {
			if strings.EqualFold(key, "Authorization") && strings.HasPrefix(value, "Bearer ") {
				if name, ok := mcpEnvReference(strings.TrimPrefix(value, "Bearer ")); ok {
					fields = append(fields, "bearer_token_env_var = "+tomlString(name))
					continue
				}
			}
			if name, ok := mcpEnvReference(value); ok {
				environment[key] = name
			} else {
				literal[key] = value
			}
		}
		if len(literal) > 0 {
			fields = append(fields, "http_headers = "+tomlTable(literal))
		}
		if len(environment) > 0 {
			fields = append(fields, "env_http_headers = "+tomlTable(environment))
		}
		return "{ " + strings.Join(fields, ", ") + " }"
	}
	if command := strings.TrimSpace(server.Command); command != "" {
		fields = append(fields, "command = "+tomlString(command))
		fields = append(fields, "startup_timeout_sec = 180")
	}
	if len(server.Args) > 0 {
		quoted := make([]string, 0, len(server.Args))
		for _, arg := range server.Args {
			quoted = append(quoted, tomlString(arg))
		}
		fields = append(fields, "args = ["+strings.Join(quoted, ", ")+"]")
	}
	if len(server.Env) > 0 {
		literal := map[string]string{}
		var inherited []string
		for key, value := range server.Env {
			if name, ok := mcpEnvReference(value); ok && name == key {
				inherited = append(inherited, tomlString(key))
			} else {
				literal[key] = value
			}
		}
		sort.Strings(inherited)
		if len(literal) > 0 {
			fields = append(fields, "env = "+tomlTable(literal))
		}
		if len(inherited) > 0 {
			fields = append(fields, "env_vars = ["+strings.Join(inherited, ", ")+"]")
		}
	}
	return "{ " + strings.Join(fields, ", ") + " }"
}

func mcpEnvReference(value string) (string, bool) {
	if !strings.HasPrefix(value, "${") || !strings.HasSuffix(value, "}") {
		return "", false
	}
	name := strings.TrimPrefix(strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}"), "env:")
	if name == "" {
		return "", false
	}
	for i, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || (i > 0 && r >= '0' && r <= '9') {
			continue
		}
		return "", false
	}
	return name, true
}

// Sort keys so identical configurations produce identical argument lists.
func tomlTable(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, key := range keys {
		pairs = append(pairs, tomlKey(key)+" = "+tomlString(values[key]))
	}
	return "{ " + strings.Join(pairs, ", ") + " }"
}

// Toolbox names may contain characters outside TOML's bare-key alphabet.
func tomlKey(key string) string {
	if key == "" {
		return `""`
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return tomlString(key)
		}
	}
	return key
}

// TOML basic strings require control characters to be escaped.
func tomlString(value string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 || r == 0x7f {
				b.WriteString(fmt.Sprintf(`\u%04X`, r))
				continue
			}
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
