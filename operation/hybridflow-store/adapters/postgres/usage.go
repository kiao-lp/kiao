package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// UsageStore is ports.UsageRepository over PostgreSQL: what the AI cards spent, one row per
// report a runner filed.
//
// It is a store of its own rather than a method set on the board's, for the reason the port is
// one: a usage log is an append beside the cards — rows are never updated, carry no revision,
// and write no change event. The writes here run outside inTx for the same reason: there is no
// change row to share a transaction with, and no actor to set for one.
type UsageStore struct {
	pool *pgxpool.Pool
}

// NewUsageStore wires the store to a pool.
func NewUsageStore(pool *pgxpool.Pool) *UsageStore { return &UsageStore{pool: pool} }

var _ ports.UsageRepository = (*UsageStore)(nil)

func (s *UsageStore) RecordUsage(ctx context.Context, usage *entities.TaskUsage) error {
	var extra any
	if len(usage.Extra) > 0 {
		extra = string(usage.Extra)
	}
	// The same id twice is the same report twice — a spool replay re-sends the row — so the
	// second insert lands on nothing rather than counting twice.
	_, err := s.pool.Exec(ctx, `
		INSERT INTO task_usage (id, flow_node_id, reported_at, run_id, model,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			reasoning_tokens, cost_usd_micros, extra)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (id) DO NOTHING`,
		usage.ID, usage.FlowNodeID, usage.ReportedAt, usage.RunID, usage.Model,
		usage.InputTokens, usage.OutputTokens, usage.CacheReadTokens, usage.CacheWriteTokens,
		usage.ReasoningTokens, usage.CostUsdMicros, extra)
	return translate(err, "the usage report")
}

func (s *UsageStore) UsageTotals(ctx context.Context, flowNodeID string) (entities.TaskUsageTotals, error) {
	var totals entities.TaskUsageTotals
	// The cost sum stays NULL where no report priced itself — unknown, never zero — while the
	// token sums count a card with no reports as zeros.
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(cache_write_tokens), 0),
			COALESCE(SUM(reasoning_tokens), 0), SUM(cost_usd_micros)
		FROM task_usage WHERE flow_node_id = $1`,
		flowNodeID).Scan(
		&totals.Reports,
		&totals.InputTokens, &totals.OutputTokens,
		&totals.CacheReadTokens, &totals.CacheWriteTokens,
		&totals.ReasoningTokens, &totals.CostUsdMicros)
	if err != nil {
		return entities.TaskUsageTotals{}, translate(err, "the usage totals")
	}
	return totals, nil
}
