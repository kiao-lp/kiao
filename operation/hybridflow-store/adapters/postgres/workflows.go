package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Workflows. One row per rectangle: a name round a set of flow nodes,
// with no spot of its own — the bounds are computed from the flow nodes that name it.

var _ ports.WorkflowRepository = (*BoardStore)(nil)

const workflowColumns = `id, board_id, name, created_at, updated_at, revision, runtime_values, workflow_folder, files`

func scanWorkflow(row pgx.Row) (*entities.Workflow, error) {
	var workflow entities.Workflow
	if err := row.Scan(&workflow.ID, &workflow.BoardID, &workflow.Name,
		&workflow.CreatedAt, &workflow.UpdatedAt, &workflow.Revision, &workflow.Values,
		&workflow.WorkflowFolder, &workflow.Files); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func (s *BoardStore) CreateWorkflow(ctx context.Context, workflow *entities.Workflow, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		return insertWorkflow(ctx, tx, workflow)
	})
}

func (s *BoardStore) CreateWorkflowWithFlowNodes(ctx context.Context, workflow *entities.Workflow, flowNodes []*entities.FlowNode, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		if err := insertWorkflow(ctx, tx, workflow); err != nil {
			return err
		}
		return insertFlowNodes(ctx, tx, flowNodes)
	})
}

func insertWorkflow(ctx context.Context, tx pgx.Tx, workflow *entities.Workflow) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO workflow (id, board_id, name, created_at, updated_at, revision, runtime_values, workflow_folder, files)
		VALUES ($1, $2, $3, $4, $5, $6, coalesce(nullif($7, '')::jsonb, '{}'::jsonb), $8, coalesce($9::text[], '{}'))`,
		workflow.ID, workflow.BoardID, workflow.Name,
		workflow.CreatedAt, workflow.UpdatedAt, workflow.Revision, workflow.Values,
		workflow.WorkflowFolder, workflow.Files)
	return translate(err, fmt.Sprintf("workflow %q", workflow.Name))
}

func (s *BoardStore) FindWorkflow(ctx context.Context, id string) (*entities.Workflow, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+workflowColumns+` FROM workflow WHERE id::text = $1`, id)
	workflow, err := scanWorkflow(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("workflow %s", id))
	}
	return workflow, nil
}

func (s *BoardStore) ListWorkflows(ctx context.Context, boardID string) ([]entities.Workflow, error) {
	// By id, like the flow nodes: the board draws them round whatever they hold, in no order of
	// their own.
	rows, err := s.pool.Query(ctx, `SELECT `+workflowColumns+` FROM workflow
		WHERE board_id::text = $1
		ORDER BY id`, boardID)
	if err != nil {
		return nil, translate(err, "the workflows")
	}
	defer rows.Close()
	out := []entities.Workflow{}
	for rows.Next() {
		workflow, err := scanWorkflow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *workflow)
	}
	return out, rows.Err()
}

func (s *BoardStore) PatchWorkflow(ctx context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error) {
	set := newAssignments()
	if patch.Name != nil {
		set.add("name", *patch.Name)
	}
	if patch.WorkflowFolder != nil {
		set.add("workflow_folder", *patch.WorkflowFolder)
	}
	if patch.Files != nil {
		set.add("files", patch.Files)
	}
	if patch.ChangesValues() {
		values := patch.SetValues
		if values == nil {
			values = map[string]json.RawMessage{}
		}
		set.addExpr(`runtime_values = (runtime_values - coalesce(%s::text[], '{}')) || %s::jsonb`,
			patch.RemoveValues, values)
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var workflow *entities.Workflow
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("workflow", "id::text = ", id, expected)
		row := tx.QueryRow(ctx, sql+` RETURNING `+workflowColumns, args...)
		found, err := scanWorkflow(row)
		if err != nil {
			return s.missed(ctx, err, "workflow", "id::text = ", id, expected)
		}
		workflow = found
		return nil
	})
	return workflow, err
}

func (s *BoardStore) DeleteWorkflows(ctx context.Context, ids []string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		// One statement for the lot. The flow nodes are ungrouped by the schema — the foreign key
		// is ON DELETE SET NULL — rather than here, so a rectangle removed by hand in SQL
		// leaves no flow node pointing at nothing either.
		tag, err := tx.Exec(ctx, `DELETE FROM workflow WHERE id::text = ANY($1)`, ids)
		if err != nil {
			return translate(err, "the workflows")
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("none of those workflows")
		}
		return nil
	})
}
