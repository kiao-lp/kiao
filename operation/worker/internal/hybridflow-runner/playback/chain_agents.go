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
	want := strings.TrimSpace(flowNode.Settings.Agent)
	harness, profileID := flowNode.Settings.Harness, flowNode.Settings.ProfileID
	model := ""
	if harness != "" {
		model = flowNode.Settings.Model
	}
	if flowNode.Chat != "" && r.convs != nil {
		meta, err := r.convs.Get(flowNode.Chat)
		if err != nil {
			return PlayAgent{}, err
		}
		if meta.AgentVersion != nil && (want == "" || meta.AgentVersion.AgentID == want) &&
			(harness == "" || meta.Harness == harness) && (profileID == "" || meta.ProfileID == profileID) &&
			(model == "" || meta.AgentVersion.ConversationModel(meta.Model) == model) {
			if meta.AgentVersion.Commit == "" && r.Agents != nil {
				if current, err := r.Agents.Agent(meta.AgentVersion.AgentID); err == nil && current.Published != nil && current.Published.Commit != "" {
					return activePlayAgent(current, harness, profileID, model)
				}
			}
			resolved := publishedPlayAgent(meta.AgentVersion)
			resolved.Model, resolved.profileID = meta.AgentVersion.ConversationModel(meta.Model), meta.ProfileID
			return resolved, nil
		}
	}
	if r.Agents != nil && want != "" {
		found, err := r.Agents.Agent(want)
		if err == nil {
			return activePlayAgent(found, harness, profileID, model)
		}
		if !errors.Is(err, pkgBoards.ErrAgentUnknown) {
			return PlayAgent{}, err
		}
	}
	// Legacy cards require both a supported engine and a model; an engine alone is insufficient.
	if harness == "" && profileID == "" && flowNode.Settings.Model != "" && r.drives(want) {
		return PlayAgent{Id: want, Harness: want, Model: flowNode.Settings.Model}, nil
	}
	if want == "" {
		return PlayAgent{}, errors.New("this flow node names no agent, so nothing can play it")
	}
	return PlayAgent{}, errors.New("this flow node names the agent \"" + want +
		"\", which is no agent of this store")
}

func activePlayAgent(agent *pkgBoards.ManagedAgent, harness, profileID, model string) (PlayAgent, error) {
	version, err := agent.ActivePublication()
	if err != nil {
		return PlayAgent{}, err
	}
	version, err = version.SelectHarness(harness, profileID)
	if err != nil {
		return PlayAgent{}, err
	}
	resolved := publishedPlayAgent(version)
	if model != "" {
		resolved.Model = model
	}
	return resolved, nil
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
		return name == harnessapi.HarnessClaude || name == harnessapi.HarnessCodex || name == harnessapi.HarnessMuse || name == harnessapi.HarnessPi
	}
	return r.Hub.HarnessRegistry().Drives(name)
}

func FlowNodeWithAgent(id string) pkgBoards.FlowNode {
	return pkgBoards.FlowNode{Settings: pkgBoards.FlowNodeSettings{Agent: id}}
}

// AgentRefusal checks harness availability, profile and permission support for an AI card.
func (r *ChainRunner) AgentRefusal(flowNode pkgBoards.FlowNode) string {
	if !flowNode.IsAI() || r.Hub == nil || r.Hub.HarnessRegistry() == nil {
		return ""
	}
	resolved, err := r.ResolveAgent(flowNode)
	if err != nil {
		return err.Error()
	}
	if r.cfg != nil && r.cfg.RequireAgentPackages && (resolved.Snapshot == nil || resolved.Snapshot.Commit == "") {
		return "Select a published APM agent before running this task."
	}
	if !r.Hub.HarnessRegistry().Known(resolved.Harness) {
		// Name a managed agent in the refusal; legacy engine/model cards identify their harness.
		if resolved.Name != "" {
			return "the agent \"" + resolved.Name + "\" runs on " + resolved.Harness +
				", which this service does not offer"
		}
		return "this flow node asks for the harness " + resolved.Harness + ", which this service does not offer"
	}
	if resolved.Harness == harnessapi.HarnessPi {
		profile, err := r.Hub.HarnessRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
		if err == nil {
			err = r.Hub.HarnessRegistry().Profiles.ValidateTurn(profile, true)
		}
		if err != nil {
			return err.Error()
		}
	}
	if !r.Hub.HarnessRegistry().PublishesMode(resolved.Harness, flowNode.Settings.Permission) {
		return harnessapi.ModeUnsupportedMessage(r.Hub.HarnessRegistry().Label(resolved.Harness), flowNode.Settings.Permission)
	}
	return ""
}

// RunnerRefusal rejects a card pinned to another runner.
func (r *ChainRunner) RunnerRefusal(flowNode pkgBoards.FlowNode) string {
	want := strings.TrimSpace(flowNode.Settings.Runner)
	if want == "" {
		return ""
	}
	mine := r.cfg.CurrentRunnerID()
	if want == mine {
		return ""
	}
	pinned := r.runnerName(want)
	if mine == "" {
		return "this flow node runs on " + pinned + ", and this service names no runner"
	}
	return "this flow node runs on " + pinned + ", and this service is " + r.runnerName(mine)
}

// runnerName resolves the display name, falling back to the id if the store cannot answer.
func (r *ChainRunner) runnerName(id string) string {
	if r.Runners != nil {
		if found, err := r.Runners.Runner(id); err == nil && strings.TrimSpace(found.Name) != "" {
			return "“" + strings.TrimSpace(found.Name) + "”"
		}
	}
	return "“" + id + "”"
}
