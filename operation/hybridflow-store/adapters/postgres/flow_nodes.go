package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"kiao/hybridflow-store/core/entities"
)

// The flow nodes. Everything here is a statement about one row or about a named set of rows: nothing
// reads a board to write a flow node.

// flowNodeColumns is the select list: the flow node, its task and its tags in one row.
//
// The **task is a LEFT JOIN** and not an inner one, because two of the four kinds have none: a
// Shutdown and a Scheduler come back with every one of `k`'s columns NULL, and that is how the
// reader below knows there is no task rather than an empty one. `k.flow_node_id` leads the block so
// the answer to "is this a task at all?" is the first thing scanned and not inferred from a
// coalesced value that an empty task would give too.
//
// The tags stay a correlated subquery rather than a second join with a GROUP BY, so that one flow node
// and a whole board are read by the same SQL — a GROUP BY over every column of both tables is a
// great deal of work to say "and its tags".
const flowNodeColumns = `t.id, t.board_id, t.title, t.type, coalesce(t.note, ''), coalesce(t.value::text, '{}'), coalesce(t.value_type, ''), t.output_type, coalesce(t.output::text, ''),
	t.role_id, t.role_kind, t.role_people, t.role_description,
	t.status, coalesce(t.scheduled_at, ''), coalesce(t.duration, ''),
	coalesce(t.pull_request_id, ''), coalesce(t.pull_request_status, ''),
	coalesce(t.commit_id, ''), coalesce(t.commit_status, ''),
	t.limiter_max_passes, t.limiter_remaining_passes, t.spot_x, t.spot_y, t.size_w, t.size_h,
	coalesce(t.run_id, ''), t.claimed_at, t.completion,
	coalesce(t.workflow_id::text, ''),
	t.created_at, t.updated_at, t.revision, t.archived,
	k.flow_node_id, k.body, coalesce(k.multi_part_template, false), k.criteria, k.complexity,
	coalesce(k.agent, ''), coalesce(k.harness, ''), coalesce(k.profile_id, ''), coalesce(k.model, ''), coalesce(k.effort, ''),
	coalesce(k.permission, ''), coalesce(k.folder, ''), coalesce(k.runner, ''), k.settings_extra,
	coalesce(k.conversation_id, ''), k.on_success_mode, k.on_success_compact,
	(SELECT coalesce(array_agg(g.tag ORDER BY g.ordinal), '{}')
	   FROM flow_node_tag g WHERE g.flow_node_id = t.id),
	(SELECT coalesce(array_agg(s.successor_id::text ORDER BY s.ordinal), '{}')
	   FROM flow_node_successor s WHERE s.flow_node_id = t.id),
	(SELECT coalesce(jsonb_agg(jsonb_build_object('condition', r.condition, 'flowNode', r.successor_id)
	   ORDER BY r.ordinal), '[]') FROM flow_node_route r WHERE r.flow_node_id = t.id)`

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
// criteria rather than a flow node that will not open.
func decodeCriteria(raw []byte) []entities.SuccessCriterion {
	var held []criterionJSON
	decodeInto(raw, &held)
	said := make([]entities.SuccessCriterion, 0, len(held))
	for _, criterion := range held {
		said = append(said, entities.SuccessCriterion{ID: criterion.ID, Text: criterion.Text})
	}
	return entities.ReadSuccessCriteria(said)
}

