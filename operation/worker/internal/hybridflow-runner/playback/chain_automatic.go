package playback

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"kiao/worker/internal/core/filesystem"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

// playToItself claims and dispatches automatic flow nodes. Parallel gateways check their join first.
func (r *ChainRunner) playToItself(
	ctx context.Context, run *ChainRun, board *pkgBoards.BoardContent, flowNode pkgBoards.FlowNode, step chainStep,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	out := PlayOneOutcome{Chat: step.chat, Title: flowNode.Title}
	if flowNode.Type == pkgBoards.FlowNodeTypeLimiter {
		return r.playLimiter(ctx, run, board, step, out), nil
	}
	if flowNode.Type == pkgBoards.FlowNodeTypeGateway {
		// A Gateway is claimed only once every branch feeding into it is done — which is decided
		// off a fresh board, inside, rather than here.
		return r.playGateway(run, flowNode, out)
	}
	state := ChainRunStatePlaying
	switch flowNode.Type {
	case pkgBoards.FlowNodeTypeScheduler:
		state = ChainRunStateScheduled
	case pkgBoards.FlowNodeTypeBitbucketPRStatus, pkgBoards.FlowNodeTypeBitbucketCommitStatus:
		state = ChainRunStatePolling
	}
	r.setState(run, flowNode.ID, out.Chat, state)
	claimed, err := r.claimFlowNode(ctx, run, step.input != nil, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Start(run.Handle, flowNode.ID, run.Id)
	})
	if err != nil {
		if !r.stopping(run) && ctx.Err() == nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		}
		out.Round = roundStop
		return out, nil
	}

	node := claimed.FlowNode(flowNode.ID)
	if node == nil {
		out.Round = roundStop
		return out, nil
	}
	switch flowNode.Type {
	case pkgBoards.FlowNodeTypeStart:
		return r.playStart(ctx, run, node.ID, claimed.Workflow(node.Workflow), out), nil
	case pkgBoards.FlowNodeTypeScheduler:
		return r.playSchedule(ctx, run, *node, step.nodeContext(claimed, node), out)
	case pkgBoards.FlowNodeTypeBitbucketPRStatus, pkgBoards.FlowNodeTypeBitbucketCommitStatus:
		return r.playBitbucketStatus(ctx, run, *node, step.nodeContext(claimed, node), out), nil
	case pkgBoards.FlowNodeTypeExclusiveGateway:
		return r.playExclusiveGateway(ctx, run, *node, step.nodeContext(claimed, node), out), nil
	default:
		return r.playShutdown(run, flowNode, out)
	}
}

func (r *ChainRunner) playStart(ctx context.Context, run *ChainRun, id string, workflow *pkgBoards.Workflow, out PlayOneOutcome) PlayOneOutcome {
	err := workflow.ValidateFiles()
	if err == nil && workflow != nil && workflow.WorkflowFolder != "" {
		storage := filesystem.NewStorage(r.cfg.DCMSRoot, r.cfg.StatePath)
		err = storage.CopyIntoFolder(ctx, workflow.WorkflowFolder, workflow.Files)
	}
	if r.stopping(run) || ctx.Err() != nil {
		out.Round = roundStop
		return out
	}
	if err != nil {
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not prepare the workflow folder: %s", out.Title, err))
		r.fail(run, id)
		out.Round = roundStop
		return out
	}
	return r.completeAutomatic(run, id, nil, out)
}

