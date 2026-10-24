package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// The node classes. One row per class beside the board's cards, one row per version beneath
// it, and the tags the class is filed under — the same shape the cards are read in, and for
// the same reason: one class is one thing to edit, to chain and to make a write conditional on.

var _ ports.ClassRepository = (*BoardStore)(nil)

// classColumns is the select list: the class and its tags in one row.
const classColumns = `c.id, c.board_id, c.title, c.instantiable, c.type,
	coalesce(c.scheduled_at, ''), coalesce(c.duration, ''), c.spot_x, c.spot_y,
	coalesce(c.on_success_flow_node_class_id::text, ''),
	coalesce(c.permission, ''), coalesce(c.runner, ''),
	c.on_success_mode, c.on_success_compact, c.note,
	coalesce(c.workflow_class_id::text, ''),
	c.created_at, c.updated_at, c.revision,
	(SELECT coalesce(array_agg(g.tag ORDER BY g.ordinal), '{}')
	   FROM flow_node_class_tag g WHERE g.flow_node_class_id = c.id)`

const classFrom = ` FROM flow_node_class c`

func scanClass(row pgx.Row) (*entities.FlowNodeClass, error) {
	var (
		class entities.FlowNodeClass
		spotX *int
		spotY *int
		mode  string
	)
	err := row.Scan(&class.ID, &class.BoardID, &class.Title, &class.Instantiable, &class.Type,
		&class.ScheduledAt, &class.Duration, &spotX, &spotY, &class.Next,
		&class.Permission, &class.Runner, &mode, &class.Transition.Compact, &class.Note,
		&class.WorkflowClassID,
		&class.CreatedAt, &class.UpdatedAt, &class.Revision, &class.Tags)
	if err != nil {
		return nil, err
	}
	class.Transition.Mode = entities.TransitionMode(mode)
	if spotX != nil && spotY != nil {
		class.Spot = &entities.Spot{X: *spotX, Y: *spotY}
	}
	return &class, nil
}

const versionColumns = `v.id, v.flow_node_class_id, v.version_number, v.body, v.criteria,
	v.is_template, coalesce(v.agent, ''), v.status, v.created_at, v.updated_at, v.revision`

const versionFrom = ` FROM flow_node_class_version v`

func scanVersion(row pgx.Row) (*entities.FlowNodeClassVersion, error) {
	var (
		version  entities.FlowNodeClassVersion
		criteria []byte
	)
	err := row.Scan(&version.ID, &version.ClassID, &version.Number, &version.Body, &criteria,
		&version.IsTemplate, &version.Agent, &version.Status, &version.CreatedAt, &version.UpdatedAt, &version.Revision)
	if err != nil {
		return nil, err
	}
	version.Criteria = decodeCriteria(criteria)
	return &version, nil
}

