package services

import (
	"context"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
	"regexp"
)

type Executions struct {
	repository ports.ExecutionRepository
	boards     ports.BoardRepository
}

func NewExecutions(repository ports.ExecutionRepository, boards ports.BoardRepository) *Executions {
	return &Executions{repository: repository, boards: boards}
}

var executionCommit = regexp.MustCompile(`^[0-9a-f]{40}$`)

func (s *Executions) Record(ctx context.Context, execution entities.TaskExecution) error {
	if execution.ID == "" || execution.ConversationID == "" || execution.TurnID == "" || execution.Harness == "" || execution.Model == "" || execution.Effort == "" || execution.Agent.AgentID == "" || !executionCommit.MatchString(execution.Agent.Commit) || execution.At.IsZero() {
		return entities.Invalidf("execution requires its agent commit, resolved harness, model and effort, conversation, turn and date")
	}
	if _, err := s.boards.FindFlowNode(ctx, execution.FlowNodeID); err != nil {
		return err
	}
	return s.repository.RecordExecution(ctx, execution)
}
func (s *Executions) List(ctx context.Context, id string) ([]entities.TaskExecution, error) {
	return s.repository.Executions(ctx, id)
}
