package playback

import (
	"context"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

// round is what one flow node leaves the loop to do.
type round int

const (
	// The flow node was answered and marked: on to whatever it says comes after it.
	RoundOn round = iota
	// The flow node was not marked, and the reason is one that passes.
	roundAgain
	// The run ends here.
	roundStop
	// The run ends here and is kept, so that saying something in its chat resumes it.
	roundSuspend
	// The flow node was a **Shutdown** and this deployment can honour it: the run ends and the machine
	// goes off with it, whatever else the board says.
	roundPowerOff
)

// playHow selects an alternative to submitting the card prompt. It is consumed by one attempt.
type playHow struct {
	// attach waits for the turn the user is starting rather than sending one at all. It is a resumed
	// run's first flow node: what somebody says in that chat *is* the flow node's turn.
	attach bool
	// resume sends the word that picks a cut-off turn back up rather than the description. It is a
	// flowNode coming out of a usage limit, whose conversation already holds everything the turn had
	// done when the limit closed under it.
	resume bool
}

// chainStep is the loop's cursor. It carries ids and the prompt mode for one attempt.
type chainStep struct {
	flowNodeID string
	chat       string
	how        playHow
}

// runExecution identifies one activation of a run. Created under ChainRunner.Mu,
// it keeps completion independent of a later Resume or Restart.
type runExecution struct {
	ctx   context.Context
	done  chan struct{}
	first chainStep
}

// loop owns its cursor, retry budget and visited set. Shared run state goes through
// the runner's transitions; turns and board operations run outside the runner lock.
func (r *ChainRunner) loop(run *ChainRun, execution *runExecution) {
	defer close(execution.done)
	ctx, step := execution.ctx, execution.first
	tries := 0
	played := map[string]bool{}

	for {
		outcome, fault := r.playOne(ctx, run, step.flowNodeID, step.chat, step.how)
		step.how = playHow{}
		step.chat = outcome.Chat
		switch outcome.Round {
		case roundStop:
			// Release the claim before publishing completion and closing done.
			r.dropFlowNode(run, step.flowNodeID)
			r.end(run, r.stoppedReason(run))
			return
		case roundPowerOff:
			r.powerOff(run, outcome.Title)
			return
		case roundSuspend:
			if r.ended(run) {
				r.end(run, chainRunStopped)
			} else {
				r.suspend(run, step.flowNodeID, step.chat)
			}
			return
		case roundAgain:
			tries++
			var retry bool
			step.how, retry = r.retryRound(ctx, run, step.flowNodeID, outcome, *fault, tries)
			if !retry {
				return
			}
		case RoundOn:
			tries = 0
			played[step.flowNodeID] = true
			r.walked(run, step.flowNodeID)
			if r.stopping(run) {
				r.end(run, chainRunStopped)
				return
			}
			next, ok := r.successor(ctx, run, step.flowNodeID, step.chat, outcome.Title, played)
			if !ok {
				return
			}
			step = next
		}
	}
}

// PlayOneOutcome reports the transition and context of an attempt to the loop.
type PlayOneOutcome struct {
	Round round
	// chat is the conversation the flow node was played in — the one it had, or the one made for it,
	// which is what a flow node sent again after a failed turn goes back into.
	Chat string
	// title is the flow node as the board had it when the turn started, for the sentences said about
	// it.
	Title string
	// Harness is the execution tooling selected by the flow node's agent. It rides along
	// because a fault is read and *said* in that engine's name — and because a limit's own clock
	// is that account's, so the wait is asked of it (see refreshAt).
	Harness string
}

// playOne rereads the card and dispatches it by type. The outcome tells the loop its next transition.
func (r *ChainRunner) playOne(ctx context.Context, run *ChainRun, flowNodeID, chat string, how playHow) (PlayOneOutcome, *harnessfaults.TurnFault) {
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil {
		r.say(run, runstate.NoticeError, "The flow node being played is no longer on the board; the play stops here.")
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	// A resume is a word said into a conversation that is already there and already holds the work it
	// picks back up. A flow node naming none is played as it stands — nothing a usage limit leaves
	// behind looks like that, but a board is edited under a run, and a chat can be cleared off a card
	// while its flow node is being waited on.
	if chat == "" {
		how.resume = false
	}

	if flowNode.RunsItself() {
		return r.playToItself(ctx, run, *flowNode, PlayOneOutcome{Chat: chat, Title: flowNode.Title})
	}

	return r.playAI(ctx, run, board, flowNode, chat, how)
}
