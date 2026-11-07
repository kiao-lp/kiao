package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestCreateNoteKeepsOnlyMarkdown(t *testing.T) {
	_, flowNodes, b := board(t)
	made, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{Title: "Ignored", Type: "note", Tags: []string{"x"}, Note: "# Hello\n\n[link](/a.md)", Body: "ignored"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].Type != entities.FlowNodeNote || made[0].Title != "" || len(made[0].Tags) != 0 {
		t.Errorf("note = %+v, want no title or tags", made[0])
	}
	if made[0].Note != "# Hello\n\n[link](/a.md)" || made[0].Task != nil {
		t.Errorf("note content = %q task=%v", made[0].Note, made[0].Task)
	}
	if err := made[0].Runnable(); !errors.Is(err, entities.ErrFlowNodeNotRunnable) {
		t.Errorf("note runnable = %v", err)
	}
}

func TestCreateValueValidatesJSON(t *testing.T) {
	_, flowNodes, b := board(t)
	made, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{Title: "Config", Type: "value", Value: `{ "a": 1 }`},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].Value != `{"a":1}` {
		t.Errorf("value = %q, want compact JSON", made[0].Value)
	}
	if _, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{Title: "Bad", Type: "value", Value: `{nope`},
	}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("bad JSON err = %v, want ErrInvalid", err)
	}
}

func TestPatchNoteAndValue(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Type: "note", Note: "old"},
		{Title: "Cfg", Type: "value", Value: `{"a":1}`},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	note := "new **text**"
	patched, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Note: &note}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Note != note {
		t.Errorf("patched note = %q", patched.Note)
	}
	bad := "{bad"
	if _, err := flowNodes.Patch(ctx, made[1].ID, entities.FlowNodePatch{Value: &bad}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("bad value patch err = %v", err)
	}
	good := "[1, 2]"
	patched, err = flowNodes.Patch(ctx, made[1].ID, entities.FlowNodePatch{Value: &good}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Value != "[1,2]" {
		t.Errorf("patched value = %q", patched.Value)
	}
}
