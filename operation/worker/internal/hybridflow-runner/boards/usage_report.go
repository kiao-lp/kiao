package boards

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"math"
	"time"
)

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
func NewUsageReport(runID, model string, billed *agentapi.TurnUsage, at time.Time) *UsageReport {
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
