package entities

import (
	"encoding/json"
	"time"
)

// TaskUsage is an immutable report: corrections append rows; replays are idempotent.
// Cache and reasoning counts are parts of input/output, never added on top.
// Harness mappings are approximate and documented beside the table in the schema.
// Reports do not bump card revisions or emit change events. Totals are summed on read
// per card, board, or class through the card's class version.
type TaskUsage struct {
	// ID is reporter-generated and reused on replay to prevent double counting.
	ID string
	// FlowNodeID must name an AI card.
	FlowNodeID string
	// ReportedAt is the turn end on the reporter's clock, or arrival if unspecified.
	ReportedAt time.Time
	RunID string
	// Model is the harness slug; empty means unknown.
	Model            string
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
	// CostUsdMicros is in millionths of USD for exact sums; nil means unknown, not free.
	CostUsdMicros *int64
	// Extra is preserved verbatim and never interpreted.
	Extra json.RawMessage
}

// TaskUsageTotals sums reports. CostUsdMicros is nil if no report supplied a cost.
type TaskUsageTotals struct {
	Reports          int64
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
	CostUsdMicros    *int64
}
