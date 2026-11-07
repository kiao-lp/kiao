package agents

import (
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"strings"
)

// resolvedAgent is the agent a stored name refers to. Empty is the default, which is Claude by
// construction — newAgentRegistry always registers it first — and is also what every conversation
// written before the field was one actually ran on.
func ResolvedAgent(name string) string {
	return protocol.OrDefault(strings.TrimSpace(name), AgentClaude)
}