func (r *ChainRunner) playLimiter(ctx context.Context, run *ChainRun, board *pkgBoards.BoardContent, step chainStep, out PlayOneOutcome) PlayOneOutcome {
	out.Round = roundStop
	if r.stopping(run) || ctx.Err() != nil {
		return out
	}
	r.setState(run, step.flowNodeID, out.Chat, ChainRunStatePlaying)
	if _, err := r.claimFlowNode(ctx, run, step.input != nil, func() (*pkgBoards.BoardContent, error) {
		if board == nil {
			var err error
			board, err = r.read(run.Handle)
			if err != nil {
				return nil, err
			}
		}
		node := board.FlowNode(step.flowNodeID)
		if node == nil {
			return nil, fmt.Errorf("the limiter is no longer on the board")
		}
		input := step.nodeContext(board, node).Input
		completed, next, err := r.Boards.PassLimiter(ctx, run.Handle, node.ID, run.Id, node.Revision, input)
		if err != nil {
			board = nil
			return nil, err
		}
		*node = *completed
		out.nextID = next
		out.output = input
		return board, nil
	}); err != nil {
		if !r.stopping(run) && ctx.Err() == nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not select a branch: %s", out.Title, err))
		}
		return out
	}
	out.Round = RoundOn
	return out
}

// playShutdown marks completion before powering off. Unsupported deployments mark an error.
func (r *ChainRunner) playShutdown(
	run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	if r.Shutdown == nil {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” asks for the machine to be shut down, and this"+
			" deployment cannot; the play stops here.", flowNode.Title))
		r.fail(run, flowNode.ID)
		out.Round = roundStop
		return out, nil
	}
	// Marked before the command goes out, and it is the last thing written: this process does not
	// live to see the machine go down, so a mark left for afterwards is a mark never made.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, pkgBoards.PlayResult{Status: pkgBoards.FlowNodeStatusDone})
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	out.Round = roundPowerOff
	return out, nil
}

// playSchedule waits for a duration or datetime. Past datetimes continue immediately;
// interruption returns the held flow node through the loop's stop transition.
func (r *ChainRunner) playSchedule(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, values pkgBoards.NodeContext, out PlayOneOutcome,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	when, err := flowNode.ScheduledAt(values)
	if err != nil {
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not start its wait: %s", flowNode.Title, err))
		r.fail(run, flowNode.ID)
		out.Round = roundStop
		return out, nil
	}
	if wait := time.Until(when); wait > 0 {
		pkgBoards.LogChainRun.Info("the play is holding for a scheduled flow node",
			"run", run.Id, "flowNode", flowNode.ID, "until", when)
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” is waiting until %s.", flowNode.Title, when.Format("2 Jan 15:04")))
		r.LogWait(run, flowNode.ID, out.Chat, ChainRunStateScheduled, when, "")
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-run.waking():
		case <-ctx.Done():
		}
		if r.stopping(run) || ctx.Err() != nil {
			// The wait was the run holding the flow node, so leaving it here is leaving it part-way.
			out.Round = roundStop
			return out, nil
		}
	} else {
		r.LogNote(run, flowNode.ID, out.Chat, "", "the scheduled moment is past; carrying on")
	}
	return r.completeAutomatic(run, flowNode.ID, values.Input, out), nil
}

func (r *ChainRunner) completeAutomatic(run *ChainRun, id string, input json.RawMessage, out PlayOneOutcome) PlayOneOutcome {
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, id, run.Id, pkgBoards.PlayResult{Status: pkgBoards.FlowNodeStatusDone, Output: input})
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out
	}
	out.Round = RoundOn
	out.output = input
	return out
}

// powerOff ends the run, allows notification delivery, then invokes the shutdown port.
func (r *ChainRunner) powerOff(run *ChainRun, title string) {
	pkgBoards.LogChainRun.Info("the played flow node is a shutdown", "run", run.Id, "flowNode", title)
	r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” shuts the machine down; the play ends here.", title))
	r.end(run, "")
	time.Sleep(r.ShutdownGrace)
	if err := r.Shutdown(); err != nil {
		// The run is over either way — the board ends on this flow node — so this is only ever news, and
		// it is news worth having: a machine that stayed on because polkit refused says so rather
		// than being found on in the morning with nothing to explain it.
		pkgBoards.LogChainRun.Error("the machine could not be shut down", "run", run.Id, "error", err)
		r.say(run, runstate.NoticeError, "The machine could not be shut down: "+err.Error())
	}
}
