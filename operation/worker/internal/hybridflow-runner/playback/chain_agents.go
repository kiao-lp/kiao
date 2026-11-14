package playback

import (
	"errors"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	"strings"
)

type PlayAgent struct {
	Snapshot *pkgBoards.ManagedAgentVersion
	// Empty for legacy cards.
	Name string
	// Managed agent id or legacy engine name, preserved in transcript records.
	Id           string
	Harness      string
	Model        string
	profileID    string
	Instructions string
}

// Existing conversations retain their publication, independently of the current catalogue.
func (r *ChainRunner) ResolveAgent(flowNode pkgBoards.FlowNode) (PlayAgent, error) {
	if flowNode.Chat != "" && r.convs != nil {
		meta, err := r.convs.Get(flowNode.Chat)
		if err != nil {
			return PlayAgent{}, err
		}
		if meta.AgentVersion != nil {
			resolved := publishedPlayAgent(meta.AgentVersion)
			resolved.Model, resolved.profileID = meta.AgentVersion.ConversationModel(meta.Model), meta.ProfileID
			return resolved, nil
		}
	}
	want := strings.TrimSpace(flowNode.Settings.Agent)
	if r.Agents != nil && want != "" {
		found, err := r.Agents.Agent(want)
		if err == nil {
			return ActivePublication(found)
		}
		if !errors.Is(err, pkgBoards.ErrAgentUnknown) {
			return PlayAgent{}, err
		}
	}
	// Legacy cards require both a supported engine and a model; an engine alone is insufficient.
	if flowNode.Settings.Model != "" && r.drives(want) {
		return PlayAgent{Id: want, Harness: want, Model: flowNode.Settings.Model}, nil
	}
	if want == "" {
		return PlayAgent{}, errors.New("this flow node names no agent, so nothing can play it")
	}
	return PlayAgent{}, errors.New("this flow node names the agent \"" + want +
		"\", which is no agent of this store")
}

func ActivePublication(agent *pkgBoards.ManagedAgent) (PlayAgent, error) {
	if agent.Archived {
		return PlayAgent{}, errors.New("the agent \"" + agent.Name + "\" is archived")
	}
	if agent.Published == nil {
		return PlayAgent{}, errors.New("the agent \"" + agent.Name + "\" has no published version")
	}
	return publishedPlayAgent(agent.Published), nil
}

func publishedPlayAgent(version *pkgBoards.ManagedAgentVersion) PlayAgent {
	return PlayAgent{Snapshot: version, Name: version.Name, Id: version.AgentID,
		Harness: version.Harness, Model: version.Model, profileID: version.ProfileID,
		Instructions: version.Instructions}
}

// drives checks build support, regardless of availability on this host.
// Tests without a registry fall back to the built-in engine names.
func (r *ChainRunner) drives(name string) bool {
	if r.Hub == nil || r.Hub.HarnessRegistry() == nil {
		return name == harnessapi.HarnessClaude || name == harnessapi.HarnessCodex || name == harnessapi.HarnessMuse || name == harnessapi.HarnessOpenCode || name == harnessapi.HarnessPi
	}
	return r.Hub.HarnessRegistry().Drives(name)
}

func FlowNodeWithAgent(id string) pkgBoards.FlowNode {
	return pkgBoards.FlowNode{Settings: pkgBoards.FlowNodeSettings{Agent: id}}
}