const flowNodeFrom = ` FROM flow_node t LEFT JOIN task k ON k.flow_node_id = t.id`

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
		sizeW      *int
		sizeH      *int
		claimedAt  *time.Time
		tags       []string
		nexts      []string
	)
	err := row.Scan(&flowNode.ID, &flowNode.BoardID, &flowNode.Title, &flowNode.Type, &flowNode.Note, &flowNode.Value, &flowNode.ValueType, &flowNode.OutputType, &flowNode.Output,
		&flowNode.RoleID, &flowNode.RoleKind, &flowNode.People, &flowNode.Description,
		&flowNode.Status, &flowNode.ScheduledAt, &flowNode.Duration,
		&flowNode.PullRequestID, &flowNode.PullRequestStatus,
		&flowNode.CommitID, &flowNode.CommitStatus,
		&flowNode.MaxPasses, &flowNode.RemainingPasses, &spotX, &spotY, &sizeW, &sizeH,
		&flowNode.RunID, &claimedAt, &flowNode.Completion,
		&flowNode.WorkflowID,
		&flowNode.CreatedAt, &flowNode.UpdatedAt, &flowNode.Revision, &flowNode.Archived,
		&taskID, &body, &task.MultiPartTemplate, &criteria, &complexity,
		&task.Settings.Agent, &task.Settings.Harness, &task.Settings.ProfileID, &task.Settings.Model, &task.Settings.Effort,
		&task.Settings.Permission, &task.Settings.Folder, &task.Settings.Runner, &extra,
		&task.ConversationID, &mode, &compact, &tags, &nexts, &flowNode.Routes)
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
	if sizeW != nil {
		flowNode.Size = &entities.Size{W: *sizeW}
		if sizeH != nil {
			flowNode.Size.H = *sizeH
		}
	}
	if claimedAt != nil {
		flowNode.ClaimedAt = *claimedAt
	}
	flowNode.Tags = tags
	if flowNode.Type.Splits() {
		flowNode.Nexts = nexts
	} else if len(nexts) > 0 {
		flowNode.Next = nexts[0]
		// Keep malformed legacy branches visible to chain validation.
		flowNode.Nexts = nexts[1:]
	}
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
		return insertFlowNodes(ctx, tx, flowNodes)
	})
}

