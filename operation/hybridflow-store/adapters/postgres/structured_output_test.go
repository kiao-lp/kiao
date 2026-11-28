package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestStructuredOutputPersistsWithClaim(t *testing.T) {
	boards, nodes, _, _ := wire(t)
	ctx := context.Background()
	schemas, err := boards.Create(ctx, services.NewBoardRequest{Name: "Schemas"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	tasks, err := boards.Create(ctx, services.NewBoardRequest{Name: "Tasks"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	values, err := nodes.Create(ctx, schemas.ID, []services.NewFlowNodeRequest{{Title: "Message", Type: "value", ValueType: "json-schema", Value: `{"type":"object"}`}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, tasks.ID, []services.NewFlowNodeRequest{{Title: "Write", Type: "ai", OutputType: values[0].ID, Settings: aiSettings()}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	id := made[0].ID
	listed, err := nodes.SchemaValues(ctx)
	if err != nil || len(listed) != 1 || listed[0].BoardSlug != schemas.Slug {
		t.Fatalf("schemas = %+v, %v", listed, err)
	}
	if _, err := nodes.StartPlay(ctx, id, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := nodes.EndPlay(ctx, id, "old-run", "old-run", entities.PlayResult{Status: entities.StatusDone, Output: `{"stale":true}`}); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale completion = %v", err)
	}
	if _, err := nodes.EndPlay(ctx, id, "run-1", "run-1", entities.PlayResult{Status: entities.StatusDone, Output: `{"message":"hello"}`}); err != nil {
		t.Fatal(err)
	}
	held, err := nodes.Find(ctx, id)
	if err != nil || held.Output == "" || held.OutputType != values[0].ID || held.Status != entities.StatusDone {
		t.Fatalf("read = %+v, %v", held, err)
	}
	previousChat := "previous-conversation"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{ConversationID: &previousChat}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	claimed, err := nodes.StartPlay(ctx, id, "run-2", "run-2")
	if err != nil || claimed.Output != "" || claimed.ConversationID() != "" {
		t.Fatalf("replay claim = %+v, %v, want cleared output and chat", claimed, err)
	}
	if _, err := nodes.EndPlay(ctx, id, "run-1", "run-1", entities.PlayResult{Status: entities.StatusDone, Output: `{"stale":true}`}); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("late completion = %v", err)
	}
	failed, err := nodes.EndPlay(ctx, id, "run-2", "run-2", entities.PlayResult{Status: entities.StatusError, Output: `{"partial":true}`})
	if err != nil || failed.Output != "" {
		t.Fatalf("failed output = %+v, %v", failed, err)
	}
}

func TestWorkflowValuesMergeAndCommitWithTheFlowNodeClaim(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Tasks"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	workflows := services.NewWorkflows(store, store, realClock{}, uuidIDs{store: store})
	workflow, err := workflows.Create(ctx, board.ID, services.NewWorkflowRequest{Name: "Release"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Plan", Type: "ai", Workflow: workflow.ID, Settings: aiSettings()},
		{Title: "Review", Type: "ai", Workflow: workflow.ID, Settings: aiSettings()},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	for i, runID := range []string{"plan", "review"} {
		if _, err := nodes.StartPlay(ctx, made[i].ID, runID, runID); err != nil {
			t.Fatal(err)
		}
	}
	result := func(field, value string) entities.PlayResult {
		return entities.PlayResult{Status: entities.StatusDone, Output: value, Workflow: &entities.WorkflowUpdate{
			ID: workflow.ID, Values: map[string]json.RawMessage{field: json.RawMessage(value)},
		}}
	}
	if _, err := nodes.EndPlay(ctx, made[0].ID, "stale", "stale", result("stale", `true`)); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale completion = %v", err)
	}
	done := make(chan error, len(made))
	for i, runID := range []string{"plan", "review"} {
		go func() {
			_, err := nodes.EndPlay(ctx, made[i].ID, runID, runID, result(runID, `true`))
			done <- err
		}()
	}
	for range made {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	checkValues := func() {
		t.Helper()
		got, err := workflows.Find(ctx, workflow.ID)
		if err != nil {
			t.Fatal(err)
		}
		var values map[string]bool
		if err := json.Unmarshal([]byte(got.Values), &values); err != nil || len(values) != 2 || !values["plan"] || !values["review"] {
			t.Fatalf("workflow values = %s, %v", got.Values, err)
		}
	}
	checkValues()

	if _, err := nodes.StartPlay(ctx, made[0].ID, "moved", "moved"); err != nil {
		t.Fatal(err)
	}
	ungrouped := ""
	if _, err := nodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{WorkflowID: &ungrouped}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := nodes.EndPlay(ctx, made[0].ID, "moved", "moved", result("plan", `false`)); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("completion after the move = %v", err)
	}
	checkValues()
	flowNode, err := nodes.Find(ctx, made[0].ID)
	if err != nil || flowNode.RunID != "moved" || flowNode.Status != entities.StatusRunning || flowNode.Output != "" {
		t.Fatalf("flow node after refused completion = %+v, %v", flowNode, err)
	}
}
