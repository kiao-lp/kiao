package playback

import (
	"encoding/json"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"time"
)

// reclaim takes the flow node back from the run holding it, where that run is gone. Runs live in this
// process and nowhere else, so a restart orphans every claim its runs held — and a replay must
// not trip over one: the flow node is freed, offered a turn again, and read back so the play starts
// from what it says now.
//
// A flow node held by a run that is still playing is left exactly as it is: taking it would be two
// turns on one flow node, and the play coming is refused for it rather than handed the flow node.
func (r *ChainRunner) reclaim(handle string, board *pkgBoards.BoardContent, flowNodeID string) (*pkgBoards.BoardContent, error) {
	flowNode := board.FlowNode(flowNodeID)
	if flowNode == nil || flowNode.Run == "" {
		return board, nil
	}
	r.Mu.Lock()
	live := false
	if run := r.find(flowNode.Run); run != nil && run.State != ChainRunStateEnded {
		live = true
	}
	r.Mu.Unlock()
	if live {
		return board, nil
	}
	held := flowNode.Run
	if _, err := r.Boards.SettleRun(held); err != nil {
		return nil, err
	}
	board, err := r.Boards.Ready(handle, flowNodeID)
	if err != nil {
		return nil, err
	}
	pkgBoards.LogChainRun.Info("the flow node was taken back from a run that is gone",
		"board", handle, "flowNode", flowNodeID, "run", held)
	return board, nil
}

// hold records a usage-limit wait. A failed mark is logged; the next attempt rereads the board.
func (r *ChainRunner) hold(run *ChainRun, flowNodeID string) {
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Hold(run.Handle, flowNodeID, run.Id) }); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the held flow node could not be marked: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the held flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

// fail marks an unsuccessful flow node. Write failures are logged without replacing the original notice.
func (r *ChainRunner) fail(run *ChainRun, flowNodeID string) {
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		// What the turn said before it failed is in its conversation, which the flow node names and
		// opens. The description stays, so the flow node still asks what it was asking.
		return r.Boards.Finish(run.Handle, flowNodeID, run.Id, pkgBoards.PlayResult{Status: pkgBoards.FlowNodeStatusError})
	}); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the flow node could not be marked failed: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

// dropFlowNode releases a still-held flow node on exit. BoardStore.Drop checks ownership,
// preserving an earlier completion or a new owner. Suspended runs keep their interruption mark.
func (r *ChainRunner) dropFlowNode(run *ChainRun, flowNodeID string) {
	if flowNodeID == "" {
		return
	}
	// Drop and not Finish: this is the run giving a flow node back rather than a play ending, so the flow node
	// is only marked if this run still holds it. By now it may have been marked a moment ago by the
	// run itself, or picked up by somebody else, and neither is this run's to write over.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Drop(run.Handle, flowNodeID, run.Id)
	}); err != nil {
		r.LogNote(run, flowNodeID, r.chatOf(run), "", "the flow node could not be given back: "+err.Error())
		pkgBoards.LogChainRun.Warn("cannot mark the flow node", "run", run.Id, "flowNode", flowNodeID, "error", err)
	}
}

// read fetches the live board. Every play and restart requires a configured BoardStore.
func (r *ChainRunner) read(handle string) (*pkgBoards.BoardContent, error) {
	if r.Boards == nil {
		return nil, pkgBoards.ErrNoHybridflowStore("is no board to play")
	}
	return r.Boards.Board(handle)
}

// mark is every write of a board: one named operation on one flow node, and the bookkeeping that follows
// any of them.
//
// BoardStore owns atomic claims and flow node updates. I/O runs outside Mu;
// only snapshot bookkeeping takes Mu, so independent runs can write concurrently.
func (r *ChainRunner) mark(run *ChainRun, write func() (*pkgBoards.BoardContent, error)) error {
	board, err := write()
	if err != nil {
		return err
	}

	// The board is something somebody may have open, so every write says so: a client holding it
	// reloads rather than typing on top of a mark it never saw. Said even for a run on its way
	// out — the last thing a dying loop does is take the mark off the flow node it was holding, and that
	// is precisely a change somebody looking at the board has to see.
	//
	// The board that came back is also the freshest view there is, so the run's chain — the titles
	// and statuses a panel draws — is worked out from it here rather than by reading again for the
	// sake of a row of text.
	r.Mu.Lock()
	run.documentAt = time.Now()
	run.chain = pkgBoards.ChainFrom(board, run.trail, run.FlowNodeID)
	markChain(run)
	r.Mu.Unlock()
	r.announce(nil)
	return nil
}

func (r *ChainRunner) outputContract(node pkgBoards.FlowNode, board *pkgBoards.BoardContent) (*pkgBoards.OutputContract, error) {
	if node.OutputType == "" {
		return nil, nil
	}
	var raw json.RawMessage
	if local := board.FlowNode(node.OutputType); local != nil && local.Type == "value" && local.ValueType == "json-schema" {
		raw = local.Value
	} else {
		var err error
		raw, err = r.Boards.Schema(node.OutputType)
		if err != nil {
			return nil, err
		}
	}
	return pkgBoards.CompileOutput(raw)
}