func insertFlowNodes(ctx context.Context, tx pgx.Tx, flowNodes []*entities.FlowNode) error {
	// A pasted chain names a flow node of its own batch, which is not there yet when the flow node naming
	// it goes in. The chain's foreign key is declared DEFERRABLE for exactly this, and this is
	// the one place that asks for the deferral: the batch is checked when it commits, as a
	// whole, so a paste does not depend on the order its flow nodes happen to arrive in.
	if _, err := tx.Exec(ctx, `SET CONSTRAINTS ALL DEFERRED`); err != nil {
		return translate(err, "the flow nodes")
	}
	for _, flowNode := range flowNodes {
		var spotX, spotY *int
		if flowNode.Spot != nil {
			spotX, spotY = &flowNode.Spot.X, &flowNode.Spot.Y
		}
		var sizeW, sizeH *int
		if flowNode.Size != nil {
			sizeW = &flowNode.Size.W
			if flowNode.Size.H > 0 {
				sizeH = &flowNode.Size.H
			}
		}
		valueJSON := flowNode.Value
		if valueJSON == "" {
			valueJSON = "{}"
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO flow_node (id, board_id, title, type, note, value, value_type, status, scheduled_at,
				spot_x, spot_y, size_w, size_h, workflow_id,
				created_at, updated_at, revision, duration, archived, output_type, pull_request_id, pull_request_status,
				commit_id, commit_status, limiter_max_passes, limiter_remaining_passes, role_id, role_kind, role_people, role_description)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, nullif($9, ''), $10, $11, $12, $13,
                    nullif($14, '')::uuid, $15, $16, $17, nullif($18, ''), $19, $20,
                    nullif($21, ''), nullif($22, ''), nullif($23, ''), nullif($24, ''), $25, $26, $27, $28, coalesce($29::text[], '{}'), $30)`,
			flowNode.ID, flowNode.BoardID, flowNode.Title, string(flowNode.Type), flowNode.Note, valueJSON, flowNode.ValueType,
			string(flowNode.Status), flowNode.ScheduledAt, spotX, spotY, sizeW, sizeH,
			flowNode.WorkflowID,
			flowNode.CreatedAt, flowNode.UpdatedAt, flowNode.Revision, flowNode.Duration, flowNode.Archived, flowNode.OutputType,
			flowNode.PullRequestID, flowNode.PullRequestStatus, flowNode.CommitID, flowNode.CommitStatus,
			flowNode.MaxPasses, flowNode.RemainingPasses, flowNode.RoleID, flowNode.RoleKind, flowNode.People, flowNode.Description)
		if err != nil {
			return translate(err, fmt.Sprintf("flow node %q", flowNode.Title))
		}
		if err := writeTask(ctx, tx, flowNode); err != nil {
			return err
		}
		if err := writeTags(ctx, tx, flowNode.ID, flowNode.Tags); err != nil {
			return err
		}
		if err := writeSuccessors(ctx, tx, flowNode.ID, flowNode.Successors()); err != nil {
			return err
		}
		if len(flowNode.Routes) > 0 {
			if err := writeRoutes(ctx, tx, flowNode.ID, flowNode.Routes); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *BoardStore) FindFlowNode(ctx context.Context, id string) (*entities.FlowNode, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+` WHERE t.id::text = $1`, id)
	flowNode, err := scanFlowNode(row)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("flow node %s", id))
	}
	return flowNode, nil
}

func (s *BoardStore) ListFlowNodes(ctx context.Context, boardID string) ([]entities.FlowNode, error) {
	// By id: a board is a set of flow nodes, and the editor lays them out by their spots. The id is
	// what makes the order total and stable.
	rows, err := s.pool.Query(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+`
		WHERE t.board_id::text = $1
		ORDER BY t.id`, boardID)
	if err != nil {
		return nil, translate(err, "the flow nodes")
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

// flowNodeAssignments is the flow node's own half of the patch as SQL. The tags and the task are not in
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
	if patch.ValueType != nil {
		set.add("value_type", *patch.ValueType)
	}
	if patch.RoleID != nil {
		set.add("role_id", *patch.RoleID)
	}
	if patch.RoleKind != nil {
		set.add("role_kind", *patch.RoleKind)
	}
	if patch.People != nil {
		set.addExpr("role_people = coalesce(%s::text[], '{}')", *patch.People)
	}
	if patch.Description != nil {
		set.add("role_description", *patch.Description)
	}
	if patch.ClearOutput {
		set.raw("output = NULL")
	}
	if patch.OutputType != nil {
		set.add("output_type", *patch.OutputType)
	}
	if patch.Output != nil {
		set.addExpr("output = %s::jsonb", *patch.Output)
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
	if patch.PullRequestID != nil {
		set.addExpr("pull_request_id = nullif(%s, '')", *patch.PullRequestID)
	}
	if patch.PullRequestStatus != nil {
		set.addExpr("pull_request_status = nullif(%s, '')", *patch.PullRequestStatus)
	}
	if patch.CommitID != nil {
		set.addExpr("commit_id = nullif(%s, '')", *patch.CommitID)
	}
	if patch.CommitStatus != nil {
		set.addExpr("commit_status = nullif(%s, '')", *patch.CommitStatus)
	}
	if patch.MaxPasses != nil {
		set.add("limiter_max_passes", *patch.MaxPasses)
	}
	if patch.RemainingPasses != nil {
		set.add("limiter_remaining_passes", *patch.RemainingPasses)
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
	if patch.Size != nil {
		set.add("size_w", patch.Size.W)
		if patch.Size.H > 0 {
			set.add("size_h", patch.Size.H)
		} else {
			set.raw("size_h = NULL")
		}
	}
	return set
}

// taskAssignments is the task's half of the same patch. The service has already dropped these for a
// flow node that is not one, so anything here is going onto a row that exists or is about to.
func taskAssignments(patch entities.FlowNodePatch) (*assignments, error) {
	set := newAssignments()
	if patch.Body != nil {
		set.add("body", *patch.Body)
	}
	if patch.MultiPartTemplate != nil {
		set.add("multi_part_template", *patch.MultiPartTemplate)
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
		set.addExpr("harness = nullif(%s, '')", patch.Settings.Harness)
		set.addExpr("profile_id = nullif(%s, '')", patch.Settings.ProfileID)
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

// PatchFlowNode writes a flow node and its task as one change.
//
// The conditional update checks the revision on flow_node. Task, tag and connection changes
// share the transaction and advance that revision so watchers receive one change event.
func (s *BoardStore) PatchFlowNode(ctx context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error) {
	set := flowNodeAssignments(patch)
	task, err := taskAssignments(patch)
	if err != nil {
		return nil, err
	}
	if set.empty() && task.empty() && patch.Tags == nil && patch.Nexts == nil && patch.Next == nil && patch.Routes == nil {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if set.empty() {
		// The tags, the branches or the task alone: the flow node itself still has to be stamped, or
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
		// **The flow node's own row first.** It is the conditional write, so a flow node that has gone or has
		// moved under the caller is answered as what it is — a 404 or a 409 — rather than as a
		// foreign key refusing a task for a flow node that is not there.
		if err := s.stampFlowNodeIn(ctx, tx, id, set, expected); err != nil {
			return err
		}
		if patch.Next != nil || patch.Nexts != nil {
			changed, err := readFlowNodeIn(ctx, tx, id)
			if err != nil {
				return err
			}
			nexts := changed.Successors()
			if changed.Type.Splits() && patch.Nexts != nil {
				nexts = *patch.Nexts
			} else if !changed.Type.Splits() && patch.Next != nil {
				nexts = nil
				if *patch.Next != "" {
					nexts = []string{*patch.Next}
				}
			} else if patch.Type != nil {
				nexts = nil
			}
			if err := writeSuccessors(ctx, tx, id, nexts); err != nil {
				return err
			}
		}
		if patch.Routes != nil {
			if err := writeRoutes(ctx, tx, id, *patch.Routes); err != nil {
				return err
			}
		} else if patch.Type != nil && *patch.Type != entities.FlowNodeExclusiveGateway {
			if err := writeRoutes(ctx, tx, id, nil); err != nil {
				return err
			}
		}
		// Then the type's consequence: a flow node that has just become an AI or a Human one is given an
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
				return translate(err, fmt.Sprintf("the task of flow node %s", id))
			}
		}
		found, err := readFlowNodeIn(ctx, tx, id)
		flowNode = found
		return err
	})
	return flowNode, err
}

// retypeTask keeps the task row in step with the flow node's kind: one exists for an AI or a Human flow node
// and none for the other two. `ON CONFLICT DO NOTHING` because a flow node retyped between the two kinds
// of task keeps the task it had — the description and the folder are still the same work — while a
// flow node coming back from Shutdown gets a fresh, empty one.
func retypeTask(ctx context.Context, tx pgx.Tx, id string, flowNodeType entities.FlowNodeType) error {
	statement := `DELETE FROM task WHERE flow_node_id::text = $1`
	if flowNodeType.IsTask() {
		statement = `INSERT INTO task (flow_node_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING`
	}
	if _, err := tx.Exec(ctx, statement, id); err != nil {
		return translate(err, fmt.Sprintf("the task of flow node %s", id))
	}
	return nil
}

// writeTask files the task of a flow node that has one, and nothing at all for a flow node that has not.
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
			permission, folder, runner, settings_extra, conversation_id, on_success_mode, on_success_compact, harness, profile_id, multi_part_template)
		VALUES ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, ''),
			nullif($9, ''), nullif($10, ''), $11, nullif($12, ''), $13, $14, nullif($15, ''), nullif($16, ''), $17)`,
		flowNode.ID, flowNode.Task.Body, criteria, complexity,
		settings.Agent, settings.Model, settings.Effort, settings.Permission, settings.Folder,
		settings.Runner,
		extra, flowNode.Task.ConversationID,
		string(flowNode.Task.Transition.Mode), flowNode.Task.Transition.Compact, settings.Harness, settings.ProfileID,
		flowNode.Task.MultiPartTemplate)
	if err != nil {
		return translate(err, fmt.Sprintf("the task of flow node %q", flowNode.Title))
	}
	return nil
}

// stampFlowNodeIn writes the flow node's own row, conditionally where a revision was given.
func (s *BoardStore) stampFlowNodeIn(ctx context.Context, tx pgx.Tx, id string, set *assignments, expected *int64) error {
	sql, args := set.update("flow_node", "id::text = ", id, expected)
	// **The row count is the answer.** A revision-checked update either matches its row or matches
	// nothing, and nothing is what a stale caller gets — asked about below, so that "it has moved"
	// and "it is gone" come back as the two different things they are.
	tag, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return translate(err, fmt.Sprintf("flow node %s", id))
	}
	if tag.RowsAffected() == 0 {
		return whyNoRows(ctx, s.pool, "flow_node", "id::text = ", id, expected)
	}
	return nil
}

