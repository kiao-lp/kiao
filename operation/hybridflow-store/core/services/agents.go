package services

import (
	"context"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Agents is the managed-agents half of the core: the named definitions of what plays a flow node.
//
// What it does **not** do is run a turn, or even know which of the four platforms a host drives:
// the registry of engines is worker's, and an agent naming a platform this host has never
// heard of is refused there, at the click, where the message can name the card's own words. This
// half keeps the definitions — which is what a runner needs to be able to lose its process without
// losing.
type Agents struct {
	repo  ports.AgentRepository
	clock ports.Clock
	ids   ports.IDs
}

func NewAgents(repo ports.AgentRepository, clock ports.Clock, ids ports.IDs) *Agents {
	return &Agents{repo: repo, clock: clock, ids: ids}
}

// NewAgentRequest is one agent to be filed. The name and the platform are what make it one; the
// model, selection description and instructions may be empty.
type NewAgentRequest struct {
	Name         string
	Platform     string
	Model        string
	Description  string
	Instructions string
}

// Create files an agent. The id is minted here: nothing draws an agent before it exists, so unlike
// a card's it is never the client's to choose.
func (a *Agents) Create(ctx context.Context, req NewAgentRequest, actor string) (*entities.Agent, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, entities.Invalidf("an agent has a name")
	}
	platform, ok := entities.ReadAgentPlatform(req.Platform)
	if !ok {
		return nil, entities.Invalidf("no agent runs on %q: the platforms are claude, codex, muse and opencode", strings.TrimSpace(req.Platform))
	}
	now := a.clock.Now()
	agent := &entities.Agent{
		ID: a.ids.NewID(), Name: name, Platform: platform,
		Model: strings.TrimSpace(req.Model), Instructions: strings.TrimSpace(req.Instructions),
		Description: strings.TrimSpace(req.Description),
		CreatedAt:   now, UpdatedAt: now, Revision: 1,
	}
	if err := a.repo.CreateAgent(ctx, agent, actor); err != nil {
		return nil, err
	}
	return agent, nil
}

// List is every agent, by name: what the panel lists and the flow node editor picks from.
func (a *Agents) List(ctx context.Context) ([]entities.Agent, error) {
	return a.repo.ListAgents(ctx)
}

// Find is one agent, by id.
func (a *Agents) Find(ctx context.Context, id string) (*entities.Agent, error) {
	return a.repo.FindAgent(ctx, id)
}

// Patch changes the fields the patch names. A name emptied, or a platform this build has never
// heard of, is refused rather than written: an agent must stay a thing a flow node can name.
func (a *Agents) Patch(ctx context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		if name == "" {
			return nil, entities.Invalidf("an agent keeps a name")
		}
		patch.Name = &name
	}
	// The platform is validated here rather than where the patch was read, so there is one place
	// that says what the platforms are: a patch carrying a word this build has never heard of is
	// refused, not normalized into something it never said.
	if patch.Platform != nil {
		platform, ok := entities.ReadAgentPlatform(string(*patch.Platform))
		if !ok {
			return nil, entities.Invalidf("no agent runs on %q: the platforms are claude, codex, muse and opencode", strings.TrimSpace(string(*patch.Platform)))
		}
		patch.Platform = &platform
	}
	if patch.Model != nil {
		model := strings.TrimSpace(*patch.Model)
		patch.Model = &model
	}
	if patch.Instructions != nil {
		instructions := strings.TrimSpace(*patch.Instructions)
		patch.Instructions = &instructions
	}
	if patch.Description != nil {
		description := strings.TrimSpace(*patch.Description)
		patch.Description = &description
	}
	return a.repo.PatchAgent(ctx, id, patch, expected, actor)
}

// Delete removes an agent. The flow nodes naming it are left as they are: they still say which
// agent they wanted, and the next play says it is gone rather than failing on a reference nobody
// can see.
func (a *Agents) Delete(ctx context.Context, id string, actor string) error {
	return a.repo.DeleteAgent(ctx, id, actor)
}
