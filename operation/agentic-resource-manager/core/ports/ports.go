package ports

import (
	"context"
	"kiao/agentic-resource-manager/core/entities"
	"time"
)

type AgentRepository interface {
	// ImportAgent uses newDraft for repositories without an agent definition. A nil factory imports existing agents.
	ImportAgent(ctx context.Context, repository string, newDraft func(project string) (*entities.Agent, error)) (*entities.Agent, error)
	DeletionStatus(context.Context, string) (*entities.DeletionStatus, error)
	// CreateAgent returns ErrAgentNameTaken if the name is already held.
	CreateAgent(ctx context.Context, agent *entities.Agent, actor string) error
	// ListAgents orders by name.
	ListAgents(ctx context.Context) ([]entities.Agent, error)
	FindAgent(ctx context.Context, id string) (*entities.Agent, error)
	PatchAgent(ctx context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error)
	PublishAgent(ctx context.Context, id string, expected *int64, at time.Time, actor, confirmation string, bump entities.ReleaseBump) (*entities.Agent, error)
	AgentVersions(ctx context.Context, id string) ([]entities.AgentVersion, error)
	// DeleteAgent requires the current repository confirmation.
	DeleteAgent(ctx context.Context, id string, confirmation string, actor string) error
}

type AgenticResources interface {
	AgentPackage(context.Context, string, string) (*entities.AgentPackage, error)
	DraftAgentPackage(context.Context, string) (*entities.DraftAgentPackage, error)
	ListAgentDependencies(ctx context.Context, id string, kind entities.AgentDependencyKind) ([]entities.AgentDependency, error)
	SetAgentDependency(ctx context.Context, id string, kind entities.AgentDependencyKind, name string, linked, local bool) error
	ListResources(context.Context) ([]entities.AgenticResource, error)
	ReadResourceFile(context.Context, string, string) (*entities.ResourceFile, error)
	WriteResourceFile(context.Context, string, entities.ResourceFile) error
	ResourceOperation(ctx context.Context, name, operation, message, confirmation string, bump entities.ReleaseBump) error
}

type Clock interface{ Now() time.Time }
type IDs interface{ NewID() string }
