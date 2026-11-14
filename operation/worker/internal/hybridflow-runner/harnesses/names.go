package harnesses

import (
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	"strings"
)

// ResolvedHarness defaults an empty stored name to Claude for legacy conversation records.
func ResolvedHarness(name string) string {
	return protocol.OrDefault(strings.TrimSpace(name), HarnessClaude)
}
