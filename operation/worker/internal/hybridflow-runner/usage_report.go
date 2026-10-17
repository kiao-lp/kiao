package hybridflowrunner

import (
	"math"
	"time"
)

// ── What a turn cost, told to the boards ──────────────────────────────────────
//
// A settled turn that ran for a card files what it spent on that card: the tokens the agent
// reported, in the store's own shape (task_usage). Muse and Codex turns report — the other agents'
// bills stay in their transcripts until their own mapping is written.
//
// The report never blocks the play. It is handed to the board store, which files it on the
// spool and returns — no network on the play loop — and the spool's sender posts it at once,
// then replays it after an outage like any other queued write. Same row, same id, so the
// replay lands on nothing rather than counting twice.

// UsageReport is one turn's bill, as the boards file it: the run, the model slug as said, and
// the tokens. CostUsdMicros is nil where the agent priced nothing — unknown, never free.
type UsageReport struct {
	ID               string
	RunID            string
	Model            string
	ReportedAt       time.Time
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
	CostUsdMicros    *int64
}

// newUsageReport turns the bill a settled turn filed into the report the boards keep. Nil is a
// turn that reported nothing — unknown, never free — and files nothing.
func newUsageReport(runID, model string, billed *turnUsage, at time.Time) *UsageReport {
	if billed == nil {
		return nil
	}
	report := &UsageReport{
		ID: newUsageReportID(), RunID: runID, Model: model, ReportedAt: at,
		InputTokens: billed.InputTokens, OutputTokens: billed.OutputTokens,
		CacheReadTokens: billed.CacheReadTokens, CacheWriteTokens: billed.CacheWriteTokens,
		ReasoningTokens: billed.ReasoningTokens,
	}
	// The store counts micro-dollars in integers, so sums stay exact; a turn whose agent said
	// no price — or priced it at nothing — travels unpriced rather than as a row of zeros.
	if billed.TotalCostUSD > 0 {
		micros := int64(math.Round(billed.TotalCostUSD * 1_000_000))
		report.CostUsdMicros = &micros
	}
	return report
}

// reportTurnUsage files a settled turn's bill on the card it ran for, where there is one to
// file. Interactive turns — no board, no card — and agents whose mapping is not written yet
// file nothing; a turn with no bill files nothing either, which reads as unknown.
//
// It returns with the filing handed off, not with it landed: the store queues the report and
// its sender posts it, so the play loop never waits on the network for it.
func (r *ChainRunner) reportTurnUsage(job *claudeJob) {
	if r == nil || r.boards == nil || job == nil {
		return
	}
	job.mu.Lock()
	agent, board, flowNodeID := job.agentName, job.board, job.flowNodeID
	runID, model := job.runID, job.model
	billed, at := job.usage, job.finishedAt
	job.mu.Unlock()
	if (agent != agentMuse && agent != agentCodex) || board == "" || flowNodeID == "" || billed == nil {
		return
	}
	if at.IsZero() {
		at = time.Now()
	}
	report := newUsageReport(runID, model, billed, at)
	if err := r.boards.ReportUsage(board, flowNodeID, *report); err != nil {
		logChainRun.Warn("the turn's usage could not be reported",
			"board", board, "flowNode", flowNodeID, "run", runID, "error", err)
	}
}
