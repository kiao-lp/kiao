package codex

import (
	"fmt"
	"kiao/worker/internal/core/equipment"
	"sort"
	"strings"
)

// buildCodexMCPConfig returns a deterministic TOML inline table. An empty result leaves
// the deployment's CLI configuration untouched (no mcp_servers override).
func buildCodexMCPConfig(servers []equipment.MCPServer) string {
	if len(servers) == 0 {
		return ""
	}
	sorted := append([]equipment.MCPServer(nil), servers...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	entries := make([]string, 0, len(sorted))
	for _, server := range sorted {
		entries = append(entries, tomlKey(server.Name)+" = "+codexMCPEntry(server))
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
		// Codex calls headers http_headers. Use explicit credentials for both transports
		// rather than a separate bearer_token_env_var path for HTTP.
		if len(server.Headers) > 0 {
			fields = append(fields, "http_headers = "+tomlTable(server.Headers))
		}
		return "{ " + strings.Join(fields, ", ") + " }"
	}
	if command := strings.TrimSpace(server.Command); command != "" {
		fields = append(fields, "command = "+tomlString(command))
	}
	if len(server.Args) > 0 {
		quoted := make([]string, 0, len(server.Args))
		for _, arg := range server.Args {
			quoted = append(quoted, tomlString(arg))
		}
		fields = append(fields, "args = ["+strings.Join(quoted, ", ")+"]")
	}
	if len(server.Env) > 0 {
		fields = append(fields, "env = "+tomlTable(server.Env))
	}
	return "{ " + strings.Join(fields, ", ") + " }"
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
