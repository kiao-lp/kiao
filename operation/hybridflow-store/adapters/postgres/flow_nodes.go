package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"kiao/hybridflow-store/core/entities"
)

// The cards. Everything here is a statement about one row or about a named set of rows: nothing
// reads a board to write a card.

// flowNodeColumns is the select list: the card, its task and its tags in one row.
//
// The **task is a LEFT JOIN** and not an inner one, because two of the four kinds have none: a
// Shutdown and a Scheduler come back with every one of `k`'s columns NULL, and that is how the
// reader below knows there is no task rather than an empty one. `k.flow_node_id` leads the block so
// the answer to "is this a task at all?" is the first thing scanned and not inferred from a
// coalesced value that an empty task would give too.
//
// The tags stay a correlated subquery rather than a second join with a GROUP BY, so that one card
// and a whole board are read by the same SQL — a GROUP BY over every column of both tables is a
// great deal of work to say "and its tags".
const flowNodeColumns = `t.id, t.board_id, t.title, t.type, coalesce(t.note, ''), coalesce(t.value::text, '{}'),
	t.status, coalesce(t.scheduled_at, ''), coalesce(t.duration, ''), t.spot_x, t.spot_y,
	coalesce(t.on_success_flow_node_id::text, ''),
	coalesce(t.run_id, ''), t.claimed_at,
	coalesce(t.class_version_id::text, ''),
	cv.flow_node_class_id::text, cc.title, cv.version_number,
	coalesce(t.workflow_id::text, ''),
	t.created_at, t.updated_at, t.revision, t.archived,
	k.flow_node_id, k.body, k.criteria, k.complexity,
	coalesce(k.agent, ''), coalesce(k.model, ''), coalesce(k.effort, ''),
	coalesce(k.permission, ''), coalesce(k.folder, ''), coalesce(k.runner, ''), k.settings_extra,
	coalesce(k.conversation_id, ''), k.on_success_mode, k.on_success_compact,
	(SELECT coalesce(array_agg(g.tag ORDER BY g.ordinal), '{}')
	   FROM flow_node_tag g WHERE g.flow_node_id = t.id),
	(SELECT coalesce(array_agg(s.successor_id::text ORDER BY s.ordinal), '{}')
	   FROM flow_node_successor s WHERE s.flow_node_id = t.id)`

// criterionJSON is one success criterion as the task row holds it: the pair the editor added,
// under the keys the wire uses.
type criterionJSON struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// encodeCriteria writes the criteria a task holds. An empty list is `[]` and not null, so a
// task with nothing to measure against reads back as one.
func encodeCriteria(criteria []entities.SuccessCriterion) ([]byte, error) {
	out := make([]criterionJSON, 0, len(criteria))
	for _, criterion := range criteria {
		out = append(out, criterionJSON{ID: criterion.ID, Text: criterion.Text})
	}
	return jsonBytes(out)
}

// decodeCriteria reads the criteria a task row holds, forgivingly: anything unreadable is no
// criteria rather than a card that will not open.
func decodeCriteria(raw []byte) []entities.SuccessCriterion {
	var held []criterionJSON
	decodeInto(raw, &held)
	said := make([]entities.SuccessCriterion, 0, len(held))
	for _, criterion := range held {
		said = append(said, entities.SuccessCriterion{ID: criterion.ID, Text: criterion.Text})
	}
	return entities.ReadSuccessCriteria(said)
}

// flowNodeFrom is the one FROM every read of a card uses. `k` is the task, which may not be
// there; `cv` is the class version the card was instantiated from, and `cc` its class — both
// absent for a card made by hand.
const flowNodeFrom = ` FROM flow_node t LEFT JOIN task k ON k.flow_node_id = t.id
	LEFT JOIN flow_node_class_version cv ON cv.id = t.class_version_id
	LEFT JOIN flow_node_class cc ON cc.id = cv.flow_node_class_id`

