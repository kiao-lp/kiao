package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// The workflows and the workflow classes. One row per rectangle: a name round a set of cards,
// with no spot of its own — the bounds are computed from the cards that name it.

var _ ports.WorkflowRepository = (*BoardStore)(nil)

const workflowColumns = `id, board_id, name, created_at, updated_at, revision`

func scanWorkflow(row pgx.Row) (*entities.Workflow, error) {
	var workflow entities.Workflow
	if err := row.Scan(&workflow.ID, &workflow.BoardID, &workflow.Name,
		&workflow.CreatedAt, &workflow.UpdatedAt, &workflow.Revision); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func scanWorkflowClass(row pgx.Row) (*entities.WorkflowClass, error) {
	var workflow entities.WorkflowClass
	if err := row.Scan(&workflow.ID, &workflow.BoardID, &workflow.Name,
		&workflow.CreatedAt, &workflow.UpdatedAt, &workflow.Revision); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func (s *BoardStore) CreateWorkflow(ctx context.Context, workflow *entities.Workflow, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO workflow (id, board_id, name, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			workflow.ID, workflow.BoardID, workflow.Name,
			workflow.CreatedAt, workflow.UpdatedAt, workflow.Revision)
		if err != nil {
			return translate(err, fmt.Sprintf("workflow %q", workflow.Name))
		}
		return nil
	})
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
	// By id, like the cards: the board draws them round whatever they hold, in no order of
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
		// One statement for the lot. The cards are ungrouped by the schema — the foreign key
		// is ON DELETE SET NULL — rather than here, so a rectangle removed by hand in SQL
		// leaves no card pointing at nothing either.
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

func (s *BoardStore) CreateWorkflowClass(ctx context.Context, workflow *entities.WorkflowClass, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO workflow_class (id, board_id, name, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			workflow.ID, workflow.BoardID, workflow.Name,
			workflow.CreatedAt, workflow.UpdatedAt, workflow.Revision)
		if err != nil {
			return translate(err, fmt.Sprintf("workflow class %q", workflow.Name))
		}
		return nil
	})
}

func (s *BoardStore) FindWorkflowClass(ctx context.Context, id string) (*entities.WorkflowClass, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+workflowColumns+` FROM workflow_class WHERE id::text = $1`, id)
	workflow, err := scanWorkflowClass(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("workflow class %s", id))
	}
	return workflow, nil
}

func (s *BoardStore) ListWorkflowClasses(ctx context.Context, boardID string) ([]entities.WorkflowClass, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+workflowColumns+` FROM workflow_class
		WHERE board_id::text = $1
		ORDER BY id`, boardID)
	if err != nil {
		return nil, translate(err, "the workflow classes")
	}
	defer rows.Close()
	out := []entities.WorkflowClass{}
	for rows.Next() {
		workflow, err := scanWorkflowClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *workflow)
	}
	return out, rows.Err()
}

func (s *BoardStore) ListAllWorkflowClasses(ctx context.Context) ([]entities.WorkflowClass, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+workflowColumns+` FROM workflow_class
		ORDER BY board_id, id`)
	if err != nil {
		return nil, translate(err, "the workflow classes")
	}
	defer rows.Close()
	out := []entities.WorkflowClass{}
	for rows.Next() {
		workflow, err := scanWorkflowClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *workflow)
	}
	return out, rows.Err()
}

func (s *BoardStore) PatchWorkflowClass(ctx context.Context, id string, patch entities.WorkflowClassPatch, expected *int64, actor string) (*entities.WorkflowClass, error) {
	set := newAssignments()
	if patch.Name != nil {
		set.add("name", *patch.Name)
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var workflow *entities.WorkflowClass
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("workflow_class", "id::text = ", id, expected)
		row := tx.QueryRow(ctx, sql+` RETURNING `+workflowColumns, args...)
		found, err := scanWorkflowClass(row)
		if err != nil {
			return s.missed(ctx, err, "workflow_class", "id::text = ", id, expected)
		}
		workflow = found
		return nil
	})
	return workflow, err
}

func (s *BoardStore) DeleteWorkflowClasses(ctx context.Context, ids []string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM workflow_class WHERE id::text = ANY($1)`, ids)
		if err != nil {
			return translate(err, "the workflow classes")
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("none of those workflow classes")
		}
		return nil
	})
}
