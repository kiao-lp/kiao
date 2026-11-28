package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

// wireUsage is wire with the pool beside it: the usage store has to share the test's schema,
// and wire keeps its pool to itself.
func wireUsage(t *testing.T) (*pgxpool.Pool, *services.Boards, *services.FlowNodes, *BoardStore, *ChangeStore) {
	t.Helper()
	pool := testPool(t)
	boardStore := NewBoardStore(pool)
	agentStore := agentRepository(t)
	runnerStore := NewRunnerStore(pool)
	changeStore := NewChangeStore(pool)
	ids := uuidIDs{store: boardStore}
	return pool,
		services.NewBoards(boardStore, realClock{}, ids),
		services.NewFlowNodes(boardStore, agentStore, runnerStore, boardStore, realClock{}, ids),
		boardStore, changeStore
}

func aiUsageNode(t *testing.T, boards *services.Boards, flowNodes *services.FlowNodes, name string) string {
	t.Helper()
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: name}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Write it", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return made[0].ID
}

// A usage report round-trips through the database: filed under the reporter's id, summed back
// in the flow node's totals, with an unpriced cost staying unknown rather than zero.
func TestUsageRoundTrip(t *testing.T) {
	pool, boards, flowNodes, _, _ := wireUsage(t)
	store := NewUsageStore(pool)
	ctx := context.Background()
	node := aiUsageNode(t, boards, flowNodes, "Major")
	priced := int64(23400)
	now := time.Now().UTC().Truncate(time.Millisecond)
	if err := store.RecordUsage(ctx, &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000a1", FlowNodeID: node,
		ReportedAt: now, RunID: "run-1", Model: "muse-spark",
		InputTokens: 100, OutputTokens: 50, CacheReadTokens: 10, CacheWriteTokens: 5,
		ReasoningTokens: 7, CostUsdMicros: &priced,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordUsage(ctx, &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000a2", FlowNodeID: node,
		ReportedAt: now, RunID: "run-1", InputTokens: 200, OutputTokens: 30,
	}); err != nil {
		t.Fatal(err)
	}
	totals, err := store.UsageTotals(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 2 || totals.InputTokens != 300 || totals.OutputTokens != 80 ||
		totals.CacheReadTokens != 10 || totals.CacheWriteTokens != 5 || totals.ReasoningTokens != 7 {
		t.Errorf("totals = %+v", totals)
	}
	if totals.CostUsdMicros == nil || *totals.CostUsdMicros != 23400 {
		t.Errorf("cost = %v, want 23400", totals.CostUsdMicros)
	}
}

// The same id twice is the same report twice: the replay lands on nothing, and the totals
// count the report once.
func TestUsageRerecordIsADoubleCountNowhere(t *testing.T) {
	pool, boards, flowNodes, _, _ := wireUsage(t)
	store := NewUsageStore(pool)
	ctx := context.Background()
	node := aiUsageNode(t, boards, flowNodes, "Major")
	report := &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000b1", FlowNodeID: node,
		ReportedAt: time.Now().UTC(), InputTokens: 100, OutputTokens: 50,
	}
	if err := store.RecordUsage(ctx, report); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordUsage(ctx, report); err != nil {
		t.Fatal(err)
	}
	totals, err := store.UsageTotals(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 1 || totals.InputTokens != 100 {
		t.Errorf("totals = %+v, want the one report", totals)
	}
}

// The foreign key names the task: a report on a flow node that is not there — or on one that is no
// task — is not found rather than filed.
func TestUsageOnNoFlowNodeIsNotFound(t *testing.T) {
	pool, _, _, _, _ := wireUsage(t)
	store := NewUsageStore(pool)
	if err := store.RecordUsage(context.Background(), &entities.TaskUsage{
		ID:         "00000000-0000-4000-8000-0000000000c1",
		FlowNodeID: "00000000-0000-4000-8000-0000000000c9",
		ReportedAt: time.Now().UTC(), InputTokens: 1,
	}); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("record on a missing flow node = %v, want not found", err)
	}
}

// The checks hold what the service validates: no negative figures reach the table, whatever the
// caller.
func TestUsageRefusesNegativeFigures(t *testing.T) {
	pool, boards, flowNodes, _, _ := wireUsage(t)
	store := NewUsageStore(pool)
	ctx := context.Background()
	node := aiUsageNode(t, boards, flowNodes, "Major")
	if err := store.RecordUsage(ctx, &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000d1", FlowNodeID: node,
		ReportedAt: time.Now().UTC(), OutputTokens: -1,
	}); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("negative tokens = %v, want invalid", err)
	}
}

// Deleting the flow node takes its reports with it: the spend is the flow node's, and a flow node that has
// gone has no spend to sum.
func TestUsageGoesWithItsFlowNode(t *testing.T) {
	pool, boards, flowNodes, boardStore, _ := wireUsage(t)
	store := NewUsageStore(pool)
	ctx := context.Background()
	node := aiUsageNode(t, boards, flowNodes, "Major")
	if err := store.RecordUsage(ctx, &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000e1", FlowNodeID: node,
		ReportedAt: time.Now().UTC(), InputTokens: 100,
	}); err != nil {
		t.Fatal(err)
	}
	if err := boardStore.DeleteFlowNodes(ctx, []string{node}, "alex"); err != nil {
		t.Fatal(err)
	}
	totals, err := store.UsageTotals(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 0 || totals.InputTokens != 0 {
		t.Errorf("totals after the delete = %+v, want zeros", totals)
	}
}

// A usage write moves nothing but its own row: the flow node's revision stands still, and the feed
// hears nothing of it.
func TestUsageWritesNothingButItsRow(t *testing.T) {
	pool, boards, flowNodes, _, changes := wireUsage(t)
	store := NewUsageStore(pool)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Write it", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	node := made[0]
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordUsage(ctx, &entities.TaskUsage{
		ID: "00000000-0000-4000-8000-0000000000f1", FlowNodeID: node.ID,
		ReportedAt: time.Now().UTC(), InputTokens: 100,
	}); err != nil {
		t.Fatal(err)
	}
	again, err := flowNodes.Find(ctx, node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.Revision != node.Revision {
		t.Errorf("revision = %d, want %d: the report moves nothing on the flow node", again.Revision, node.Revision)
	}
	feed, _, err := changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed) != 0 {
		t.Errorf("feed = %+v, want nothing: the report writes no change", feed)
	}
}
