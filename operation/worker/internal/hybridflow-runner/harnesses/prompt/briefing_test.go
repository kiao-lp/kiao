package prompt

import (
	"strings"
	"testing"
)

// TestHarnessBriefing covers the rendering and DCMS link guidance a turn receives.
func TestHarnessBriefing(t *testing.T) {
	briefing := HarnessBriefing("/srv/store")

	for _, want := range []string{"mermaid", "plantuml"} {
		if !strings.Contains(briefing, want) {
			t.Errorf("briefing = %q, want it to name %s as a fence that renders", briefing, want)
		}
	}
	if !strings.Contains(briefing, "DCMS link") || !strings.Contains(briefing, "[cadre.md](/units/abc/cadre.md)") {
		t.Errorf("briefing = %q, want a DCMS link example", briefing)
	}

	// The rule is "relative to the DCMS root", which is only actionable once the model can tell
	// which absolute path that root is — every path it reads in a turn arrives absolute.
	if !strings.Contains(briefing, "/srv/store/units/abc/cadre.md") {
		t.Errorf("briefing = %q, want the absolute DCMS root in the example", briefing)
	}

	// An unresolvable root loses the anchor and keeps the rule: the alternative is a briefing that
	// states a DCMS root this deployment does not have.
	rootless := HarnessBriefing("  ")
	if strings.Contains(rootless, "The DCMS root is") {
		t.Errorf("rootless briefing = %q, must not name a root it could not resolve", rootless)
	}
	if !strings.Contains(rootless, "mermaid") || !strings.Contains(rootless, "/units/abc/cadre.md") {
		t.Errorf("rootless briefing = %q, want the briefing itself unchanged", rootless)
	}
}

// A turn played by a managed agent is given the harness's standing instructions under the briefing:
// the surface's own half first, identical on every turn, and the turn's own under it. Empty
// instructions are the briefing alone.
func TestHarnessBriefingWithInstructions(t *testing.T) {
	with := HarnessBriefingWith("/srv/store", "Be terse.")
	if !strings.HasPrefix(with, HarnessBriefing("/srv/store")) {
		t.Errorf("briefing = %q, want the surface's half first and unchanged", with)
	}
	if !strings.HasSuffix(with, "Be terse.") {
		t.Errorf("briefing = %q, want the standing instructions under it", with)
	}
	if bare := HarnessBriefingWith("/srv/store", "  "); bare != HarnessBriefing("/srv/store") {
		t.Errorf("briefing = %q, want empty instructions to change nothing", bare)
	}
}