func (s *BoardStore) CreateClass(ctx context.Context, class *entities.FlowNodeClass, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		var spotX, spotY *int
		if class.Spot != nil {
			spotX, spotY = &class.Spot.X, &class.Spot.Y
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO flow_node_class (id, board_id, title, instantiable, type, scheduled_at,
				spot_x, spot_y, on_success_flow_node_class_id,
				permission, runner, on_success_mode, on_success_compact, note, workflow_class_id,
				created_at, updated_at, revision, duration)
			VALUES ($1, $2, $3, $4, $5, nullif($6, ''), $7, $8, nullif($9, '')::uuid,
				nullif($10, ''), nullif($11, ''), $12, $13, $14, nullif($15, '')::uuid,
				$16, $17, $18, nullif($19, ''))`,
			class.ID, class.BoardID, class.Title, class.Instantiable, string(class.Type), class.ScheduledAt,
			spotX, spotY, class.Next,
			class.Permission, class.Runner,
			string(class.Transition.Mode), class.Transition.Compact, class.Note, class.WorkflowClassID,
			class.CreatedAt, class.UpdatedAt, class.Revision, class.Duration)
		if err != nil {
			return translate(err, fmt.Sprintf("node class %q", class.Title))
		}
		return writeClassTags(ctx, tx, class.ID, class.Tags)
	})
}

func (s *BoardStore) FindClass(ctx context.Context, id string) (*entities.FlowNodeClass, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+classColumns+classFrom+` WHERE c.id::text = $1`, id)
	class, err := scanClass(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("node class %s", id))
	}
	return class, nil
}

func (s *BoardStore) ListClasses(ctx context.Context, boardID string) ([]entities.FlowNodeClass, error) {
	// By id, like the cards: a board is a set of cards, and the editor lays them out by their
	// spots.
	rows, err := s.pool.Query(ctx, `SELECT `+classColumns+classFrom+`
		WHERE c.board_id::text = $1
		ORDER BY c.id`, boardID)
	if err != nil {
		return nil, translate(err, "the node classes")
	}
	defer rows.Close()
	out := []entities.FlowNodeClass{}
	for rows.Next() {
		class, err := scanClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *class)
	}
	return out, rows.Err()
}

func (s *BoardStore) ListAllClasses(ctx context.Context) ([]entities.FlowNodeClass, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+classColumns+classFrom+`
		ORDER BY c.board_id, c.id`)
	if err != nil {
		return nil, translate(err, "the node classes")
	}
	defer rows.Close()
	out := []entities.FlowNodeClass{}
	for rows.Next() {
		class, err := scanClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *class)
	}
	return out, rows.Err()
}

// classAssignments is the class's own half of the patch as SQL. The tags are rows of another
// table and are written separately, inside the same transaction.
func classAssignments(patch entities.FlowNodeClassPatch) *assignments {
	set := newAssignments()
	if patch.Title != nil {
		set.add("title", *patch.Title)
	}
	if patch.Instantiable != nil {
		set.add("instantiable", *patch.Instantiable)
	}
	if patch.Type != nil {
		set.add("type", string(*patch.Type))
	}
	if patch.ScheduledAt != nil {
		set.addExpr("scheduled_at = nullif(%s, '')", *patch.ScheduledAt)
	}
	if patch.Duration != nil {
		set.addExpr("duration = nullif(%s, '')", *patch.Duration)
	}
	if patch.Next != nil {
		set.addExpr("on_success_flow_node_class_id = nullif(%s, '')::uuid", *patch.Next)
	}
	if patch.Spot != nil {
		set.add("spot_x", patch.Spot.X)
		set.add("spot_y", patch.Spot.Y)
	}
	if patch.ClearSpot {
		set.raw("spot_x = NULL, spot_y = NULL")
	}
	if patch.Permission != nil {
		set.addExpr("permission = nullif(%s, '')", *patch.Permission)
	}
	if patch.Runner != nil {
		set.addExpr("runner = nullif(%s, '')", *patch.Runner)
	}
	if patch.Transition != nil {
		set.add("on_success_mode", string(patch.Transition.Mode))
		set.add("on_success_compact", patch.Transition.Compact)
	}
	if patch.Note != nil {
		set.add("note", *patch.Note)
	}
	if patch.WorkflowClassID != nil {
		set.addExpr("workflow_class_id = nullif(%s, '')::uuid", *patch.WorkflowClassID)
	}
	return set
}

func (s *BoardStore) PatchClass(ctx context.Context, id string, patch entities.FlowNodeClassPatch, expected *int64, actor string) (*entities.FlowNodeClass, error) {
	set := classAssignments(patch)
	if set.empty() && patch.Tags == nil {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if set.empty() {
		// The tags alone: the class still has to be stamped, or nothing tells a client it
		// changed — the tag table has no revision of its own.
		set.raw("title = title")
	}
	var class *entities.FlowNodeClass
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		if patch.Tags != nil {
			if err := writeClassTags(ctx, tx, id, *patch.Tags); err != nil {
				return err
			}
		}
		sql, args := set.update("flow_node_class", "id::text = ", id, expected)
		tag, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return translate(err, fmt.Sprintf("node class %s", id))
		}
		if tag.RowsAffected() == 0 {
			return whyNoRows(ctx, s.pool, "flow_node_class", "id::text = ", id, expected)
		}
		found, err := scanClass(tx.QueryRow(ctx,
			`SELECT `+classColumns+classFrom+` WHERE c.id::text = $1`, id))
		if err != nil {
			return translate(err, fmt.Sprintf("node class %s", id))
		}
		class = found
		return nil
	})
	return class, err
}

func (s *BoardStore) DeleteClasses(ctx context.Context, ids []string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM flow_node_class WHERE id::text = ANY($1)`, ids)
		if err != nil {
			return translate(err, "the node classes")
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("none of those node classes")
		}
		return nil
	})
}

