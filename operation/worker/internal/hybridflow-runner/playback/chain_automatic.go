package playback

import (
	"context"
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"time"
)

// playToItself claims and dispatches automatic cards. Gateways check their join before claiming.
func (r *ChainRunner) playToItself(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	if flowNode.Type == pkgBoards.FlowNodeTypeGateway {
		// A Gateway is claimed only once every branch feeding into it is done — which is decided
		// off a fresh board, inside, rather than here.
		return r.playGateway(run, flowNode, out)
	}
	state := ChainRunStatePlaying
	if flowNode.Type == pkgBoards.FlowNodeTypeScheduler {
		state = ChainRunStateScheduled
	}
	r.setState(run, flowNode.ID, out.Chat, state)
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, flowNode.ID, run.Id) }); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}

	if flowNode.Type == pkgBoards.FlowNodeTypeScheduler {
		return r.playSchedule(ctx, run, flowNode, out)
	}
	return r.playShutdown(run, flowNode, out)
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
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, pkgBoards.FlowNodeStatusDone)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	out.Round = roundPowerOff
	return out, nil
}

// playSchedule waits for a duration or datetime. Past datetimes continue immediately;
// interruption returns the held card through the loop's stop transition.
func (r *ChainRunner) playSchedule(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	when, ok := flowNode.ScheduledAt()
	if !ok {
		// A card the board would not have offered a Play on, reached through a chain that named it
		// before its datetime was answered.
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” names no duration or datetime to wait for; the play stops here.",
			flowNode.Title))
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
			// The wait was the run holding the card, so leaving it here is leaving it part-way.
			out.Round = roundStop
			return out, nil
		}
	} else {
		r.LogNote(run, flowNode.ID, out.Chat, "", "the scheduled moment is past; carrying on")
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.finishAutomatic(run, flowNode.ID)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	out.Round = RoundOn
	return out, nil
}

// powerOff ends the run, allows notification delivery, then invokes the shutdown port.
func (r *ChainRunner) powerOff(run *ChainRun, title string) {
	pkgBoards.LogChainRun.Info("the played card is a shutdown", "run", run.Id, "flowNode", title)
	r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” shuts the machine down; the play ends here.", title))
	r.end(run, "")
	time.Sleep(r.ShutdownGrace)
	if err := r.Shutdown(); err != nil {
		// The run is over either way — the board ends on this card — so this is only ever news, and
		// it is news worth having: a machine that stayed on because polkit refused says so rather
		// than being found on in the morning with nothing to explain it.
		pkgBoards.LogChainRun.Error("the machine could not be shut down", "run", run.Id, "error", err)
		r.say(run, runstate.NoticeError, "The machine could not be shut down: "+err.Error())
	}
}
