package hybridflowrunner

import (
	"testing"
	"time"
)

// A turn's bill becomes the report the boards file: the tokens carried over, the cost in
// micro-dollars, the id minted so a replay names its row.
func TestNewUsageReportCarriesTheBill(t *testing.T) {
	at := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	report := newUsageReport("run-1", "muse-spark", &turnUsage{
		InputTokens: 100, OutputTokens: 50, CacheReadTokens: 10, CacheWriteTokens: 5,
		TotalCostUSD: 0.0234,
	}, at)
	if report == nil {
		t.Fatal("no report for a billed turn")
	}
	if report.ID == "" {
		t.Error("the report names no id")
	}
	if report.RunID != "run-1" || report.Model != "muse-spark" || !report.ReportedAt.Equal(at) {
		t.Errorf("report = %+v", report)
	}
	if report.InputTokens != 100 || report.OutputTokens != 50 ||
		report.CacheReadTokens != 10 || report.CacheWriteTokens != 5 {
		t.Errorf("tokens = %+v", report)
	}
	if report.CostUsdMicros == nil || *report.CostUsdMicros != 23400 {
		t.Errorf("cost = %v, want 23400", report.CostUsdMicros)
	}
}

// A turn whose agent priced nothing travels unpriced — unknown, never free — and a turn with
// no bill at all files nothing.
func TestNewUsageReportWithNoPriceOrNoBill(t *testing.T) {
	at := time.Now()
	report := newUsageReport("run-1", "", &turnUsage{InputTokens: 100}, at)
	if report == nil {
		t.Fatal("no report for an unpriced turn")
	}
	if report.CostUsdMicros != nil {
		t.Errorf("cost = %v, want none", *report.CostUsdMicros)
	}
	if newUsageReport("run-1", "", nil, at) != nil {
		t.Error("a turn with no bill files a report")
	}
}

func usageJob() *claudeJob {
	return &claudeJob{
		agentName: agentMuse, board: "major", flowNodeID: "flow-node-1",
		runID: "run-1", model: "muse-spark",
		usage:      &turnUsage{InputTokens: 100, OutputTokens: 50, TotalCostUSD: 0.01},
		finishedAt: time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC),
	}
}

// A settled Muse turn files its bill on the card it ran for.
func TestReportTurnUsageFilesAMuseTurn(t *testing.T) {
	boards := newMemoryBoards(t, map[string]*boardContent{"major": spoolBoard()})
	runner := &ChainRunner{boards: boards}
	runner.reportTurnUsage(usageJob())
	boards.mu.Lock()
	defer boards.mu.Unlock()
	if len(boards.usage) != 1 {
		t.Fatalf("%d bills filed, want one", len(boards.usage))
	}
	bill := boards.usage[0]
	if bill.RunID != "run-1" || bill.Model != "muse-spark" ||
		bill.InputTokens != 100 || bill.OutputTokens != 50 {
		t.Errorf("bill = %+v", bill)
	}
	if bill.CostUsdMicros == nil || *bill.CostUsdMicros != 10000 {
		t.Errorf("cost = %v, want 10000", bill.CostUsdMicros)
	}
	if bill.ReportedAt.IsZero() {
		t.Error("the bill has no stamp")
	}
}

func TestReportTurnUsageFilesCodexCacheAndReasoning(t *testing.T) {
	boards := newMemoryBoards(t, map[string]*boardContent{"major": spoolBoard()})
	runner := &ChainRunner{boards: boards}
	job := usageJob()
	job.agentName, job.model = agentCodex, "gpt-6.1-sol@priority"
	job.usage, _ = readCodexUsage(map[string]any{
		"input_tokens": float64(2000), "cached_input_tokens": float64(1200),
		"cache_write_input_tokens": float64(300), "output_tokens": float64(500),
		"reasoning_output_tokens": float64(400),
	}, nil)
	runner.reportTurnUsage(job)
	boards.mu.Lock()
	defer boards.mu.Unlock()
	if len(boards.usage) != 1 {
		t.Fatalf("%d bills filed, want one", len(boards.usage))
	}
	bill := boards.usage[0]
	if bill.Model != job.model || bill.InputTokens != 2000 || bill.OutputTokens != 500 ||
		bill.CacheReadTokens != 1200 || bill.CacheWriteTokens != 300 || bill.ReasoningTokens != 400 || bill.CostUsdMicros != nil {
		t.Errorf("bill = %+v, want the Codex breakdown without a price", bill)
	}
}

// Anything else files nothing: another agent's turn, a turn typed into the chat rather than
// played for a card, and a Muse turn the host billed nothing for.
func TestReportTurnUsageFilesNothingElse(t *testing.T) {
	cases := map[string]func(*claudeJob){
		"another agent": func(job *claudeJob) { job.agentName = agentClaude },
		"no board":      func(job *claudeJob) { job.board = "" },
		"no card":       func(job *claudeJob) { job.flowNodeID = "" },
		"no bill":       func(job *claudeJob) { job.usage = nil },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			boards := newMemoryBoards(t, map[string]*boardContent{"major": spoolBoard()})
			runner := &ChainRunner{boards: boards}
			job := usageJob()
			change(job)
			runner.reportTurnUsage(job)
			boards.mu.Lock()
			defer boards.mu.Unlock()
			if len(boards.usage) != 0 {
				t.Errorf("%d bills filed, want none", len(boards.usage))
			}
		})
	}
}

// No store, no filing — and no panic: a runner with no boards plays nothing, but it still
// settles turns.
func TestReportTurnUsageWithoutBoardsFilesNothing(t *testing.T) {
	runner := &ChainRunner{}
	runner.reportTurnUsage(usageJob())
	runner.reportTurnUsage(nil)
}
