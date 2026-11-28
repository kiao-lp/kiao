package postgres

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func TestParallelGatewayClaimsOneReplayPerSetOfResults(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Parallel"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	ids := uuidIDs{store: store}
	join, left, right := ids.NewID(), ids.NewID(), ids.NewID()
	if _, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{ID: join, Title: "Join", Type: "gateway"},
		{ID: left, Title: "Left", Type: "scheduler", Duration: "1ms", Next: join},
		{ID: right, Title: "Right", Type: "scheduler", Duration: "1ms", Next: join},
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	complete := func(id, run string, arrival ...bool) {
		t.Helper()
		if _, err := nodes.StartPlay(ctx, id, run, "alex", arrival...); err != nil {
			t.Fatal(err)
		}
		if _, err := nodes.EndPlay(ctx, id, run, "alex", entities.PlayResult{Status: entities.StatusDone}); err != nil {
			t.Fatal(err)
		}
	}
	complete(left, "left-1")
	complete(right, "right-1")
	complete(join, "join-1", true)
	complete(left, "left-2")
	if _, err := nodes.StartPlay(ctx, join, "early", "alex", true); !errors.Is(err, entities.ErrGatewayWaiting) {
		t.Fatalf("claim with one previous result: %v", err)
	}
	complete(right, "right-2")
	complete(join, "join-2", true)
	if _, err := nodes.StartPlay(ctx, join, "late", "alex", true); !errors.Is(err, entities.ErrGatewayWaiting) {
		t.Fatalf("duplicate arrival after the winner released the flow node: %v", err)
	}
	complete(join, "explicit-replay")
}

