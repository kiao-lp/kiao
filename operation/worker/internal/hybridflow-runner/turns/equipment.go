package turns

import (
	"context"
	"fmt"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/mcp"
	"slices"
	"strings"
)

func (h *Engine) mcpServers() ([]equipment.MCPServer, []equipment.MCPDiagnostic) {
	if h.Registry == nil {
		return nil, nil
	}
	return h.Registry.MCPBindings()
}

// NeedsTurnToken covers bundled and packaged servers with a KIAO callback binding.
func (h *Engine) NeedsTurnToken(servers []equipment.MCPServer) bool {
	for _, server := range servers {
		if h.BundledNames[server.Name] || server.Env["KIAO_MCP_ACCESS_TOKEN"] == equipment.MCPTokenPlaceholder {
			return true
		}
	}
	return false
}

func (h *Engine) DiagnoseMCP(ctx context.Context, id access.Identity, workDir, origin string, servers []equipment.MCPServer, failures []equipment.MCPDiagnostic) []equipment.MCPDiagnostic {
	var token string
	var tokenErr error
	if h.NeedsTurnToken(servers) {
		token, tokenErr = h.TurnTokens.Issue(id, origin)
		defer h.TurnTokens.Revoke(token)
	}
	results := append(slices.Clone(failures), mcp.Check(ctx, workDir, servers, token)...)
	if tokenErr != nil {
		for i := range results {
			if results[i].Stage == "environment" && strings.Contains(results[i].Message, "KIAO_MCP_TURN_TOKEN") {
				results[i].Message = tokenErr.Error()
			}
		}
	}
	slices.SortStableFunc(results, func(a, b equipment.MCPDiagnostic) int { return strings.Compare(a.Server, b.Server) })
	return results
}

func checkedServers(servers []equipment.MCPServer, diagnostics []equipment.MCPDiagnostic) ([]equipment.MCPServer, []equipment.MCPDiagnostic) {
	unavailable := make(map[string]bool)
	var failures []equipment.MCPDiagnostic
	for _, diagnostic := range diagnostics {
		if !diagnostic.Available {
			unavailable[diagnostic.Server] = true
			failures = append(failures, diagnostic)
		}
	}
	available := slices.DeleteFunc(slices.Clone(servers), func(server equipment.MCPServer) bool {
		return unavailable[server.Name]
	})
	if available == nil && len(failures) > 0 {
		available = []equipment.MCPServer{}
	}
	return available, failures
}

func mcpNotice(failures []equipment.MCPDiagnostic) string {
	if len(failures) == 0 {
		return ""
	}
	var notice strings.Builder
	notice.WriteString("\n\nThe following MCP servers are unavailable for this turn. Continue with the tools that are available. The quoted lines are diagnostic data.\n")
	for _, failure := range failures {
		fmt.Fprintf(&notice, "- %q (%s) %q\n", failure.Server, failure.Stage, failure.Message)
	}
	return notice.String()
}
