package runnerhttp

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	codexcli "kiao/worker/internal/hybridflow-runner/agents/codex"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"testing"
	"time"
)

// A turn's bill becomes the report the boards file: the tokens carried over, the cost in
// micro-dollars, the id minted so a replay names its row.
func TestNewUsageReportCarriesTheBill(t *testing.T) {
	at := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	report := pkgBoards.NewUsageReport("run-1", "muse-spark", &agentapi.TurnUsage{
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
	report := pkgBoards.NewUsageReport("run-1", "", &agentapi.TurnUsage{InputTokens: 100}, at)
	if report == nil {
		t.Fatal("no report for an unpriced turn")
	}
	if report.CostUsdMicros != nil {
		t.Errorf("cost = %v, want none", *report.CostUsdMicros)
	}
	if pkgBoards.NewUsageReport("run-1", "", nil, at) != nil {
		t.Error("a turn with no bill files a report")
	}
}

func usageJob() *pkgTurns.Turn {
	return &pkgTurns.Turn{
		AgentName: agentapi.AgentMuse, Board: "major", FlowNodeID: "flow-node-1",
		RunID: "run-1", Model: "muse-spark",
		Usage:      &agentapi.TurnUsage{InputTokens: 100, OutputTokens: 50, TotalCostUSD: 0.01},
		FinishedAt: time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC),
	}
}

// A settled Muse turn files its bill on the card it ran for.
func TestReportTurnUsageFilesAMuseTurn(t *testing.T) {
	boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": spoolBoard()})
	runner := &playback.ChainRunner{Boards: boards}
	runner.ReportTurnUsage(usageJob())
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
	boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": spoolBoard()})
	runner := &playback.ChainRunner{Boards: boards}
	job := usageJob()
	job.AgentName, job.Model = agentapi.AgentCodex, "gpt-6.1-sol@priority"
	job.Usage, _ = codexcli.ReadCodexUsage(map[string]any{
		"input_tokens": float64(2000), "cached_input_tokens": float64(1200),
		"cache_write_input_tokens": float64(300), "output_tokens": float64(500),
		"reasoning_output_tokens": float64(400),
	}, nil)
	runner.ReportTurnUsage(job)
	boards.mu.Lock()
	defer boards.mu.Unlock()
	if len(boards.usage) != 1 {
		t.Fatalf("%d bills filed, want one", len(boards.usage))
	}
	bill := boards.usage[0]
	if bill.Model != job.Model || bill.InputTokens != 2000 || bill.OutputTokens != 500 ||
		bill.CacheReadTokens != 1200 || bill.CacheWriteTokens != 300 || bill.ReasoningTokens != 400 || bill.CostUsdMicros != nil {
		t.Errorf("bill = %+v, want the Codex breakdown without a price", bill)
	}
}

// Anything else files nothing: another agent's turn, a turn typed into the chat rather than
// played for a card, and a Muse turn the host billed nothing for.
func TestReportTurnUsageFilesNothingElse(t *testing.T) {
	cases := map[string]func(*pkgTurns.Turn){
		"another agent": func(job *pkgTurns.Turn) { job.AgentName = agentapi.AgentClaude },
		"no board":      func(job *pkgTurns.Turn) { job.Board = "" },
		"no card":       func(job *pkgTurns.Turn) { job.FlowNodeID = "" },
		"no bill":       func(job *pkgTurns.Turn) { job.Usage = nil },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			boards := newMemoryBoards(t, map[string]*pkgBoards.BoardContent{"major": spoolBoard()})
			runner := &playback.ChainRunner{Boards: boards}
			job := usageJob()
			change(job)
			runner.ReportTurnUsage(job)
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
	runner := &playback.ChainRunner{}
	runner.ReportTurnUsage(usageJob())
	runner.ReportTurnUsage(nil)
}
