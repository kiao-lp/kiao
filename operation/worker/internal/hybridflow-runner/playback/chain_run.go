package playback

import (
	"context"
	"encoding/json"

	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"kiao/worker/internal/hybridflow-runner/turns"
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

// playHow selects an alternative to submitting the flow node prompt. It is consumed by one attempt.
type playHow struct {
	// handoff uses a new fork of the preceding step's conversation.
	handoff bool
	// resume reopens the claim held while waiting for a usage limit to lift.
	resume bool
	// suspended reclaims a flow node after a chat interruption.
	suspended *suspendedTurn
}

type suspendedTurn struct {
	message *turns.TurnRequest
	refuse  func(string)
	// An HTTP resume without startTurn waits for a new turn from the client.
	awaitMessage bool
	previousTurn *turns.Turn
}

// chainStep is the loop's cursor. It carries ids and the prompt mode for one attempt.
type chainStep struct {
	flowNodeID string
	chat       string
	how        playHow
	// An exclusive gateway hands on its activation's output. A pointer to nil
	// represents an arrival without output. A nil pointer reads input from the board.
	input *json.RawMessage
}

func (step chainStep) nodeContext(board *pkgBoards.BoardContent, node *pkgBoards.FlowNode) pkgBoards.NodeContext {
	values := board.NodeContext(node)
	if step.input != nil {
		values.Input = *step.input
	}
	return values
}

// runExecution identifies one activation of a run. Created under ChainRunner.Mu,
// it keeps completion independent of a later Resume or Restart.
type runExecution struct {
	ctx    context.Context
	done   chan struct{}
	first  chainStep
	played map[string]bool
}

// loop owns its cursor, retry budget and visited set. Shared run state goes through
// the runner's transitions; turns and board operations run outside the runner lock.
func (r *ChainRunner) loop(run *ChainRun, execution *runExecution) {
	defer close(execution.done)
	ctx, step := execution.ctx, execution.first
	if resumed := step.how.suspended; resumed != nil && resumed.refuse != nil {
		defer func() {
			if resumed.message != nil {
				resumed.refuse("The board run could not start this message.")
			}
		}()
	}
	tries := 0
	played := execution.played

	for {
		if step.input != nil && !r.reserveFlowNode(ctx, run, step) {
			r.end(run, r.stoppedReason(run))
			return
		}
		outcome, fault := r.playOne(ctx, run, step)
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
			r.suspend(run, step.flowNodeID, step.chat)
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
			next, ok := r.successor(ctx, run, step, outcome, played)
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
	// nextID is set when a gateway selects a single branch.
	nextID string
	// output is this attempt's successful result, which another play may replace on the board.
	output json.RawMessage
	// chat is the conversation the flow node was played in — the one it had, or the one made for it,
	// which is what a flow node sent again after a failed turn goes back into.
	Chat string
	// title is the flow node as the board had it when the turn started, for the sentences said about
	// it.
	Title string
	// Harness is the execution tooling selected by the flow node's agent. It rides along
	// because a fault is read and *said* in that harness's name — and because a limit's own clock
	// is that account's, so the wait is asked of it (see refreshAt).
	Harness string
}

// playOne rereads the flow node and dispatches it by type. The outcome tells the loop its next transition.
func (r *ChainRunner) playOne(ctx context.Context, run *ChainRun, step chainStep) (PlayOneOutcome, *harnessfaults.TurnFault) {
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: step.chat}, nil
	}
	flowNode := board.FlowNode(step.flowNodeID)
	if flowNode == nil {
		r.say(run, runstate.NoticeError, "The flow node being played is no longer on the board; the play stops here.")
		return PlayOneOutcome{Round: roundStop, Chat: step.chat}, nil
	}
	if err := board.Workflow(flowNode.Workflow).ValidateFiles(); err != nil {
		r.say(run, runstate.NoticeError, err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: step.chat}, nil
	}
	if step.how.suspended != nil && (!flowNode.IsAI() || flowNode.Status != pkgBoards.FlowNodeStatusInterrupted || flowNode.Chat != step.chat) {
		r.say(run, runstate.NoticeError, "The interrupted task or its conversation has changed.")
		return PlayOneOutcome{Round: roundStop, Chat: step.chat}, nil
	}
	if flowNode.IsAI() {
		switch {
		case flowNode.Status == pkgBoards.FlowNodeStatusInterrupted && flowNode.Chat != "":
			step.chat = flowNode.Chat
			step.how.handoff = false
		case flowNode.Status == pkgBoards.FlowNodeStatusDone && !step.how.handoff && !step.how.resume:
			step.chat = ""
		}
	}
	// A resume is a word said into a conversation that is already there and already holds the work it
	// picks back up. A flow node naming none is played as it stands — nothing a usage limit leaves
	// behind looks like that, but a board is edited under a run, and a chat can be cleared off a flow node
	// while its flow node is being waited on.
	if step.chat == "" {
		step.how.resume = false
	}

	if flowNode.RunsItself() {
		return r.playToItself(ctx, run, board, *flowNode, step)
	}

	return r.playAI(ctx, run, board, flowNode, step)
}
