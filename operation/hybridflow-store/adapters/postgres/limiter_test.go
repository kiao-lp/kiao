package postgres

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestLimiterCountsPassesAndRejectsDuplicateRevisions(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Limiter"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	ids := uuidIDs{store: store}
	limiter, first, second, extra := ids.NewID(), ids.NewID(), ids.NewID(), ids.NewID()
	maximum := 2
	_, err = nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{ID: limiter, Type: "limiter", MaxPasses: &maximum, Nexts: []string{first, second}},
		{ID: first}, {ID: second}, {ID: extra},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	read := func() *entities.FlowNode {
		t.Helper()
		node, err := nodes.Find(ctx, limiter)
		if err != nil {
			t.Fatal(err)
		}
		return node
	}
	node := read()
	if node.MaxPasses != 2 || node.RemainingPasses != 2 {
		t.Fatalf("initial counts = %d/%d", node.RemainingPasses, node.MaxPasses)
	}
	if _, err := store.PatchFlowNode(ctx, limiter, entities.FlowNodePatch{Nexts: &[]string{first, second, extra}}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("adding a third successor = %v, want invalid", err)
	}

	revision := node.Revision
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, _, err := nodes.PassLimiter(ctx, limiter, revision, "", "runner")
			results <- err
		}()
	}
	conflicts, successes := 0, 0
	for range 2 {
		switch err := <-results; {
		case errors.Is(err, entities.ErrConflict):
			conflicts++
		case err == nil:
			successes++
		default:
			t.Fatal(err)
		}
	}
	if node = read(); node.RemainingPasses != 1 || conflicts != 1 || successes != 1 {
		t.Fatalf("after concurrent passes = %d remaining, %d successes, %d conflicts", node.RemainingPasses, successes, conflicts)
	}
	pass := func(wantNext string, wantRemaining int) {
		t.Helper()
		const output = `{"count": 2}`
		current := read()
		completed, next, err := nodes.PassLimiter(ctx, limiter, current.Revision, output, "runner")
		if err != nil {
			t.Fatal(err)
		}
		if next != wantNext || completed.RemainingPasses != wantRemaining ||
			completed.Status != entities.StatusDone || completed.Output != output || completed.Revision <= current.Revision {
			t.Fatalf("pass picked %s and returned %+v", next, completed)
		}
	}
	pass(first, 0)
	pass(second, 0)
	pass(second, 0)

	node, err = nodes.Patch(ctx, limiter, entities.FlowNodePatch{ResetPasses: true, Nexts: &[]string{second, first}}, nil, "alex")
	if err != nil || node.RemainingPasses != 2 || node.MaxPasses != 2 {
		t.Fatalf("reset and swap = %+v, %v", node, err)
	}
	pass(second, 1)

	zero := 0
	node, err = nodes.Patch(ctx, limiter, entities.FlowNodePatch{MaxPasses: &zero}, nil, "alex")
	if err != nil || node.RemainingPasses != 0 || node.MaxPasses != 0 {
		t.Fatalf("maximum zero = %+v, %v", node, err)
	}
	pass(first, 0)

	archived := true
	if _, err := nodes.Patch(ctx, second, entities.FlowNodePatch{Archived: &archived}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := nodes.PassLimiter(ctx, limiter, read().Revision, "", "runner"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("a missing live branch should refuse play, got %v", err)
	}
}
