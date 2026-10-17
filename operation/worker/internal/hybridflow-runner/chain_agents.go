package hybridflowrunner

import (
	"errors"
	"strings"
)

// ErrAgentUnknown allows legacy engine/model fallback; other lookup errors stop play.
var ErrAgentUnknown = errors.New("unknown agent")

// Without a resolver, only legacy cards can play.
type agentResolver interface {
	Agent(id string) (*managedAgent, error)
}

// ErrRunnerUnknown makes pinned-card refusals identify the missing runner by id.
var ErrRunnerUnknown = errors.New("unknown runner")

// Without a resolver, pinned-card refusals use ids rather than runner names.
type runnerResolver interface {
	Runner(id string) (*managedRunner, error)
}

type playAgent struct {
	// Empty for legacy cards.
	name string
	// Managed agent id or legacy engine name, preserved in transcript records.
	id           string
	platform     string
	model        string
	instructions string
}

// Resolve on every play so edits take effect and deleted agents stop the chain.
func (r *ChainRunner) resolveAgent(flowNode flowNode) (playAgent, error) {
	want := strings.TrimSpace(flowNode.Settings.Agent)
	if r.agents != nil && want != "" {
		found, err := r.agents.Agent(want)
		if err == nil {
			return playAgent{
				name:         found.Name,
				id:           want,
				platform:     strings.TrimSpace(found.Platform),
				model:        strings.TrimSpace(found.Model),
				instructions: strings.TrimSpace(found.Instructions),
			}, nil
		}
		if !errors.Is(err, ErrAgentUnknown) {
			return playAgent{}, err
		}
	}
	// Legacy cards require both a supported engine and a model; an engine alone is insufficient.
	if flowNode.Settings.Model != "" && r.drives(want) {
		return playAgent{id: want, platform: want, model: flowNode.Settings.Model}, nil
	}
	if want == "" {
		return playAgent{}, errors.New("this flow node names no agent, so nothing can play it")
	}
	return playAgent{}, errors.New("this flow node names the agent \"" + want +
		"\", which is no agent of this store")
}

// drives checks build support, regardless of availability on this host.
// Tests without a registry fall back to the built-in engine names.
func (r *ChainRunner) drives(name string) bool {
	if r.hub == nil || r.hub.agents == nil {
		return name == agentClaude || name == agentCodex || name == agentMuse || name == agentOpenCode
	}
	return r.hub.agents.drives(name)
}