func scanFlowNode(row pgx.Row) (*entities.FlowNode, error) {
	var (
		flowNode   entities.FlowNode
		task       entities.Task
		taskID     *string
		body       *string
		criteria   []byte
		complexity *int
		extra      []byte
		mode       *string
		compact    *bool
		spotX      *int
		spotY      *int
		claimedAt  *time.Time
		tags       []string
		nexts      []string
	)
	var (
		classID    *string
		classTitle *string
		versionNum *int
	)
	err := row.Scan(&flowNode.ID, &flowNode.BoardID, &flowNode.Title, &flowNode.Type, &flowNode.Note, &flowNode.Value,
		&flowNode.Status, &flowNode.ScheduledAt, &flowNode.Duration, &spotX, &spotY, &flowNode.Next,
		&flowNode.RunID, &claimedAt,
		&flowNode.ClassVersionID, &classID, &classTitle, &versionNum,
		&flowNode.WorkflowID,
		&flowNode.CreatedAt, &flowNode.UpdatedAt, &flowNode.Revision, &flowNode.Archived,
		&taskID, &body, &criteria, &complexity,
		&task.Settings.Agent, &task.Settings.Model, &task.Settings.Effort,
		&task.Settings.Permission, &task.Settings.Folder, &task.Settings.Runner, &extra,
		&task.ConversationID, &mode, &compact, &tags, &nexts)
	if err != nil {
		return nil, err
	}
	if taskID != nil {
		task.Body = stringOr(body)
		task.Criteria = decodeCriteria(criteria)
		task.Complexity = entities.ReadComplexity(complexity)
		task.Settings.Extra = jsonMap(extra)
		task.Transition = entities.Transition{
			Mode: entities.TransitionMode(stringOr(mode)), Compact: compact != nil && *compact,
		}
		flowNode.Task = &task
	}
	if spotX != nil && spotY != nil {
		flowNode.Spot = &entities.Spot{X: *spotX, Y: *spotY}
	}
	if claimedAt != nil {
		flowNode.ClaimedAt = *claimedAt
	}
	// Resolved at the read, so a class renamed after its instances were made is still named
	// right on them. Absent where the flow node names none, or where the version has gone.
	if flowNode.ClassVersionID != "" && classID != nil && classTitle != nil && versionNum != nil {
		flowNode.ClassRef = &entities.ClassRef{
			ClassID: *classID, ClassTitle: *classTitle,
			VersionID: flowNode.ClassVersionID, VersionNumber: *versionNum,
		}
	}
	flowNode.Tags = tags
	flowNode.Nexts = nexts
	return &flowNode, nil
}

