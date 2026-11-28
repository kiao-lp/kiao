package services

import (
	"context"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
	"kiao/agentic-resource-manager/core/ports"
)

// Agents manages source definitions and Git publications through its repository port.
type Agents struct {
	repo  ports.AgentRepository
	clock ports.Clock
	ids   ports.IDs
}

func NewAgents(repo ports.AgentRepository, clock ports.Clock, ids ports.IDs) *Agents {
	return &Agents{repo: repo, clock: clock, ids: ids}
}

type NewAgentRequest struct {
	Repository   string `json:"repository,omitempty"`
	ImportOnly   bool   `json:"importOnly,omitempty"`
	Name         string
	Harness      string
	Model        string
	Effort       string
	ProfileID    string
	Description  string
	Instructions string
}

// Create imports an agent or initializes a draft in a Git repository.
func (a *Agents) Create(ctx context.Context, req NewAgentRequest, actor string) (*entities.Agent, error) {
	repository := strings.TrimSpace(req.Repository)
	if req.ImportOnly {
		if repository == "" {
			return nil, entities.Invalidf("a Git repository is required to import an agent")
		}
		return a.repo.ImportAgent(ctx, repository, nil)
	}
	if repository != "" {
		return a.repo.ImportAgent(ctx, repository, func(project string) (*entities.Agent, error) {
			if strings.TrimSpace(req.Name) == "" {
				req.Name = project
			}
			if strings.TrimSpace(req.Harness) == "" {
				req.Harness = string(entities.HarnessClaude)
			}
			return a.newDraft(req)
		})
	}
	agent, err := a.newDraft(req)
	if err != nil {
		return nil, err
	}
	if err = a.repo.CreateAgent(ctx, agent, actor); err != nil {
		return nil, err
	}
	return agent, nil
}

func (a *Agents) newDraft(req NewAgentRequest) (*entities.Agent, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, entities.Invalidf("an agent has a name")
	}
	harness, ok := entities.ReadHarness(req.Harness)
	if !ok {
		return nil, entities.Invalidf("unsupported harness %q. Choose claude, codex, muse or pi.", strings.TrimSpace(req.Harness))
	}
	now := a.clock.Now()
	return &entities.Agent{
		ID: a.ids.NewID(), Name: name, Harness: harness,
		Model: strings.TrimSpace(req.Model), Effort: strings.TrimSpace(req.Effort), Instructions: strings.TrimSpace(req.Instructions),
		ProfileID:   strings.TrimSpace(req.ProfileID),
		Description: strings.TrimSpace(req.Description),
		CreatedAt:   now, UpdatedAt: now, Revision: 1,
	}, nil
}

func (a *Agents) List(ctx context.Context) ([]entities.Agent, error) {
	return a.repo.ListAgents(ctx)
}

func (a *Agents) Publish(ctx context.Context, id string, expected *int64, actor, confirmation string, bump entities.ReleaseBump) (*entities.Agent, error) {
	return a.repo.PublishAgent(ctx, id, expected, a.clock.Now(), actor, confirmation, bump)
}

func (a *Agents) Versions(ctx context.Context, id string) ([]entities.AgentVersion, error) {
	return a.repo.AgentVersions(ctx, id)
}

// Remote reports what the agent's Git remote holds beyond its working tree.
func (a *Agents) Remote(ctx context.Context, id string) (*entities.AgentRemote, error) {
	return a.repo.Remote(ctx, id)
}

// Pull fast-forwards the agent's working tree to its remote branch.
func (a *Agents) Pull(ctx context.Context, id string) (*entities.Agent, error) {
	return a.repo.PullAgent(ctx, id)
}

// Find is one agent, by id.
func (a *Agents) Find(ctx context.Context, id string) (*entities.Agent, error) {
	return a.repo.FindAgent(ctx, id)
}

// Patch validates edited fields before writing the working tree.
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
	if patch.Harness != nil {
		harness, ok := entities.ReadHarness(string(*patch.Harness))
		if !ok {
			return nil, entities.Invalidf("unsupported harness %q. Choose claude, codex, muse or pi.", strings.TrimSpace(string(*patch.Harness)))
		}
		patch.Harness = &harness
	}
	if patch.Model != nil {
		model := strings.TrimSpace(*patch.Model)
		patch.Model = &model
	}
	if patch.Effort != nil {
		value := strings.TrimSpace(*patch.Effort)
		patch.Effort = &value
	}
	if patch.ProfileID != nil {
		profile := strings.TrimSpace(*patch.ProfileID)
		patch.ProfileID = &profile
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

// Delete removes the local repository; task references live with their tasks.
func (a *Agents) Delete(ctx context.Context, id, confirmation, actor string) error {
	return a.repo.DeleteAgent(ctx, id, confirmation, actor)
}

func (a *Agents) DeletionStatus(ctx context.Context, id string) (*entities.DeletionStatus, error) {
	return a.repo.DeletionStatus(ctx, id)
}
