package playback

import (
	"context"
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"strings"
	"time"
)

// The CLI has already exhausted its own retries before the run waits again.
const chainRunRetryWait = 20 * time.Minute

const chainRunRetryLimit = 3

// ChainRunResumePrompt continues interrupted work in an existing session.
const ChainRunResumePrompt = "You have been interrupted, please resume cleanly"

// Allow for provider clock differences and contention when a quota window resets.
const chainRunRefreshLeeway = time.Minute

// retryRound waits for another attempt, returning its prompt mode, or ends the run.
func (r *ChainRunner) retryRound(ctx context.Context, run *ChainRun, flowNodeID string, outcome PlayOneOutcome, fault harnessfaults.TurnFault, tries int) (playHow, bool) {
	if tries > r.RetryLimit {
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” was tried %d times and %s every time; the play stops here.",
			outcome.Title, r.RetryLimit+1, fault.Summary))
		r.fail(run, flowNodeID)
		r.end(run, "")
		return playHow{}, false
	}

	how := playHow{}
	state, at := ChainRunStateWaiting, time.Now().Add(r.RetryWait)
	if fault.Limit {
		state, at = ChainRunStateRefreshing, r.RefreshAt(fault, outcome.Harness)
		how.resume = true
		r.hold(run, flowNodeID)
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("%s: “%s” is held until it refreshes, and its turn is"+
			" picked back up at %s.", capitalise(fault.Summary), outcome.Title, said(at)))
	} else {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("%s: “%s” is played again at %s.",
			capitalise(fault.Summary), outcome.Title, said(at)))
	}
	if !r.waitToRetry(ctx, run, flowNodeID, outcome.Chat, state, at, fault.Summary) {
		r.dropFlowNode(run, flowNodeID)
		r.end(run, r.stoppedReason(run))
		return playHow{}, false
	}
	return how, true
}

// waitToRetry publishes the wait, then returns false if Stop or cancellation interrupts it.
func (r *ChainRunner) waitToRetry(ctx context.Context, run *ChainRun, flowNodeID, chat, state string, at time.Time, reason string) bool {
	r.Mu.Lock()
	moved := !run.gone
	if moved {
		run.FlowNodeID, run.Chat = flowNodeID, chat
		run.State = state
		run.retryAt = at
		markChain(run)
	}
	r.Mu.Unlock()
	if moved {
		r.LogState(run, flowNodeID, chat, state)
		r.LogWait(run, flowNodeID, chat, state, at, reason)
	}
	r.announce(nil)

	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-run.waking():
	case <-ctx.Done():
	}
	return !r.stopping(run) && ctx.Err() == nil
}

// Prefer the provider's reset, then account quota, then retryWait. Resets get refreshLeeway,
// including instants that elapsed while the turn settled.
func (r *ChainRunner) RefreshAt(fault harnessfaults.TurnFault, harness string) time.Time {
	now := time.Now()
	if !fault.ResetAt.IsZero() {
		if fault.ResetAt.Before(now) {
			return now.Add(r.RefreshLeeway)
		}
		return fault.ResetAt.Add(r.RefreshLeeway)
	}
	if at, known := r.QuotaResetAt(harness); known {
		return at.Add(r.RefreshLeeway)
	}
	return time.Now().Add(r.RetryWait)
}

// Rolling quotas can read slightly below full by the time a refusal is processed.
const quotaSpentPercent = 95

// Every exhausted window must reopen before a turn can run. Near-full windows are only a fallback
// when none reports exhaustion; an almost-full weekly window must not delay a spent short one.
func (r *ChainRunner) QuotaResetAt(harness string) (time.Time, bool) {
	if r.Hub == nil {
		return time.Time{}, false
	}
	port := r.Hub.HarnessRegistry().UsageFor(harness)
	if port == nil {
		return time.Time{}, false
	}
	usage, err := port.Usage()
	if err != nil {
		pkgBoards.LogChainRun.Warn("cannot read the account's limits to know when they lift",
			"harness", harness, "error", err)
		return time.Time{}, false
	}
	now := time.Now()
	var exhausted, nearFull time.Time
	for _, window := range usage.Windows {
		if window.PercentUsed < quotaSpentPercent || window.ResetAtEpochSeconds <= 0 {
			continue
		}
		at := time.Unix(window.ResetAtEpochSeconds, 0)
		if !at.After(now) || at.Sub(now) > harnessfaults.RefreshCeiling {
			continue
		}
		if window.PercentUsed >= 100 {
			if exhausted.IsZero() || at.After(exhausted) {
				exhausted = at
			}
		} else if nearFull.IsZero() || at.Before(nearFull) {
			nearFull = at
		}
	}
	if !exhausted.IsZero() {
		return exhausted, true
	}
	return nearFull, !nearFull.IsZero()
}

// Notices carry absolute instants; Dashboard supplies the reader's local datetime.
func said(at time.Time) string {
	return at.UTC().Format(time.RFC3339)
}

// capitalise turns a fault summary into the opening of a notice.
func capitalise(text string) string {
	runes := []rune(text)
	if len(runes) == 0 {
		return text
	}
	return strings.ToUpper(string(runes[0])) + string(runes[1:])
}
