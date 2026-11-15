package codex

import (
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

// Codex totals include cache and reasoning; the remaining counters are breakdowns.
func ReadCodexUsage(raw, cost any) (*harnessapi.TurnUsage, bool) {
	return harnessapi.ReadUsage(raw, cost, harnessapi.UsageScopeTurn)
}
