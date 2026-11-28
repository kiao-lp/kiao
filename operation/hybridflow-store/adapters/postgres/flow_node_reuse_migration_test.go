package postgres

import (
	"context"
	"reflect"
	"testing"

	"kiao/hybridflow-store/core/entities"
)

func TestFlowNodeReuseMigrationCarriesLatestDefinitionsIntoBoards(t *testing.T) {
	pool := testPoolAtVersion(t, 54)
	ctx := context.Background()
	const boardID = "10000000-0000-4000-8000-000000000001"
	const workflowID = "20000000-0000-4000-8000-000000000001"
	const aiID = "30000000-0000-4000-8000-000000000001"
	const humanID = "30000000-0000-4000-8000-000000000002"
	const schedulerID = "30000000-0000-4000-8000-000000000003"
	const shutdownID = "30000000-0000-4000-8000-000000000004"
	setup := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO board(id, name, slug) VALUES ($1, 'Work', 'work')`, []any{boardID}},
		{`INSERT INTO workflow(id, board_id, name, runtime_values)
			VALUES ($1, $2, 'Running work', '{"result":42}')`, []any{workflowID, boardID}},
		{`INSERT INTO workflow_class(id, board_id, name) VALUES
			($1, $2, 'Review workflow'), ('20000000-0000-4000-8000-000000000002', $2, 'Empty workflow')`,
			[]any{workflowID, boardID}},
		{`INSERT INTO flow_node_class(id, board_id, title, type, workflow_class_id)
			VALUES ($1, $5, 'Review', 'ai', $6), ($2, $5, 'Approve', 'human', $6),
				($3, $5, 'Wait', 'scheduler', $6), ($4, $5, 'Turn off', 'shutdown', NULL)`,
			[]any{aiID, humanID, schedulerID, shutdownID, boardID, workflowID}},
		{`UPDATE flow_node_class SET on_success_flow_node_class_id = $1, spot_x = 21, spot_y = 42,
			size_w = 350, size_h = 200, note = 'Check when to use this task.', permission = 'read',
			runner = 'desktop', agent_selection = '{"agent":"agent-id","harness":"codex","profileId":"profile","model":"model"}',
			on_success_mode = 'continue', on_success_compact = true
			WHERE id = $2`, []any{humanID, aiID}},
		{`UPDATE flow_node_class SET on_success_flow_node_class_id = $1, duration = '30s' WHERE id = $2`,
			[]any{humanID, schedulerID}},
		{`INSERT INTO flow_node_class_tag(flow_node_class_id, tag, ordinal)
			VALUES ($1, 'second', 1), ($1, 'first', 0)`, []any{aiID}},
		{`INSERT INTO flow_node_class_version(id, flow_node_class_id, version_number, body, criteria, status, is_template)
			VALUES ('40000000-0000-4000-8000-000000000001', $1, 1, 'Old wording', '[]', 'published', false),
				('40000000-0000-4000-8000-000000000002', $1, 2, 'Review ${item:text}',
				 '[{"id":"criterion","text":"Check the result"}]', 'draft', true),
				('40000000-0000-4000-8000-000000000003', $2, 1, 'Approve the review', '[]', 'published', false)`,
			[]any{aiID, humanID}},
		{`INSERT INTO flow_node(id, board_id, title, type, status, workflow_id, class_version_id)
			VALUES ($1, $2, 'Existing AI', 'ai', 'done', $3, '40000000-0000-4000-8000-000000000001')`,
			[]any{aiID, boardID, workflowID}},
		{`INSERT INTO task(flow_node_id, body, conversation_id)
			VALUES ($1, 'Specific wording', 'conversation-1')`, []any{aiID}},
	}
	for _, statement := range setup {
		if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	before, err := NewChangeStore(pool).Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}

	for range 2 {
		if _, err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	store := NewBoardStore(pool)
	workflows, err := store.ListWorkflows(ctx, boardID)
	if err != nil || len(workflows) != 3 {
		t.Fatalf("workflows = %+v, %v", workflows, err)
	}
	for _, workflow := range workflows {
		if workflow.ID == workflowID && string(workflow.Values) != `{"result": 42}` {
			t.Fatalf("existing workflow changed: %+v", workflow)
		}
	}
	nodes, err := store.ListFlowNodes(ctx, boardID)
	if err != nil || len(nodes) != 7 {
		t.Fatalf("nodes = %+v, %v", nodes, err)
	}
	byTitle := map[string]entities.FlowNode{}
	for _, node := range nodes {
		byTitle[node.Title] = node
	}
	existing := byTitle["Existing AI"]
	if existing.ID != aiID || existing.WorkflowID != workflowID || existing.Status != entities.StatusDone ||
		existing.Task.Body != "Specific wording" || existing.Task.ConversationID != "conversation-1" {
		t.Fatalf("existing flow node changed: %+v, task %+v", existing, existing.Task)
	}
	ai := byTitle["Review"]
	if ai.ID == aiID || ai.WorkflowID == "" || ai.WorkflowID == workflowID || ai.Status != entities.StatusDraft ||
		!reflect.DeepEqual(ai.Tags, []string{"first", "second"}) ||
		ai.Spot == nil || *ai.Spot != (entities.Spot{X: 21, Y: 42}) ||
		ai.Size == nil || *ai.Size != (entities.Size{W: 350, H: 200}) {
		t.Fatalf("review flow node = %+v", ai)
	}
	task := ai.Task
	if task == nil || task.Body != "Review ${item:text}" || !task.MultiPartTemplate ||
		!reflect.DeepEqual(task.Criteria, []entities.SuccessCriterion{{ID: "criterion", Text: "Check the result"}}) ||
		task.Settings.Agent != "agent-id" || task.Settings.Harness != "codex" || task.Settings.ProfileID != "profile" ||
		task.Settings.Model != "model" || task.Settings.Permission != "read" || task.Settings.Runner != "desktop" ||
		!task.Transition.Compact || task.Transition.Mode != entities.TransitionContinue {
		t.Fatalf("review task = %+v", task)
	}
	human, wait, off := byTitle["Approve"], byTitle["Wait"], byTitle["Turn off"]
	join, note := byTitle["Join — Approve"], byTitle["Review — Note"]
	if human.ID != humanID || human.WorkflowID != ai.WorkflowID || human.Task == nil || human.Task.Body != "Approve the review" ||
		wait.ID != schedulerID || wait.Duration != "30s" || wait.Task != nil || off.ID != shutdownID || off.Task != nil ||
		join.ID == "" || ai.Next != join.ID || wait.Next != join.ID || !reflect.DeepEqual(join.Successors(), []string{humanID}) ||
		len(join.Routes) != 1 || join.Routes[0].Condition != "true" || note.Note != "Check when to use this task." ||
		note.WorkflowID != ai.WorkflowID {
		t.Fatalf("converted graph = %+v", nodes)
	}

	var retiredObjects bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name LIKE '%class%')
		  OR EXISTS (SELECT FROM information_schema.columns
			WHERE table_schema = current_schema() AND column_name = 'class_version_id')
		  OR EXISTS (SELECT FROM change_event WHERE scope IN ('flowNodeClass', 'workflowClass'))
	`).Scan(&retiredObjects); err != nil || retiredObjects {
		t.Fatalf("retired schema or events present = %v, %v", retiredObjects, err)
	}
	changes, _, err := NewChangeStore(pool).Since(ctx, before, boardID, 100)
	if err != nil || len(changes) != 8 {
		t.Fatalf("conversion events = %+v, %v", changes, err)
	}
}
