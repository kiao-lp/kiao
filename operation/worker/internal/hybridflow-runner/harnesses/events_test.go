package harnesses

import (
	"encoding/json"
	"testing"
)

func TestReadUsagePreservesTokenTotals(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want TurnUsage
	}{
		{
			name: "codex totals include their breakdowns",
			raw:  `{"input_tokens":2000,"cached_input_tokens":1200,"cache_write_input_tokens":300,"output_tokens":500,"reasoning_output_tokens":400}`,
			want: TurnUsage{InputTokens: 2000, OutputTokens: 500, CacheReadTokens: 1200, CacheWriteTokens: 300, ReasoningTokens: 400},
		},
		{
			name: "responses nested breakdowns",
			raw:  `{"input_tokens":2000,"output_tokens":500,"input_tokens_details":{"cached_tokens":1200,"cache_write_tokens":300},"output_tokens_details":{"reasoning_tokens":400},"total_tokens":2500}`,
			want: TurnUsage{InputTokens: 2000, OutputTokens: 500, CacheReadTokens: 1200, CacheWriteTokens: 300, ReasoningTokens: 400},
		},
		{
			name: "chat completions nested breakdowns",
			raw:  `{"prompt_tokens":20,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":15},"completion_tokens_details":{"reasoning_tokens":8},"total_tokens":30}`,
			want: TurnUsage{InputTokens: 20, OutputTokens: 10, CacheReadTokens: 15, ReasoningTokens: 8},
		},
		{
			name: "claude model cache spellings",
			raw:  `{"inputTokens":100,"outputTokens":20,"cacheReadInputTokens":50,"cacheCreationInputTokens":10,"costUSD":0.01}`,
			want: TurnUsage{InputTokens: 100, OutputTokens: 20, CacheReadTokens: 50, CacheWriteTokens: 10, TotalCostUSD: 0.01},
		},
		{
			name: "muse zero alias does not hide cache reads",
			raw:  `{"inputTokens":200,"outputTokens":50,"cacheReadTokens":0,"cachedTokens":100,"reasoningTokens":30}`,
			want: TurnUsage{InputTokens: 200, OutputTokens: 50, CacheReadTokens: 100, ReasoningTokens: 30},
		},
		{
			name: "total only is retained as approximate input",
			raw:  `{"totalTokens":2500}`,
			want: TurnUsage{InputTokens: 2500},
		},
		{
			name: "total fills missing input",
			raw:  `{"outputTokens":500,"totalTokens":2500}`,
			want: TurnUsage{InputTokens: 2000, OutputTokens: 500},
		},
		{
			name: "unclassified remainder is retained",
			raw:  `{"inputTokens":100,"outputTokens":20,"totalTokens":150}`,
			want: TurnUsage{InputTokens: 130, OutputTokens: 20},
		},
		{
			name: "cache and reasoning without totals",
			raw:  `{"cacheReadTokens":100,"cacheWriteTokens":20,"reasoningTokens":30}`,
			want: TurnUsage{InputTokens: 120, OutputTokens: 30, CacheReadTokens: 100, CacheWriteTokens: 20, ReasoningTokens: 30},
		},
		{
			name: "nested counters without totals",
			raw:  `{"input_tokens_details":{"cached_tokens":50},"output_tokens_details":{"reasoning_tokens":20}}`,
			want: TurnUsage{InputTokens: 50, OutputTokens: 20, CacheReadTokens: 50, ReasoningTokens: 20},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw any
			if err := json.Unmarshal([]byte(tc.raw), &raw); err != nil {
				t.Fatal(err)
			}
			got, ok := ReadUsage(raw, nil, UsageScopeTurn)
			tc.want.Scope = UsageScopeTurn
			if !ok || *got != tc.want {
				t.Fatalf("usage = %+v/%v, want %+v", got, ok, tc.want)
			}
		})
	}
}

func TestReadUsageWithoutTokens(t *testing.T) {
	for _, raw := range []any{nil, "unreadable", map[string]any{}, map[string]any{"input_tokens": 0, "totalTokens": 0, "reasoningTokens": 0}} {
		if got, ok := ReadUsage(raw, nil, UsageScopeTurn); ok || got != nil {
			t.Errorf("usage = %+v/%v, want unknown", got, ok)
		}
	}
	if got, ok := ReadUsage(nil, 0.01, UsageScopeTurn); !ok || got.TotalCostUSD != 0.01 {
		t.Errorf("cost-only usage = %+v/%v", got, ok)
	}
}
