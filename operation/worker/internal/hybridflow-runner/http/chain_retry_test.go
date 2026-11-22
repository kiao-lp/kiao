package runnerhttp

import (
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	"strings"
	"testing"
	"time"
)

func TestChainRunRetryBudgetResetsAfterSuccessfulFlowNode(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionContinue))
	rt.runner.RetryLimit = 1
	const overloaded = "API Error: 529 Overloaded."
	rt.answers(overloaded, "First card done.", overloaded, "Second card done.")

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	for _, id := range []string{"flow-node-1", "flow-node-2"} {
		if got := board.FlowNode(id).Status; got != pkgBoards.FlowNodeStatusDone {
			t.Errorf("%s status = %q, want each card to have its own retry budget", id, got)
		}
	}
	if prompts := rt.prompts(); len(prompts) != 4 {
		t.Fatalf("prompts = %q, want one retry per card", prompts)
	}
}

func TestChainRunRetryPromptFollowsLatestFailure(t *testing.T) {
	const overloaded = "API Error: 529 Overloaded."
	const limit = "Claude AI usage limit reached|1750000000"
	for _, tc := range []struct {
		name     string
		failures []string
		want     []string
	}{
		{
			name:     "limit then temporary error",
			failures: []string{limit, overloaded},
			want:     []string{"Do the first thing.", playback.ChainRunResumePrompt, "Do the first thing.", "Do the second thing."},
		},
		{
			name:     "temporary error then limit",
			failures: []string{overloaded, limit},
			want:     []string{"Do the first thing.", "Do the first thing.", playback.ChainRunResumePrompt, "Do the second thing."},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionContinue))
			rt.answers(tc.failures[0], tc.failures[1], "First card done.", "Second card done.")

			rt.play("flow-node-1")
			rt.waitIdle()

			prompts := rt.prompts()
			if len(prompts) != len(tc.want) {
				t.Fatalf("prompts = %q, want %d turns", prompts, len(tc.want))
			}
			for i, prefix := range tc.want {
				if !strings.HasPrefix(prompts[i], prefix) {
					t.Errorf("prompt %d = %q, want prefix %q", i+1, prompts[i], prefix)
				}
			}
			board := rt.board()
			if board.FlowNode("flow-node-1").Status != pkgBoards.FlowNodeStatusDone || board.FlowNode("flow-node-2").Status != pkgBoards.FlowNodeStatusDone {
				t.Fatal("both cards must finish after the retries")
			}
		})
	}
}

func TestChainRunStopCancelsRetryWait(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionContinue))
	rt.runner.RetryWait = time.Hour
	rt.answers("API Error: 529 Overloaded.")

	rt.play("flow-node-1")
	rt.waitState(playback.ChainRunStateWaiting)
	rt.stop()
	rt.waitIdle()

	board := rt.board()
	if got := board.FlowNode("flow-node-1").Status; got != pkgBoards.FlowNodeStatusInterrupted {
		t.Errorf("status = %q, want the card interrupted when the retry wait is stopped", got)
	}
	if got := board.FlowNode("flow-node-2").Status; got != "" {
		t.Errorf("successor status = %q, want it untouched", got)
	}
	if prompts := rt.prompts(); len(prompts) != 1 {
		t.Errorf("prompts = %q, want no retry after Stop", prompts)
	}
	if at := rt.last().RetryAt; at != 0 {
		t.Errorf("retryAt = %d, want the ended run's wait cleared", at)
	}
}
