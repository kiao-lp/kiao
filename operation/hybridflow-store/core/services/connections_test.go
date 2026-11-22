package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestSinglePredecessorAcrossChainAndPatch(t *testing.T) {
	for _, kind := range []string{"ai", "human", "scheduler", "shutdown"} {
		t.Run(kind, func(t *testing.T) {
			_, nodes, b := board(t)
			ctx := context.Background()
			made, err := nodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
				{Title: "First"}, {Title: "Fork", Type: "gateway"}, {Title: "Target", Type: kind},
			}, "alex")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := nodes.Chain(ctx, made[0].ID, made[2].ID, "alex"); err != nil {
				t.Fatal(err)
			}
			if _, err := nodes.Chain(ctx, made[1].ID, made[2].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
				t.Fatalf("second predecessor = %v", err)
			}
			nexts := []string{made[2].ID}
			if _, err := nodes.Patch(ctx, made[1].ID, entities.FlowNodePatch{Nexts: &nexts}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
				t.Fatalf("patched second predecessor = %v", err)
			}
			if _, err := nodes.Chain(ctx, made[0].ID, "", "alex"); err != nil {
				t.Fatal(err)
			}
			if _, err := nodes.Chain(ctx, made[1].ID, made[2].ID, "alex"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGatewayJoinCannotBecomeATask(t *testing.T) {
	_, nodes, b := board(t)
	ctx := context.Background()
	made, err := nodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First"}, {Title: "Second"}, {Title: "Join", Type: "gateway"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range made[:2] {
		if _, err := nodes.Chain(ctx, source.ID, made[2].ID, "alex"); err != nil {
			t.Fatal(err)
		}
	}
	kind := entities.FlowNodeHuman
	if _, err := nodes.Patch(ctx, made[2].ID, entities.FlowNodePatch{Type: &kind}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("retyped join = %v", err)
	}
}

func TestPastedJoinIsRejectedAtomically(t *testing.T) {
	_, nodes, b := board(t)
	ctx := context.Background()
	const target = "11111111-1111-4111-8111-111111111111"
	_, err := nodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Next: target}, {Title: "Fork", Type: "gateway", Nexts: []string{target}},
		{ID: target, Title: "Target"},
	}, "alex")
	if !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("pasted join = %v", err)
	}
	held, err := nodes.Board(ctx, b.ID)
	if err != nil || len(held) != 0 {
		t.Fatalf("board = %+v, %v", held, err)
	}
}