// readFlowNodeIn reads a flow node back inside the transaction that wrote it, so what comes out is what
// was written. RETURNING cannot do it: the tag subquery and the task's join both name `t`.
func readFlowNodeIn(ctx context.Context, tx pgx.Tx, id string) (*entities.FlowNode, error) {
	flowNode, err := scanFlowNode(tx.QueryRow(ctx, `SELECT `+flowNodeColumns+flowNodeFrom+` WHERE t.id::text = $1`, id))
	if err != nil {
		return nil, translate(err, fmt.Sprintf("flow node %s", id))
	}
	return flowNode, nil
}

func (s *BoardStore) DeleteFlowNodes(ctx context.Context, ids []string, actor string) error {
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE flow_node SET value_type = '' WHERE value_type = ANY($1)`, ids); err != nil {
			return translate(err, "the flow nodes")
		}
		tag, err := tx.Exec(ctx, `DELETE FROM flow_node WHERE id::text = ANY($1)`, ids)
		if err != nil {
			return translate(err, "the flow nodes")
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("none of those flow nodes")
		}
		return nil
	})
}

// ── the claim ─────────────────────────────────────────────────────────────────

// ClaimFlowNode locks the flow node while checking ownership and detaching a completed AI flow node's chat.
func (s *BoardStore) ClaimFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string, afterPredecessor ...bool) (*entities.FlowNode, error) {
	var flowNode *entities.FlowNode
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		var kind entities.FlowNodeType
		var previous entities.FlowNodeStatus
		var heldBy string
		var completion int64
		if err := tx.QueryRow(ctx, `SELECT type, status, coalesce(run_id, ''), completion
			FROM flow_node WHERE id::text = $1 FOR UPDATE`, id).Scan(&kind, &previous, &heldBy, &completion); err != nil {
			return translate(err, fmt.Sprintf("flow node %s", id))
		}
		if kind == entities.FlowNodeLimiter {
			return entities.Invalidf("a limiter is played through its pass operation")
		}
		if heldBy != "" && heldBy != runID {
			return fmt.Errorf("%w: run %s has it", entities.ErrFlowNodeHeld, heldBy)
		}
		if !previous.CanClaim(kind, heldBy == runID) {
			return entities.Invalidf("the flow node stands at %q", previous)
		}
		if kind == entities.FlowNodeGateway && heldBy != runID {
			replaying := previous == entities.StatusDone && len(afterPredecessor) > 0 && afterPredecessor[0]
			var waiting bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (
				SELECT 1 FROM flow_node_successor link JOIN flow_node input ON input.id = link.flow_node_id
				WHERE link.successor_id::text = $1 AND NOT input.archived
				  AND (input.status <> 'done' OR ($2 AND input.completion <= $3))
			)`, id, replaying, completion).Scan(&waiting); err != nil {
				return err
			}
			if waiting {
				return entities.ErrGatewayWaiting
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE flow_node
			SET run_id = $2, claimed_at = coalesce(claimed_at, now()),
			    output = CASE WHEN run_id = $2 THEN output ELSE NULL END, status = $3
			WHERE id::text = $1`, id, runID, string(status)); err != nil {
			return translate(err, fmt.Sprintf("flow node %s", id))
		}
		if previous == entities.StatusDone && kind == entities.FlowNodeAI {
			if _, err := tx.Exec(ctx, `UPDATE task SET conversation_id = NULL
				WHERE flow_node_id::text = $1 AND conversation_id IS NOT NULL`, id); err != nil {
				return translate(err, fmt.Sprintf("flow node %s chat", id))
			}
		}
		var err error
		flowNode, err = readFlowNodeIn(ctx, tx, id)
		return err
	})
	return flowNode, err
}

// ReleaseFlowNode hands the flow node back, and refuses a release by a run that does not hold it: a run
// that was stopped and whose turn came back late must not mark a flow node somebody else is now playing.
func (s *BoardStore) ReleaseFlowNode(ctx context.Context, id, runID, actor string, result entities.PlayResult) (*entities.FlowNode, error) {
	var flowNode *entities.FlowNode
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		var workflowID string
		if update := result.Workflow; update != nil {
			workflowID = update.ID
			// Lock the workflow before the flow node, matching workflow deletion's lock order.
			// The merge rolls back if the guarded flow node update below fails.
			tag, err := tx.Exec(ctx, `
				UPDATE workflow SET runtime_values = runtime_values || $2::jsonb
				WHERE id::text = $1`, workflowID, update.Values)
			if err != nil {
				return translate(err, fmt.Sprintf("workflow %s", workflowID))
			}
			if tag.RowsAffected() == 0 {
				return entities.Conflictf("workflow %s no longer exists", workflowID)
			}
		}
		tag, err := tx.Exec(ctx, `
			UPDATE flow_node SET run_id = NULL, claimed_at = NULL, status = $3, output = nullif($4, '')::jsonb
			WHERE id::text = $1 AND run_id = $2 AND ($5 = '' OR workflow_id::text = $5)`,
			id, runID, string(result.Status), result.Output, workflowID)
		if err != nil {
			return translate(err, fmt.Sprintf("flow node %s", id))
		}
		if tag.RowsAffected() == 0 {
			if workflowID != "" {
				return entities.Conflictf("flow node %s is no longer held by run %s in workflow %s", id, runID, workflowID)
			}
			return entities.Conflictf("flow node %s is not held by run %s", id, runID)
		}
		flowNode, err = readFlowNodeIn(ctx, tx, id)
		return err
	})
	return flowNode, err
}

// ReleaseRun frees every flow node a run still holds. What a restart calls.
func (s *BoardStore) ReleaseRun(ctx context.Context, runID string, status entities.FlowNodeStatus, actor string) (int, error) {
	var settled int
	err := inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE flow_node SET run_id = NULL, claimed_at = NULL, status = $2
			WHERE run_id = $1`, runID, string(status))
		if err != nil {
			return translate(err, fmt.Sprintf("the flow nodes held by run %s", runID))
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
		return nil, translate(err, "the held flow nodes")
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

// Keep retained links so a reorder or an added link preserves their routes.
func writeSuccessors(ctx context.Context, tx pgx.Tx, flowNodeID string, nexts []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM flow_node_successor WHERE flow_node_id::text = $1
		AND NOT (successor_id::text = ANY(coalesce($2::text[], '{}')))`, flowNodeID, nexts); err != nil {
		return translate(err, "the branches")
	}
	for i, next := range nexts {
		_, err := tx.Exec(ctx,
			`INSERT INTO flow_node_successor (flow_node_id, successor_id, ordinal) VALUES ($1::uuid, $2::uuid, $3)
			 ON CONFLICT (flow_node_id, successor_id) DO UPDATE SET ordinal = excluded.ordinal
			 WHERE flow_node_successor.ordinal <> excluded.ordinal`,
			flowNodeID, next, i)
		if err != nil {
			return translate(err, fmt.Sprintf("branch %q", next))
		}
	}
	return nil
}

func writeRoutes(ctx context.Context, tx pgx.Tx, id string, routes []entities.Route) error {
	if _, err := tx.Exec(ctx, `DELETE FROM flow_node_route WHERE flow_node_id = $1::uuid`, id); err != nil {
		return translate(err, "the routes")
	}
	for i, route := range routes {
		result, err := tx.Exec(ctx, `INSERT INTO flow_node_route (flow_node_id, ordinal, condition, successor_id)
			SELECT id, $2, $3, $4::uuid FROM flow_node WHERE id = $1::uuid AND type = 'exclusive-gateway'`,
			id, i, route.Condition, route.FlowNode)
		if err != nil {
			return translate(err, fmt.Sprintf("route %d", i+1))
		}
		if result.RowsAffected() == 0 {
			return entities.Invalidf("only an exclusive gateway can have routes")
		}
	}
	return nil
}

// writeTags replaces a flow node's tags. Delete and insert rather than a difference: a tag list is a
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

func (s *BoardStore) ListSchemaValues(ctx context.Context) ([]entities.SchemaValue, error) {
	rows, err := s.pool.Query(ctx, `SELECT n.id::text, n.title, n.value::text, b.slug, b.name
		FROM flow_node n JOIN board b ON b.id = n.board_id
		WHERE n.type = 'value' AND n.value_type = 'json-schema' AND NOT n.archived AND b.archived_at IS NULL
		ORDER BY b.name, n.title, n.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []entities.SchemaValue{}
	for rows.Next() {
		var one entities.SchemaValue
		if err := rows.Scan(&one.ID, &one.Title, &one.Value, &one.BoardSlug, &one.BoardName); err != nil {
			return nil, err
		}
		out = append(out, one)
	}
	return out, rows.Err()
}

func (s *BoardStore) OutputTypeUsed(ctx context.Context, id string) (bool, error) {
	var used bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM flow_node WHERE output_type = $1)`, id).Scan(&used)
	return used, err
}
