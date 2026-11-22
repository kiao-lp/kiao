package services

import (
	"context"

	"kiao/hybridflow-store/core/entities"
)

func (t *FlowNodes) checkConnections(ctx context.Context, boardID string, changes []entities.FlowNode) error {
	held, err := t.repo.ListFlowNodes(ctx, boardID)
	if err != nil {
		return err
	}
	return entities.ValidateConnectionChanges(held, changes)
}
