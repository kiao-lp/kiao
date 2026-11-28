package boards

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// ErrAgentUnknown allows legacy harness/model fallback; other lookup errors stop play.
var ErrAgentUnknown = errors.New("unknown agent")

type AgentResolver interface {
	Agent(id string) (*ManagedAgent, error)
}

func (v *ManagedAgentVersion) SupportsHarness(harness string) bool {
	if len(v.Harnesses) == 0 {
		return harness == v.Harness
	}
	return slices.Contains(v.Harnesses, harness)
}

func (v *ManagedAgentVersion) SelectHarness(harness, profileID string) (*ManagedAgentVersion, error) {
	harness, profileID = strings.TrimSpace(harness), strings.TrimSpace(profileID)
	if harness == "" {
		harness = v.Harness
	}
	if !v.SupportsHarness(harness) {
		return nil, fmt.Errorf("the agent %q has no publication for %s", v.Name, harness)
	}
	if profileID != "" && (harness != "pi" || (v.ProfileID != "" && profileID != v.ProfileID)) {
		return nil, fmt.Errorf("the agent %q cannot use profile %q on %s", v.Name, profileID, harness)
	}
	selected := *v
	selected.Harness = harness
	if profileID != "" {
		selected.ProfileID = profileID
	}
	return &selected, nil
}

func (agent *ManagedAgent) ActivePublication() (*ManagedAgentVersion, error) {
	if agent.Archived {
		return nil, errors.New("the agent \"" + agent.Name + "\" is archived")
	}
	if agent.Published == nil {
		return nil, errors.New("the agent \"" + agent.Name + "\" has no published version")
	}
	return agent.Published, nil
}

// ErrRunnerUnknown makes refusals for pinned flow nodes identify the missing runner by id.
var ErrRunnerUnknown = errors.New("unknown runner")

// Without a resolver, refusals for pinned flow nodes use ids rather than runner names.
type RunnerResolver interface {
	Runner(id string) (*ManagedRunner, error)
}