func stringOr(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *BoardStore) CreateFlowNodes(ctx context.Context, flowNodes []*entities.FlowNode, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		// A pasted chain names a card of its own batch, which is not there yet when the card naming
		// it goes in. The chain's foreign key is declared DEFERRABLE for exactly this, and this is
		// the one place that asks for the deferral: the batch is checked when it commits, as a
		// whole, so a paste does not depend on the order its cards happen to arrive in.
		if _, err := tx.Exec(ctx, `SET CONSTRAINTS ALL DEFERRED`); err != nil {
			return translate(err, "the cards")
		}
		for _, flowNode := range flowNodes {
			var spotX, spotY *int
			if flowNode.Spot != nil {
				spotX, spotY = &flowNode.Spot.X, &flowNode.Spot.Y
			}
			valueJSON := flowNode.Value
			if valueJSON == "" {
				valueJSON = "{}"
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO flow_node (id, board_id, title, type, note, value, status, scheduled_at,
					spot_x, spot_y, on_success_flow_node_id, class_version_id, workflow_id,
					created_at, updated_at, revision, duration, archived)
				VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, nullif($8, ''), $9, $10, nullif($11, '')::uuid,
					nullif($12, '')::uuid, nullif($13, '')::uuid, $14, $15, $16, nullif($17, ''), $18)`,
				flowNode.ID, flowNode.BoardID, flowNode.Title, string(flowNode.Type), flowNode.Note, valueJSON,
				string(flowNode.Status), flowNode.ScheduledAt, spotX, spotY, flowNode.Next,
				flowNode.ClassVersionID, flowNode.WorkflowID,
				flowNode.CreatedAt, flowNode.UpdatedAt, flowNode.Revision, flowNode.Duration, flowNode.Archived)
			if err != nil {
				return translate(err, fmt.Sprintf("card %q", flowNode.Title))
			}
			if err := writeTask(ctx, tx, flowNode); err != nil {
				return err
			}
			if err := writeTags(ctx, tx, flowNode.ID, flowNode.Tags); err != nil {
				return err
			}
			if err := writeSuccessors(ctx, tx, flowNode.ID, flowNode.Nexts); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *BoardStore) FindFlowNode(ctx context.Context, id string) (*entities.FlowNode, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+` WHERE t.id::text = $1`, id)
	flowNode, err := scanFlowNode(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("card %s", id))
	}
	return flowNode, nil
}

func (s *BoardStore) ListFlowNodes(ctx context.Context, boardID string) ([]entities.FlowNode, error) {
	// By id: a board is a set of cards, and the editor lays them out by their spots. The id is
	// what makes the order total and stable.
	rows, err := s.pool.Query(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+`
		WHERE t.board_id::text = $1
		ORDER BY t.id`, boardID)
	if err != nil {
		return nil, translate(err, "the cards")
	}
	defer rows.Close()
	out := []entities.FlowNode{}
	for rows.Next() {
		flowNode, err := scanFlowNode(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *flowNode)
	}
	return out, rows.Err()
}

// flowNodeAssignments is the card's own half of the patch as SQL. The tags and the task are not in
// it — they are rows of other tables — so they are written separately, inside the same transaction.
func flowNodeAssignments(patch entities.FlowNodePatch) *assignments {
	set := newAssignments()
	if patch.Title != nil {
		set.add("title", *patch.Title)
	}
	if patch.Note != nil {
		set.add("note", *patch.Note)
	}
	if patch.Value != nil {
		valueJSON := *patch.Value
		if valueJSON == "" {
			valueJSON = "{}"
		}
		set.addExpr("value = %s::jsonb", valueJSON)
	}
	if patch.Type != nil {
		set.add("type", string(*patch.Type))
	}
	if patch.Status != nil {
		set.add("status", string(*patch.Status))
	}
	if patch.Archived != nil {
		set.add("archived", *patch.Archived)
	}
	if patch.ScheduledAt != nil {
		set.addExpr("scheduled_at = nullif(%s, '')", *patch.ScheduledAt)
	}
	if patch.Duration != nil {
		set.addExpr("duration = nullif(%s, '')", *patch.Duration)
	}
	if patch.Next != nil {
		set.addExpr("on_success_flow_node_id = nullif(%s, '')::uuid", *patch.Next)
	}
	if patch.ClassVersionID != nil {
		set.addExpr("class_version_id = nullif(%s, '')::uuid", *patch.ClassVersionID)
	}
	if patch.WorkflowID != nil {
		set.addExpr("workflow_id = nullif(%s, '')::uuid", *patch.WorkflowID)
	}
	if patch.Spot != nil {
		set.add("spot_x", patch.Spot.X)
		set.add("spot_y", patch.Spot.Y)
	}
	if patch.ClearSpot {
		set.raw("spot_x = NULL, spot_y = NULL")
	}
	return set
}

// taskAssignments is the task's half of the same patch. The service has already dropped these for a
// card that is not one, so anything here is going onto a row that exists or is about to.
func taskAssignments(patch entities.FlowNodePatch) (*assignments, error) {
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
	if patch.Complexity != nil {
		// Read again at the write: anything outside the suite is no complexity at all, which
		// takes it off rather than refusing the patch.
		var complexity any
		if read := entities.ReadComplexity(patch.Complexity); read != nil {
			complexity = *read
		}
		set.add("complexity", complexity)
	}
	if patch.ClearComplexity {
		set.raw("complexity = NULL")
	}
	if patch.Settings != nil {
		extra, err := jsonBytes(patch.Settings.Extra)
		if err != nil {
			return nil, err
		}
		set.addExpr("agent = nullif(%s, '')", patch.Settings.Agent)
		set.addExpr("model = nullif(%s, '')", patch.Settings.Model)
		set.addExpr("effort = nullif(%s, '')", patch.Settings.Effort)
		set.addExpr("permission = nullif(%s, '')", patch.Settings.Permission)
		set.addExpr("folder = nullif(%s, '')", patch.Settings.Folder)
		set.addExpr("runner = nullif(%s, '')", patch.Settings.Runner)
		set.add("settings_extra", extra)
	}
	if patch.ConversationID != nil {
		set.addExpr("conversation_id = nullif(%s, '')", *patch.ConversationID)
	}
	if patch.Transition != nil {
		set.add("on_success_mode", string(patch.Transition.Mode))
		set.add("on_success_compact", patch.Transition.Compact)
	}
	return set, nil
}

// PatchFlowNode writes a card and its task as one change.
//
// **The revision is the card's, task included.** The conditional update is on `flow_node` alone —
// the task carries no revision, because a task and its flow node are one card to everything that
// reads a board — and both writes are in one transaction, so a patch refused for a stale revision
// takes the task's half back with it. A patch that touches only the task stamps the card all the
// same, exactly as a tags-only patch does: nothing else would tell a client the card moved.
func (s *BoardStore) PatchFlowNode(ctx context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error) {
	set := flowNodeAssignments(patch)
	task, err := taskAssignments(patch)
	if err != nil {
		return nil, err
	}
	if set.empty() && task.empty() && patch.Tags == nil && patch.Nexts == nil {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if set.empty() {
		// The tags, the branches or the task alone: the card itself still has to be stamped, or
		// nothing tells a client it changed — none of those tables has a revision of its own.
		set.raw("title = title")
	}
	var flowNode *entities.FlowNode
	err = inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		if patch.Tags != nil {
			if err := writeTags(ctx, tx, id, *patch.Tags); err != nil {
				return err
			}
		}
		if patch.Nexts != nil {
			if err := writeSuccessors(ctx, tx, id, *patch.Nexts); err != nil {
				return err
			}
		}
		// **The card's own row first.** It is the conditional write, so a card that has gone or has
		// moved under the caller is answered as what it is — a 404 or a 409 — rather than as a
		// foreign key refusing a task for a flow node that is not there.
		if err := s.stampFlowNodeIn(ctx, tx, id, set, expected); err != nil {
			return err
		}
		// Then the type's consequence: a card that has just become an AI or a Human one is given an
		// empty task for the assignments below to land on, and one that has just become a Shutdown
		// or a Scheduler gives its task up in the same transaction.
		if patch.Type != nil {
			if err := retypeTask(ctx, tx, id, *patch.Type); err != nil {
				return err
			}
		}
		if !task.empty() {
			sql, args := task.update("task", "flow_node_id::text = ", id, nil)
			if _, err := tx.Exec(ctx, sql, args...); err != nil {
				return translate(err, fmt.Sprintf("the task of card %s", id))
			}
		}
		found, err := readFlowNodeIn(ctx, tx, id)
		flowNode = found
		return err
	})
	return flowNode, err
}

// retypeTask keeps the task row in step with the card's kind: one exists for an AI or a Human card
// and none for the other two. `ON CONFLICT DO NOTHING` because a card retyped between the two kinds
// of task keeps the task it had — the description and the folder are still the same work — while a
// card coming back from Shutdown gets a fresh, empty one.
func retypeTask(ctx context.Context, tx pgx.Tx, id string, flowNodeType entities.FlowNodeType) error {
	statement := `DELETE FROM task WHERE flow_node_id::text = $1`
	if flowNodeType.IsTask() {
		statement = `INSERT INTO task (flow_node_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING`
	}
	if _, err := tx.Exec(ctx, statement, id); err != nil {
		return translate(err, fmt.Sprintf("the task of card %s", id))
	}
	return nil
}

// writeTask files the task of a card that has one, and nothing at all for a card that has not.
func writeTask(ctx context.Context, tx pgx.Tx, flowNode *entities.FlowNode) error {
	if flowNode.Task == nil {
		return nil
	}
	extra, err := jsonBytes(flowNode.Task.Settings.Extra)
	if err != nil {
		return err
	}
	criteria, err := encodeCriteria(flowNode.Task.Criteria)
	if err != nil {
		return err
	}
	var complexity any
	if read := entities.ReadComplexity(flowNode.Task.Complexity); read != nil {
		complexity = *read
	}
	settings := flowNode.Task.Settings
	_, err = tx.Exec(ctx, `
		INSERT INTO task (flow_node_id, body, criteria, complexity, agent, model, effort,
			permission, folder, runner, settings_extra, conversation_id, on_success_mode, on_success_compact)
		VALUES ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, ''),
			nullif($9, ''), nullif($10, ''), $11, nullif($12, ''), $13, $14)`,
		flowNode.ID, flowNode.Task.Body, criteria, complexity,
		settings.Agent, settings.Model, settings.Effort, settings.Permission, settings.Folder,
		settings.Runner,
		extra, flowNode.Task.ConversationID,
		string(flowNode.Task.Transition.Mode), flowNode.Task.Transition.Compact)
	if err != nil {
		return translate(err, fmt.Sprintf("the task of card %q", flowNode.Title))
	}
	return nil
}

// stampFlowNodeIn writes the card's own row, conditionally where a revision was given.
func (s *BoardStore) stampFlowNodeIn(ctx context.Context, tx pgx.Tx, id string, set *assignments, expected *int64) error {
	sql, args := set.update("flow_node", "id::text = ", id, expected)
	// **The row count is the answer.** A revision-checked update either matches its row or matches
	// nothing, and nothing is what a stale caller gets — asked about below, so that "it has moved"
	// and "it is gone" come back as the two different things they are.
	tag, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return translate(err, fmt.Sprintf("card %s", id))
	}
	if tag.RowsAffected() == 0 {
		return whyNoRows(ctx, s.pool, "flow_node", "id::text = ", id, expected)
	}
	return nil
}

// readFlowNodeIn reads a card back inside the transaction that wrote it, so what comes out is what
// was written. RETURNING cannot do it: the tag subquery and the task's join both name `t`.
func readFlowNodeIn(ctx context.Context, tx pgx.Tx, id string) (*entities.FlowNode, error) {
	flowNode, err := scanFlowNode(tx.QueryRow(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+` WHERE t.id::text = $1`, id))
	if err != nil {
		return nil, translate(err, fmt.Sprintf("card %s", id))
	}
	return flowNode, nil
}

func (s *BoardStore) DeleteFlowNodes(ctx context.Context, ids []string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		// One statement for the lot: a paste of six cards undone is one change to the board, and a
		// delete that took six statements could be interrupted after three.
		tag, err := tx.Exec(ctx, `DELETE FROM flow_node WHERE id::text = ANY($1)`, ids)
		if err != nil {
			return translate(err, "the cards")
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("none of those cards")
		}
		return nil
	})
}

// ── the claim ─────────────────────────────────────────────────────────────────

// ClaimFlowNode is the one invariant this adapter enforces rather than the service: **a flow node
// is played by one run**. It is a single conditional update, so two runs reaching for one card at
// the same instant are two statements of which exactly one matches a row.
func (s *BoardStore) ClaimFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string) (*entities.FlowNode, error) {
	var flowNode *entities.FlowNode
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		// Free and ready, **or already this run's**: a run coming back to its own card after a wait
		// is not a second claimant. `claimed_at` is left as it was in that case, so the card still
		// says when the play took it rather than when it last retried.
		tag, err := tx.Exec(ctx, `
			UPDATE flow_node
			   SET run_id = $2,
			       claimed_at = coalesce(claimed_at, now()),
			       status = $3
			 WHERE id::text = $1
			   AND ((run_id IS NULL AND status = 'ready') OR run_id = $2)`,
			id, runID, string(status))
		if err != nil {
			return translate(err, fmt.Sprintf("card %s", id))
		}
		if tag.RowsAffected() == 0 {
			// Absent, or held, or standing somewhere other than ready — and the client is told
			// which, because "somebody else is playing it" and "it is not there" are different
			// things to see on a board.
			held, err := readFlowNodeIn(ctx, tx, id)
			if err != nil {
				return entities.NotFoundf("card %s", id)
			}
			if held.RunID != "" {
				return fmt.Errorf("%w: run %s has it", entities.ErrFlowNodeHeld, held.RunID)
			}
			return fmt.Errorf("%w: the card stands at %q", entities.ErrInvalid, held.Status)
		}
		flowNode, err = readFlowNodeIn(ctx, tx, id)
		return err
	})
	return flowNode, err
}

// ReleaseFlowNode hands the card back, and refuses a release by a run that does not hold it: a run
// that was stopped and whose turn came back late must not mark a card somebody else is now playing.
func (s *BoardStore) ReleaseFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string) (*entities.FlowNode, error) {
	var flowNode *entities.FlowNode
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE flow_node SET run_id = NULL, claimed_at = NULL, status = $3
			WHERE id::text = $1 AND run_id = $2`, id, runID, string(status))
		if err != nil {
			return translate(err, fmt.Sprintf("card %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.Conflictf("card %s is not held by run %s", id, runID)
		}
		flowNode, err = readFlowNodeIn(ctx, tx, id)
		return err
	})
	return flowNode, err
}

