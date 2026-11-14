package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

const (
	schemaID = "11111111-1111-1111-1111-111111111111"
	typedID  = "22222222-2222-2222-2222-222222222222"
	plainID  = "33333333-3333-3333-3333-333333333333"
)

func TestValueTypeLifecycle(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{ID: schemaID, Title: "Person", Type: "value", Value: `{"type":"object"}`, ValueType: "json-schema"},
		{ID: typedID, Title: "Ada", Type: "value", Value: `{"name":"Ada"}`, ValueType: schemaID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].ValueType != "json-schema" || made[1].ValueType != schemaID {
		t.Errorf("valueTypes = %q, %q", made[0].ValueType, made[1].ValueType)
	}
	if _, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{ID: plainID, Title: "Bad", Type: "value", Value: `{}`, ValueType: typedID},
	}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("typed by non-schema err = %v, want ErrInvalid", err)
	}
	if _, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Bad", Type: "value", Value: `{}`, ValueType: "yaml"},
	}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("unknown static type err = %v, want ErrInvalid", err)
	}
	empty := ""
	if _, err := flowNodes.Patch(ctx, schemaID, entities.FlowNodePatch{ValueType: &empty}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("untyping a schema in use err = %v, want ErrInvalid", err)
	}
	patched, err := flowNodes.Patch(ctx, typedID, entities.FlowNodePatch{ValueType: &empty}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.ValueType != "" {
		t.Errorf("cleared valueType = %q", patched.ValueType)
	}
	if _, err := flowNodes.Patch(ctx, schemaID, entities.FlowNodePatch{ValueType: &empty}, nil, "alex"); err != nil {
		t.Errorf("untyping an unused schema: %v", err)
	}
}

func TestValueCannotTypeItself(t *testing.T) {
	_, flowNodes, b := board(t)
	_, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{ID: schemaID, Title: "Self", Type: "value", Value: `{}`, ValueType: schemaID},
	}, "alex")
	if !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("self type err = %v, want ErrInvalid", err)
	}
}
