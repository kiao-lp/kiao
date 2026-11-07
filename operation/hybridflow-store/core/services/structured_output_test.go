package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestOutputTypeFromAnotherBoard(t *testing.T) {
	boards, nodes, agents, _ := newCore()
	ctx := context.Background()
	schemas, err := boards.Create(ctx, services.NewBoardRequest{Name: "Schemas"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	tasks, err := boards.Create(ctx, services.NewBoardRequest{Name: "Tasks"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	_, err = nodes.Create(ctx, schemas.ID, []services.NewFlowNodeRequest{
		{ID: schemaID, Title: "Message", Type: "value", ValueType: "json-schema", Value: `{"type":"object"}`},
		{ID: plainID, Title: "Plain", Type: "value", Value: `{}`},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := agents.Create(ctx, services.NewAgentRequest{Name: "Writer", Platform: "claude"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, tasks.ID, []services.NewFlowNodeRequest{
		{Title: "Write", Type: "ai", OutputType: schemaID, Settings: entities.TaskSettings{Agent: agent.ID, Effort: "high", Permission: "bypassPermissions", Folder: "/"}},
	}, "alex")
	if err != nil || made[0].OutputType != schemaID {
		t.Fatalf("create = %+v, %v", made, err)
	}
	id := made[0].ID
	values, err := nodes.SchemaValues(ctx)
	if err != nil || len(values) != 1 || values[0].BoardSlug != schemas.Slug {
		t.Fatalf("schemas = %+v, %v", values, err)
	}
	for _, ref := range []string{plainID, "json-schema", "missing"} {
		if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{OutputType: &ref}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
			t.Errorf("accepted output type %s: %v", ref, err)
		}
	}
	empty := ""
	if _, err := nodes.Patch(ctx, schemaID, entities.FlowNodePatch{ValueType: &empty}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("schema in use retyped: %v", err)
	}
	if _, err := nodes.StartPlay(ctx, id, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := nodes.EndPlay(ctx, id, "old-run", entities.StatusDone, "old-run", `{"stale":true}`); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale completion = %v", err)
	}
	done, err := nodes.EndPlay(ctx, id, "run-1", entities.StatusDone, "run-1", `{"message": "hello"}`)
	if err != nil || done.Output != `{"message":"hello"}` || done.RunID != "" {
		t.Fatalf("done = %+v, %v", done, err)
	}
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{OutputType: &empty}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	cleared, err := nodes.Find(ctx, id)
	if err != nil || cleared.Output != "" {
		t.Fatalf("schema changed with stale output: %+v, %v", cleared, err)
	}
	if _, err := nodes.Patch(ctx, schemaID, entities.FlowNodePatch{ValueType: &empty}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
}

func TestHumanOutputTypeAndOutput(t *testing.T) {
	boards, nodes, _, _ := newCore()
	ctx := context.Background()
	schemas, err := boards.Create(ctx, services.NewBoardRequest{Name: "Schemas"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	tasks, err := boards.Create(ctx, services.NewBoardRequest{Name: "Tasks"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := nodes.Create(ctx, schemas.ID, []services.NewFlowNodeRequest{
		{ID: schemaID, Title: "Message", Type: "value", ValueType: "json-schema", Value: `{"type":"object"}`},
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, tasks.ID, []services.NewFlowNodeRequest{
		{Title: "Review", Type: "human", OutputType: schemaID},
	}, "alex")
	if err != nil || made[0].OutputType != schemaID {
		t.Fatalf("create = %+v, %v", made, err)
	}
	id := made[0].ID
	output := `{"message":"hello"}`
	done := entities.StatusDone
	saved, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Output: &output, Status: &done}, nil, "alex")
	if err != nil || saved.Output != output || saved.Status != entities.StatusDone {
		t.Fatalf("patch = %+v, %v", saved, err)
	}
	todo := entities.StatusTodo
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Status: &todo}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	bad := "not json"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Output: &bad}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("bad output = %v", err)
	}
}
