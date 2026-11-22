package playback

import (
	"errors"
	"fmt"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"net/http"
	"strings"
	"time"
)

// playGateway implements a last-arrival join: early branches end, and the last claims
// the gateway before firing independent branches. The atomic claim settles simultaneous arrivals.
func (r *ChainRunner) playGateway(
	run *ChainRun, gateway pkgBoards.FlowNode, out PlayOneOutcome,
) (PlayOneOutcome, *harnessfaults.TurnFault) {
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	at := board.FlowNode(gateway.ID)
	if at == nil {
		r.say(run, runstate.NoticeError, "The gateway is no longer on the board; the play stops here.")
		out.Round = roundStop
		return out, nil
	}
	if waiting := waitingBranches(board, *at); len(waiting) > 0 {
		r.LogChain(run, at.ID, ChainRunChainDecision{Done: *at, Decision: chainRunChainGatewayWaiting})
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” waits for %s; this branch ends here.",
			at.Title, strings.Join(waiting, ", ")))
		out.Round = roundStop
		return out, nil
	}
	if at.Status == pkgBoards.FlowNodeStatusDone {
		// Fired already — branches played again after the Gateway went through. There is nothing
		// to fire a second time.
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” already fired; this branch ends here.", at.Title))
		out.Round = roundStop
		return out, nil
	}
	// No holder check before the claim: this run may itself be standing on the Gateway — a
	// direct Play starts on it — and the claim below is what settles two branches firing together
	// anyway, letting exactly one of them through.
	r.setState(run, at.ID, "", ChainRunStatePlaying)
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, at.ID, run.Id) }); err != nil {
		var refused *httpkit.HTTPError
		if errors.As(err, &refused) && refused.Status == http.StatusConflict {
			// The race the claim exists for: two branches finished together, and the other play
			// fired the Gateway first.
			r.LogChain(run, at.ID, ChainRunChainDecision{Done: *at, Decision: chainRunChainHeld})
			r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” was fired by another play; this branch ends here.",
				at.Title))
		} else {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		}
		out.Round = roundStop
		return out, nil
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.finishAutomatic(run, at.ID)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	r.walked(run, at.ID)

	// The branches, read off the board as it stands after the firing: a chain is edited under a
	// run like everything else on one.
	board, err = r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		out.Round = roundStop
		return out, nil
	}
	fired := board.FlowNode(at.ID)
	if fired == nil {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” fired and left the board; the play ends here.",
			out.Title))
		out.Round = roundStop
		return out, nil
	}
	r.forkBranches(run, board, *fired)
	out.Round = roundStop
	return out, nil
}

// waitingBranches lists unfinished predecessors by title. No predecessors means ready.
func waitingBranches(board *pkgBoards.BoardContent, gateway pkgBoards.FlowNode) []string {
	var waiting []string
	for _, pred := range board.PredecessorsOf(gateway.ID) {
		if pred.Status != pkgBoards.FlowNodeStatusDone {
			waiting = append(waiting, "“"+pred.Title+"”")
		}
	}
	return waiting
}

// forkBranches checks and starts each outgoing branch independently.
// An ineligible branch raises its own notice and leaves the others available.
func (r *ChainRunner) forkBranches(run *ChainRun, board *pkgBoards.BoardContent, gateway pkgBoards.FlowNode) {
	behind := map[string]bool{}
	r.Mu.Lock()
	for _, id := range run.trail {
		behind[id] = true
	}
	r.Mu.Unlock()

	var started []string
	branches := board.SuccessorsOf(gateway)
	for _, next := range branches {
		branch := next
		if branch.IsHuman() {
			if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Todo(run.Handle, branch.ID) }); err != nil {
				r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not be marked to do: %s", branch.Title, err.Error()))
			} else {
				r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” is to do.", branch.Title))
			}
			continue
		}
		switch {
		case !branch.Runnable():
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainNextUnplayable,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” cannot be played as it stands;"+
				" no branch starts there.", branch.Title))
			continue
		case !branch.HasWork():
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainNextEmpty,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” has nothing to send;"+
				" no branch starts there.", branch.Title))
			continue
		case behind[branch.ID]:
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainReplayed,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is already behind this play;"+
				" no branch starts there.", branch.Title))
			continue
		}
		if refusal := r.RunnerRefusal(branch); refusal != "" {
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Decision: chainRunChainPinned,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” %s; no branch starts there.",
				branch.Title, strings.TrimPrefix(refusal, "this flow node ")))
			continue
		}
		if held := r.holderOf(run.Handle, branch.ID); held != "" {
			r.LogChain(run, gateway.ID, ChainRunChainDecision{
				Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
				Holder: held, Decision: chainRunChainHeld,
			})
			r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is already being played by “%s”;"+
				" no branch starts there.", branch.Title, held))
			continue
		}
		// A card a run died holding is taken back first, so the branch meets a free card rather
		// than the run that is gone.
		freed, err := r.reclaim(run.Handle, board, branch.ID)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” could not be freed for its branch: %s",
				branch.Title, err.Error()))
			continue
		}
		board = freed
		if at := board.FlowNode(branch.ID); at != nil {
			branch = *at
		}
		r.LogChain(run, gateway.ID, ChainRunChainDecision{
			Done: gateway, NextID: branch.ID, ToFolder: branch.Settings.WorkFolder(),
			Chat: branch.Chat, Decision: chainRunChainGatewayForked,
		})
		r.forkRun(run, board, branch.ID)
		started = append(started, "“"+branch.Title+"”")
	}
	switch {
	case len(branches) == 0:
		r.LogChain(run, gateway.ID, ChainRunChainDecision{Done: gateway, Decision: ChainRunChainEnd})
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired its last flow node, “%s”; the play is done.",
			r.nameOf(run), gateway.Title))
	case len(started) == 0:
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” fired, and no branch started.", gateway.Title))
	case len(started) == 1:
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired one branch: %s.", gateway.Title, started[0]))
	default:
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” fired %d branches: %s.",
			gateway.Title, len(started), strings.Join(started, ", ")))
	}
}

// forkRun creates an independent run with the parent's owner and copied trail.
// The inherited trail prevents branches from forking back onto completed ancestors.
func (r *ChainRunner) forkRun(parent *ChainRun, board *pkgBoards.BoardContent, startID string) {
	r.Mu.Lock()
	trail := append([]string(nil), parent.trail...)
	name, owner := parent.Name, parent.Owner
	chat := ""
	if at := board.FlowNode(startID); at != nil {
		chat = at.Chat
	}
	child := &ChainRun{
		Id:             "run-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4],
		Name:           name + " / " + startTitle(board, startID),
		Handle:         parent.Handle,
		Owner:          owner,
		RootFlowNodeID: startID,
		FlowNodeID:     startID,
		Chat:           chat,
		trail:          trail,
		State:          ChainRunStatePlaying,
		startedAt:      time.Now(),
	}
	execution := r.startLocked(child, board, false)
	r.Mu.Unlock()

	pkgBoards.LogChainRun.Info("branch started", "run", child.Id, "name", child.Name,
		"board", child.Handle, "flowNode", startID, "chat", chat)
	r.runLogs.Create(child.Id, child.Name, child.Handle, startID, owner.User, child.startedAt)
	r.announce(nil)
	go r.loop(child, execution)
}

// startTitle names a branch after its card, falling back to its id.
func startTitle(board *pkgBoards.BoardContent, startID string) string {
	if at := board.FlowNode(startID); at != nil && strings.TrimSpace(at.Title) != "" {
		return strings.TrimSpace(at.Title)
	}
	return startID
}
