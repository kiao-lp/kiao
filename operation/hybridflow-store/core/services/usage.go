package services

import (
	"context"
	"strings"
	"time"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Usage is what the AI cards spent: one row per report a runner filed.
//
// What it does **not** do is price one — the cost travels on the report, in the reporter's own
// figures, and a report that carries none is unknown rather than free. This half files what the
// harnesses said and sums it back, per card.
type Usage struct {
	repo   ports.UsageRepository
	boards ports.BoardRepository
	clock  ports.Clock
	ids    ports.IDs
}

func NewUsage(repo ports.UsageRepository, boards ports.BoardRepository, clock ports.Clock, ids ports.IDs) *Usage {
	return &Usage{repo: repo, boards: boards, clock: clock, ids: ids}
}

// RecordUsageRequest is one report to be filed: the card, the run, the model slug as said, and
// the tokens. The id is the reporter's to mint — a spool replay re-sends the same row — or empty
// to have one minted here, which a replay then cannot name again.
type RecordUsageRequest struct {
	ID               string
	FlowNodeID       string
	ReportedAt       *time.Time
	RunID            string
	Model            string
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
	CostUsdMicros    *int64
	Extra            []byte
}

func (r *Usage) Record(ctx context.Context, req RecordUsageRequest) (*entities.TaskUsage, error) {
	flowNodeID := strings.TrimSpace(req.FlowNodeID)
	flowNode, err := r.boards.FindFlowNode(ctx, flowNodeID)
	if err != nil {
		return nil, err
	}
	if flowNode.Type != entities.FlowNodeAI {
		return nil, entities.Invalidf("usage is an AI card's; this one is %s", flowNode.Type)
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = r.ids.NewID()
	} else if !entities.ValidID(id) {
		return nil, entities.Invalidf("%q is not an id this store can hold", req.ID)
	}
	for name, tokens := range map[string]int64{
		"input": req.InputTokens, "output": req.OutputTokens,
		"cache read": req.CacheReadTokens, "cache write": req.CacheWriteTokens,
		"reasoning": req.ReasoningTokens,
	} {
		if tokens < 0 {
			return nil, entities.Invalidf("a report holds no negative %s tokens", name)
		}
	}
	if req.CostUsdMicros != nil && *req.CostUsdMicros < 0 {
		return nil, entities.Invalidf("a report holds no negative cost")
	}
	reportedAt := r.clock.Now()
	if req.ReportedAt != nil && !req.ReportedAt.IsZero() {
		reportedAt = *req.ReportedAt
	}
	usage := &entities.TaskUsage{
		ID: id, FlowNodeID: flowNode.ID, ReportedAt: reportedAt,
		RunID: strings.TrimSpace(req.RunID), Model: strings.TrimSpace(req.Model),
		InputTokens: req.InputTokens, OutputTokens: req.OutputTokens,
		CacheReadTokens: req.CacheReadTokens, CacheWriteTokens: req.CacheWriteTokens,
		ReasoningTokens: req.ReasoningTokens, CostUsdMicros: req.CostUsdMicros,
		Extra: req.Extra,
	}
	if err := r.repo.RecordUsage(ctx, usage); err != nil {
		return nil, err
	}
	return usage, nil
}

// Totals is what one card spent, whole: the sums of its reports. A card the store does not
// hold is not found rather than zero — zero is what a card with no reports spent.
func (r *Usage) Totals(ctx context.Context, flowNodeID string) (entities.TaskUsageTotals, error) {
	if _, err := r.boards.FindFlowNode(ctx, strings.TrimSpace(flowNodeID)); err != nil {
		return entities.TaskUsageTotals{}, err
	}
	return r.repo.UsageTotals(ctx, strings.TrimSpace(flowNodeID))
}
