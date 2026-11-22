package services

import (
	"context"
	"kiao/agentic-resource-manager/core/entities"
	"kiao/agentic-resource-manager/core/ports"
)

type AgenticResources struct{ repository ports.AgenticResources }

func NewAgenticResources(repository ports.AgenticResources) *AgenticResources {
	return &AgenticResources{repository: repository}
}
func (s *AgenticResources) List(ctx context.Context) ([]entities.AgenticResource, error) {
	return s.repository.ListResources(ctx)
}
func (s *AgenticResources) Read(ctx context.Context, name, path string) (*entities.ResourceFile, error) {
	return s.repository.ReadResourceFile(ctx, name, path)
}
func (s *AgenticResources) Write(ctx context.Context, name string, file entities.ResourceFile) error {
	return s.repository.WriteResourceFile(ctx, name, file)
}
func (s *AgenticResources) Operate(ctx context.Context, name, operation, message, confirmation string, bump entities.ReleaseBump) error {
	switch operation {
	case "install", "publish", "pull", "push":
	default:
		return entities.Invalidf("unknown resource operation %q", operation)
	}
	return s.repository.ResourceOperation(ctx, name, operation, message, confirmation, bump)
}

func (s *AgenticResources) Package(ctx context.Context, id, commit string) (*entities.AgentPackage, error) {
	return s.repository.AgentPackage(ctx, id, commit)
}

func (s *AgenticResources) DraftPackage(ctx context.Context, id string) (*entities.DraftAgentPackage, error) {
	return s.repository.DraftAgentPackage(ctx, id)
}

func (s *AgenticResources) Dependencies(ctx context.Context, id string, kind entities.AgentDependencyKind) ([]entities.AgentDependency, error) {
	return s.repository.ListAgentDependencies(ctx, id, kind)
}

func (s *AgenticResources) SetDependency(ctx context.Context, id string, kind entities.AgentDependencyKind, name string, linked, local bool) error {
	return s.repository.SetAgentDependency(ctx, id, kind, name, linked, local)
}
