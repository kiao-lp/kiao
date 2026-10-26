package services_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func newUsage(t *testing.T) (*services.Usage, *services.FlowNodes, *entities.Board) {
	t.Helper()
	store := memory.New()
	clock := fixedClock{at: time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)}
	ids := &countingIDs{}
	boards := services.NewBoards(store, clock, ids)
	agents := services.NewAgents(store, clock, ids)
	flowNodes := services.NewFlowNodes(store, store, store, store, store, clock, ids)
	ctx := context.Background()
	// First, so the id is the one aiSettings names: boards are minted after it.
	if _, err := agents.Create(ctx, services.NewAgentRequest{Name: "Reviewer", Platform: "claude", Model: "opus"}, "alex"); err != nil {
		t.Fatal(err)
	}
	made, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return services.NewUsage(store, store, clock, ids), flowNodes, made
}

func aiCard(t *testing.T, flowNodes *services.FlowNodes, boardID string) entities.FlowNode {
	t.Helper()
	made, err := flowNodes.Create(context.Background(), boardID, []services.NewFlowNodeRequest{
		{Title: "Play it", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return made[0]
}

func micros(n int64) *int64 { return &n }

// A report with no id and no stamp is filed under a minted id, at now: the runner names its
// rows, and one that did not still gets its bill filed.
func TestRecordMintsTheIDAndStampsNow(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	filed, err := usage.Record(context.Background(), services.RecordUsageRequest{
		FlowNodeID: card.ID, RunID: "run-1", Model: "muse-spark",
		InputTokens: 100, OutputTokens: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if filed.ID == "" {
		t.Error("the report has no id")
	}
	if filed.ReportedAt.IsZero() {
		t.Error("the report has no stamp")
	}
	if filed.FlowNodeID != card.ID || filed.RunID != "run-1" || filed.Model != "muse-spark" {
		t.Errorf("report = %+v", filed)
	}
	if filed.CostUsdMicros != nil {
		t.Errorf("cost = %v, want none where the harness priced nothing", *filed.CostUsdMicros)
	}
}

// What the reporter said is kept: the id its replay names, the turn's end on its clock, and
// the price in its own figures.
func TestRecordKeepsWhatTheReporterSaid(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	at := time.Date(2026, 9, 12, 7, 30, 0, 0, time.UTC)
	filed, err := usage.Record(context.Background(), services.RecordUsageRequest{
		ID: "123e4567-e89b-42d3-a456-426614174000", FlowNodeID: card.ID, ReportedAt: &at,
		RunID: "run-1", Model: "muse-spark",
		InputTokens: 100, OutputTokens: 50, CacheReadTokens: 10, CacheWriteTokens: 5,
		ReasoningTokens: 7, CostUsdMicros: micros(23400),
	})
	if err != nil {
		t.Fatal(err)
	}
	if filed.ID != "123e4567-e89b-42d3-a456-426614174000" {
		t.Errorf("id = %q, want the reporter's", filed.ID)
	}
	if !filed.ReportedAt.Equal(at) {
		t.Errorf("reported at = %v, want %v", filed.ReportedAt, at)
	}
	if filed.CostUsdMicros == nil || *filed.CostUsdMicros != 23400 {
		t.Errorf("cost = %v, want 23400", filed.CostUsdMicros)
	}
	if filed.ReasoningTokens != 7 {
		t.Errorf("reasoning = %d, want 7", filed.ReasoningTokens)
	}
}

func TestRecordRefusesWhatIsNotAnAICard(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	ctx := context.Background()
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: "no-such-card",
	}); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("record on a missing card = %v, want not found", err)
	}
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Do it"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: made[0].ID,
	}); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("record on a human card = %v, want invalid", err)
	}
}

func TestRecordRefusesAMalformedIDAndNegativeFigures(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	ctx := context.Background()
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		ID: "not-an-id", FlowNodeID: card.ID,
	}); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("record with a malformed id = %v, want invalid", err)
	}
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: card.ID, OutputTokens: -1,
	}); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("record with negative tokens = %v, want invalid", err)
	}
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: card.ID, CostUsdMicros: micros(-1),
	}); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("record with a negative cost = %v, want invalid", err)
	}
}

// The same id twice is the same report twice: a spool replay lands on nothing rather than
// counting twice.
func TestRecordingTwiceCountsOnce(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	ctx := context.Background()
	req := services.RecordUsageRequest{
		ID: "123e4567-e89b-42d3-a456-426614174000", FlowNodeID: card.ID,
		InputTokens: 100, OutputTokens: 50,
	}
	if _, err := usage.Record(ctx, req); err != nil {
		t.Fatal(err)
	}
	if _, err := usage.Record(ctx, req); err != nil {
		t.Fatal(err)
	}
	totals, err := usage.Totals(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 1 || totals.InputTokens != 100 || totals.OutputTokens != 50 {
		t.Errorf("totals = %+v, want the one report", totals)
	}
}

func TestTotalsSumTheReports(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	ctx := context.Background()
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: card.ID, InputTokens: 100, OutputTokens: 50, CostUsdMicros: micros(1000),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: card.ID, InputTokens: 200, OutputTokens: 30,
		CacheReadTokens: 40, ReasoningTokens: 9, CostUsdMicros: micros(2000),
	}); err != nil {
		t.Fatal(err)
	}
	totals, err := usage.Totals(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 2 || totals.InputTokens != 300 || totals.OutputTokens != 80 ||
		totals.CacheReadTokens != 40 || totals.ReasoningTokens != 9 {
		t.Errorf("totals = %+v", totals)
	}
	if totals.CostUsdMicros == nil || *totals.CostUsdMicros != 3000 {
		t.Errorf("cost = %v, want 3000", totals.CostUsdMicros)
	}
}

// No priced report is no priced cost: unknown, never zero.
func TestTotalsWithNoPricedReportCarryNoCost(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	ctx := context.Background()
	if _, err := usage.Record(ctx, services.RecordUsageRequest{
		FlowNodeID: card.ID, InputTokens: 100,
	}); err != nil {
		t.Fatal(err)
	}
	totals, err := usage.Totals(ctx, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if totals.CostUsdMicros != nil {
		t.Errorf("cost = %v, want none", *totals.CostUsdMicros)
	}
}

func TestTotalsOnAMissingCardIsNotFound(t *testing.T) {
	usage, _, _ := newUsage(t)
	if _, err := usage.Totals(context.Background(), "no-such-card"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("totals = %v, want not found", err)
	}
}

// A card with no reports spent zeros — which is what an AI card that never ran totals, and not
// an error.
func TestTotalsOnACardWithNoReportsIsZeros(t *testing.T) {
	usage, flowNodes, b := newUsage(t)
	card := aiCard(t, flowNodes, b.ID)
	totals, err := usage.Totals(context.Background(), card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if totals.Reports != 0 || totals.InputTokens != 0 || totals.OutputTokens != 0 || totals.CostUsdMicros != nil {
		t.Errorf("totals = %+v, want zeros", totals)
	}
}
