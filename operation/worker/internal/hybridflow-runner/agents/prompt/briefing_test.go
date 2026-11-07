package prompt

import (
	"strings"
	"testing"
)

// TestAgentBriefing pins what the model is told about its own output surface. Both halves are
// capabilities it cannot discover: a model that does not know a fenced mermaid block is drawn writes
// out the source instead, and one that does not know a store path is a working link writes the path
// as prose. Neither failure looks like a failure in the conversation.
func TestAgentBriefing(t *testing.T) {
	briefing := AgentBriefing("/srv/store")

	for _, want := range []string{"mermaid", "plantuml"} {
		if !strings.Contains(briefing, want) {
			t.Errorf("briefing = %q, want it to name %s as a fence that renders", briefing, want)
		}
	}
	if !strings.Contains(briefing, "/units/abc/cadre.md") {
		t.Errorf("briefing = %q, want the store-relative link form spelled out", briefing)
	}

	// The rule is "relative to the store root", which is only actionable once the model can tell
	// which absolute path that root is — every path it reads in a turn arrives absolute.
	if !strings.Contains(briefing, "/srv/store/units/abc/cadre.md") {
		t.Errorf("briefing = %q, want this store's root anchoring the example", briefing)
	}

	// An unresolvable root loses the anchor and keeps the rule: the alternative is a briefing that
	// states a store root this deployment does not have.
	rootless := AgentBriefing("  ")
	if strings.Contains(rootless, "The store root is") {
		t.Errorf("rootless briefing = %q, must not name a root it could not resolve", rootless)
	}
	if !strings.Contains(rootless, "mermaid") || !strings.Contains(rootless, "/units/abc/cadre.md") {
		t.Errorf("rootless briefing = %q, want the briefing itself unchanged", rootless)
	}
}

// A turn played by a managed agent is given the agent's standing instructions under the briefing:
// the surface's own half first, identical on every turn, and the turn's own under it. Empty
// instructions are the briefing alone.
func TestAgentBriefingWithInstructions(t *testing.T) {
	with := AgentBriefingWith("/srv/store", "Be terse.")
	if !strings.HasPrefix(with, AgentBriefing("/srv/store")) {
		t.Errorf("briefing = %q, want the surface's half first and unchanged", with)
	}
	if !strings.HasSuffix(with, "Be terse.") {
		t.Errorf("briefing = %q, want the standing instructions under it", with)
	}
	if bare := AgentBriefingWith("/srv/store", "  "); bare != AgentBriefing("/srv/store") {
		t.Errorf("briefing = %q, want empty instructions to change nothing", bare)
	}
}