func TestExclusiveGatewayRoutesFollowTheirLinks(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Decisions"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	ids := uuidIDs{store: store}
	decision, left, right, extra := ids.NewID(), ids.NewID(), ids.NewID(), ids.NewID()
	first := entities.Route{Condition: "input.approved", FlowNode: left}
	last := entities.Route{Condition: "true", FlowNode: right}
	if _, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{ID: decision, Type: "exclusive-gateway", Nexts: []string{left, right}, Routes: []entities.Route{first, last}},
		{ID: left, Title: "Publish"}, {ID: right, Title: "Review"},
		{Title: "Input", Next: decision},
		{ID: extra, Title: "Alternative input"},
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	assertRoutes := func(want []entities.Route) {
		t.Helper()
		got, err := store.FindFlowNode(ctx, decision)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(got.Routes, want) {
			t.Fatalf("routes = %+v, want %+v", got.Routes, want)
		}
	}
	assertRoutes([]entities.Route{first, last})

	routes := []entities.Route{last, first}
	if _, err := nodes.Patch(ctx, decision, entities.FlowNodePatch{Routes: &routes}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	assertRoutes(routes)
	if _, err := nodes.Patch(ctx, decision, entities.FlowNodePatch{Nexts: &[]string{right, left}}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	assertRoutes(routes)

	if _, err := store.PatchFlowNode(ctx, extra, entities.FlowNodePatch{Next: &decision}, nil, "alex"); err != nil {
		t.Fatalf("second exclusive predecessor: %v", err)
	}
	if _, err := nodes.Patch(ctx, decision, entities.FlowNodePatch{Nexts: &[]string{left}}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	assertRoutes([]entities.Route{first})
	if _, err := nodes.Patch(ctx, decision, entities.FlowNodePatch{Routes: &routes}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("unlinked target: got %v, want an invalid route", err)
	}
	if err := nodes.Delete(ctx, []string{left}, "alex"); err != nil {
		t.Fatal(err)
	}
	assertRoutes(nil)
}

func TestConnectionMigrationRetainsLegacyJoins(t *testing.T) {
	pool := testPoolAtVersion(t, 30)
	ctx := context.Background()
	const boardID = "11111111-1111-4111-8111-111111111111"
	const first = "22222222-2222-4222-8222-222222222222"
	const second = "33333333-3333-4333-8333-333333333333"
	const target = "44444444-4444-4444-8444-444444444444"
	if _, err := pool.Exec(ctx, `
        INSERT INTO board (id, name, slug) VALUES ($1, 'Legacy', 'legacy');
    `, boardID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO flow_node (id, board_id, title, type, status)
        VALUES ($1, $4, 'First', 'human', 'ready'), ($2, $4, 'Fork', 'gateway', 'ready'),
               ($3, $4, 'Target', 'scheduler', 'ready')`, first, second, target, boardID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE flow_node SET on_success_flow_node_id = $2 WHERE id = $1`, first, target); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO flow_node_successor VALUES ($1, $2, 0)`, second, target); err != nil {
		t.Fatal(err)
	}
	if _, err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM flow_node_successor WHERE successor_id = $1`, target).Scan(&count); err != nil || count != 2 {
		t.Fatalf("legacy connections = %d, %v", count, err)
	}
	store := NewBoardStore(pool)
	held, err := store.FindFlowNode(ctx, first)
	if err != nil || held.Next != target {
		t.Fatalf("successor after migration = %+v, %v", held, err)
	}
	empty := ""
	if _, err := store.PatchFlowNode(ctx, first, entities.FlowNodePatch{Next: &empty}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'flow_node' AND column_name = 'on_success_flow_node_id'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("legacy successor column count = %d, %v", count, err)
	}
}

func TestConcurrentPredecessorsHaveOneWinner(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	b, err := boards.Create(ctx, services.NewBoardRequest{Name: "Concurrent links"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First"}, {Title: "Fork", Type: "gateway"}, {Title: "Target"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var writers sync.WaitGroup
	for i := 0; i < 2; i++ {
		writers.Add(1)
		go func(i int) {
			defer writers.Done()
			<-start
			target := made[2].ID
			patch := entities.FlowNodePatch{Next: &target}
			if i == 1 {
				nexts := []string{target}
				patch = entities.FlowNodePatch{Nexts: &nexts}
			}
			_, err := store.PatchFlowNode(ctx, made[i].ID, patch, nil, "alex")
			results <- err
		}(i)
	}
	close(start)
	writers.Wait()
	close(results)
	won, refused := 0, 0
	for err := range results {
		if err == nil {
			won++
		} else if errors.Is(err, entities.ErrInvalid) {
			refused++
		} else {
			t.Fatal(err)
		}
	}
	if won != 1 || refused != 1 {
		t.Fatalf("winners = %d, refused = %d", won, refused)
	}
}

func TestStartEventHasAnOutgoingLinkAndRejectsIncomingLinks(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	b, err := boards.Create(ctx, services.NewBoardRequest{Name: "Start event"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := nodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Start", Type: "start"}, {Title: "Review"}, {Title: "Other"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	start, review, other := made[0].ID, made[1].ID, made[2].ID
	if _, err := nodes.Chain(ctx, start, review, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := nodes.Chain(ctx, other, start, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("incoming chain = %v, want invalid", err)
	}
	if _, err := store.PatchFlowNode(ctx, other, entities.FlowNodePatch{Next: &start}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("incoming database link = %v, want invalid", err)
	}
	kind := entities.FlowNodeStart
	patch := entities.FlowNodePatch{Type: &kind}
	if _, err := nodes.Patch(ctx, review, patch, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("retyping a successor = %v, want invalid", err)
	}
	if _, err := store.PatchFlowNode(ctx, review, patch, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("retyping a database successor = %v, want invalid", err)
	}
	if _, err := nodes.StartPlay(ctx, start, "run", "alex"); err != nil {
		t.Fatal(err)
	}
	done, err := nodes.EndPlay(ctx, start, "run", "alex", entities.PlayResult{Status: entities.StatusDone})
	if err != nil {
		t.Fatal(err)
	}
	if done.Type != kind || done.Status != entities.StatusDone || done.Next != review {
		t.Fatalf("completed Start event = %+v", done)
	}
}

func TestDeferredConnectionValidationRejectsAPastedJoin(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	b, err := boards.Create(ctx, services.NewBoardRequest{Name: "Pasted join"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	const first = "22222222-2222-4222-8222-222222222222"
	const second = "33333333-3333-4333-8333-333333333333"
	const target = "44444444-4444-4444-8444-444444444444"
	batch := []*entities.FlowNode{
		{ID: first, BoardID: b.ID, Title: "First", Type: entities.FlowNodeHuman, Status: entities.StatusReady, Next: target},
		{ID: second, BoardID: b.ID, Title: "Fork", Type: entities.FlowNodeGateway, Status: entities.StatusReady, Nexts: []string{target}},
		{ID: target, BoardID: b.ID, Title: "Target", Type: entities.FlowNodeHuman, Status: entities.StatusReady},
	}
	if err := store.CreateFlowNodes(ctx, batch, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("pasted join = %v", err)
	}
	held, err := nodes.Board(ctx, b.ID)
	if err != nil || len(held) != 0 {
		t.Fatalf("board after refused batch = %+v, %v", held, err)
	}
}
