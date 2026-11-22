package postgres

import (
	"context"
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
	if _, err := nodes.EndPlay(ctx, id, "old-run", entities.StatusDone, "old-run", `{"stale":true}`); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("stale completion = %v", err)
	}
	if _, err := nodes.EndPlay(ctx, id, "run-1", entities.StatusDone, "run-1", `{"message":"hello"}`); err != nil {
		t.Fatal(err)
	}
	held, err := nodes.Find(ctx, id)
	if err != nil || held.Output == "" || held.OutputType != values[0].ID || held.Status != entities.StatusDone {
		t.Fatalf("read = %+v, %v", held, err)
	}
	ready := entities.StatusReady
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{Status: &ready}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	claimed, err := nodes.StartPlay(ctx, id, "run-2", "run-2")
	if err != nil || claimed.Output != "" {
		t.Fatalf("new claim retained output: %+v, %v", claimed, err)
	}
	if _, err := nodes.EndPlay(ctx, id, "run-1", entities.StatusDone, "run-1", `{"stale":true}`); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("late completion = %v", err)
	}
	failed, err := nodes.EndPlay(ctx, id, "run-2", entities.StatusError, "run-2", `{"partial":true}`)
	if err != nil || failed.Output != "" {
		t.Fatalf("failed output = %+v, %v", failed, err)
	}
}
