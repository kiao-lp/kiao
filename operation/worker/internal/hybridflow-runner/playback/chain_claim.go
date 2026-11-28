package playback

import (
	"context"
	"errors"
	"net/http"
	"time"

	"kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
)

// reserveCard moves an exclusive arrival to the next flow node without taking a
// flow node that another local run is using. A queued run holds no flow node.
func (r *ChainRunner) reserveFlowNode(ctx context.Context, run *ChainRun, step chainStep) bool {
	for {
		r.Mu.Lock()
		if run.gone || run.stopping || ctx.Err() != nil {
			r.Mu.Unlock()
			return false
		}
		held := r.holder(run.Handle, step.flowNodeID)
		if held == nil || held == run {
			if run.FlowNodeID != step.flowNodeID {
				r.flowNodeReleasedLocked()
			}
			run.FlowNodeID, run.Chat, run.input = step.flowNodeID, step.chat, step.input
			if run.State == ChainRunStateQueued {
				run.State = ChainRunStatePlaying
			}
			markChain(run)
			r.Mu.Unlock()
			return true
		}
		moved := run.State != ChainRunStateQueued || run.FlowNodeID != step.flowNodeID
		if moved {
			run.FlowNodeID, run.Chat, run.State = step.flowNodeID, "", ChainRunStateQueued
			markChain(run)
			r.flowNodeReleasedLocked()
		}
		if r.flowNodeReleased == nil {
			r.flowNodeReleased = make(chan struct{})
		}
		released := r.flowNodeReleased
		r.Mu.Unlock()
		if moved {
			r.LogState(run, step.flowNodeID, "", ChainRunStateQueued)
			r.announce(nil)
		}

		select {
		case <-released:
		case <-run.waking():
			return false
		case <-ctx.Done():
			return false
		}
	}
}

// flowNodeReleasedLocked wakes queued runs after a local reservation is released.
func (r *ChainRunner) flowNodeReleasedLocked() {
	if r.flowNodeReleased != nil {
		close(r.flowNodeReleased)
		r.flowNodeReleased = nil
	}
}

// claimCard also honours ownership on other runners. Only an exclusive
// arrival retries a conflict, and the store still arbitrates each attempt.
func (r *ChainRunner) claimFlowNode(ctx context.Context, run *ChainRun, wait bool, take func() (*pkgBoards.BoardContent, error)) (*pkgBoards.BoardContent, error) {
	for {
		if wait && (r.stopping(run) || ctx.Err() != nil) {
			return nil, context.Canceled
		}
		var board *pkgBoards.BoardContent
		err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
			var err error
			board, err = take()
			return board, err
		})
		var refusal *httpkit.HTTPError
		if !wait || !errors.As(err, &refusal) || refusal.Status != http.StatusConflict {
			return board, err
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-timer.C:
		case <-run.waking():
			timer.Stop()
			return nil, context.Canceled
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		}
	}
}