// ReleaseRun frees every card a run still holds. What a restart calls.
func (s *BoardStore) ReleaseRun(ctx context.Context, runID string, status entities.FlowNodeStatus, actor string) (int, error) {
	var settled int
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE flow_node SET run_id = NULL, claimed_at = NULL, status = $2
			WHERE run_id = $1`, runID, string(status))
		if err != nil {
			return translate(err, fmt.Sprintf("the cards held by run %s", runID))
		}
		settled = int(tag.RowsAffected())
		return nil
	})
	return settled, err
}

func (s *BoardStore) HeldFlowNodes(ctx context.Context, runID string) ([]entities.FlowNode, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+` WHERE t.run_id = $1
		ORDER BY t.claimed_at`, runID)
	if err != nil {
		return nil, translate(err, "the held cards")
	}
	defer rows.Close()
	out := []entities.FlowNode{}
	for rows.Next() {
		flowNode, err := scanFlowNode(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *flowNode)
	}
	return out, rows.Err()
}

// writeSuccessors replaces a Gateway's branches. Delete and insert rather than a difference, for
// the reason the tags are: the list is rewritten whole, and working out which branch changed would
// be more code than rewriting the rows.
func writeSuccessors(ctx context.Context, tx pgx.Tx, flowNodeID string, nexts []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM flow_node_successor WHERE flow_node_id::text = $1`, flowNodeID); err != nil {
		return translate(err, "the branches")
	}
	for i, next := range nexts {
		_, err := tx.Exec(ctx,
			`INSERT INTO flow_node_successor (flow_node_id, successor_id, ordinal) VALUES ($1::uuid, $2::uuid, $3)`,
			flowNodeID, next, i)
		if err != nil {
			return translate(err, fmt.Sprintf("branch %q", next))
		}
	}
	return nil
}

// writeTags replaces a card's tags. Delete and insert rather than a difference: a tag list is a
// handful of words rewritten whole by the one editor that touches it, and working out which two
// changed would be more code than rewriting three rows.
func writeTags(ctx context.Context, tx pgx.Tx, flowNodeID string, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM flow_node_tag WHERE flow_node_id::text = $1`, flowNodeID); err != nil {
		return translate(err, "the tags")
	}
	for i, tag := range tags {
		_, err := tx.Exec(ctx,
			`INSERT INTO flow_node_tag (flow_node_id, tag, ordinal) VALUES ($1::uuid, $2, $3)`, flowNodeID, tag, i)
		if err != nil {
			return translate(err, fmt.Sprintf("tag %q", tag))
		}
	}
	return nil
}