func writeClassTags(ctx context.Context, tx pgx.Tx, id string, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM flow_node_class_tag WHERE flow_node_class_id::text = $1`, id); err != nil {
		return translate(err, fmt.Sprintf("the tags of node class %s", id))
	}
	for ordinal, tag := range tags {
		if _, err := tx.Exec(ctx,
			`INSERT INTO flow_node_class_tag (flow_node_class_id, tag, ordinal) VALUES ($1::uuid, $2, $3)`,
			id, tag, ordinal); err != nil {
			return translate(err, fmt.Sprintf("the tags of node class %s", id))
		}
	}
	return nil
}

// ── versions ──────────────────────────────────────────────────────────────────

func (s *BoardStore) CreateVersion(ctx context.Context, version *entities.FlowNodeClassVersion, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		criteria, err := encodeCriteria(version.Criteria)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO flow_node_class_version (id, flow_node_class_id, version_number, body,
				criteria, is_template, agent, status, created_at, updated_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, nullif($7, ''), $8, $9, $10, $11)`,
			version.ID, version.ClassID, version.Number, version.Body,
			criteria, version.IsTemplate, version.Agent, string(version.Status),
			version.CreatedAt, version.UpdatedAt, version.Revision)
		if err != nil {
			return translate(err, fmt.Sprintf("version %d of node class %s", version.Number, version.ClassID))
		}
		return nil
	})
}

func (s *BoardStore) FindVersion(ctx context.Context, id string) (*entities.FlowNodeClassVersion, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+versionColumns+versionFrom+` WHERE v.id::text = $1`, id)
	version, err := scanVersion(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("node class version %s", id))
	}
	return version, nil
}

func (s *BoardStore) ListVersions(ctx context.Context, classID string) ([]entities.FlowNodeClassVersion, error) {
	// Oldest first: the succession is read in the order it was written.
	rows, err := s.pool.Query(ctx, `SELECT `+versionColumns+versionFrom+`
		WHERE v.flow_node_class_id::text = $1
		ORDER BY v.version_number`, classID)
	if err != nil {
		return nil, translate(err, "the node class versions")
	}
	defer rows.Close()
	out := []entities.FlowNodeClassVersion{}
	for rows.Next() {
		version, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *version)
	}
	return out, rows.Err()
}

func (s *BoardStore) PatchVersion(ctx context.Context, id string, patch entities.FlowNodeClassVersionPatch, expected *int64, actor string) (*entities.FlowNodeClassVersion, error) {
	set := newAssignments()
	if patch.Body != nil {
		set.add("body", *patch.Body)
	}
	if patch.Criteria != nil {
		encoded, err := encodeCriteria(*patch.Criteria)
		if err != nil {
			return nil, err
		}
		set.add("criteria", encoded)
	}
	if patch.IsTemplate != nil {
		set.add("is_template", *patch.IsTemplate)
	}
	if patch.Agent != nil {
		set.addExpr("agent = nullif(%s, '')", *patch.Agent)
	}
	if patch.Status != nil {
		set.add("status", string(*patch.Status))
	}
	if set.empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	var version *entities.FlowNodeClassVersion
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		sql, args := set.update("flow_node_class_version", "id::text = ", id, expected)
		tag, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return translate(err, fmt.Sprintf("node class version %s", id))
		}
		if tag.RowsAffected() == 0 {
			return whyNoRows(ctx, s.pool, "flow_node_class_version", "id::text = ", id, expected)
		}
		found, err := scanVersion(tx.QueryRow(ctx,
			`SELECT `+versionColumns+versionFrom+` WHERE v.id::text = $1`, id))
		if err != nil {
			return translate(err, fmt.Sprintf("node class version %s", id))
		}
		version = found
		return nil
	})
	return version, err
}

func (s *BoardStore) DeleteVersion(ctx context.Context, id string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM flow_node_class_version WHERE id::text = $1`, id)
		if err != nil {
			return translate(err, fmt.Sprintf("node class version %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("node class version %s", id)
		}
		return nil
	})
}
