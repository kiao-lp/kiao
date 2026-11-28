package playback

import (
	"context"
	"encoding/json"
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"slices"
	"strings"
)

// successor rereads the completed flow node, compacts its chat and prepares the next step.
// A false result means the run has ended, with its reason already published.
func (r *ChainRunner) successor(ctx context.Context, run *ChainRun, step chainStep, outcome PlayOneOutcome, played map[string]bool) (chainStep, bool) {
	flowNodeID, chat, title, selected := step.flowNodeID, outcome.Chat, outcome.Title, outcome.nextID
	// What the flow node says comes after it, read off the board rather than off the copy this round
	// started with: a turn lasts minutes, and the chain may have been rewritten in the panel while
	// it ran.
	board, err := r.read(run.Handle)
	if err != nil {
		r.say(run, runstate.NoticeError, "The board could not be read, so the play stops here: "+err.Error())
		r.end(run, "")
		return chainStep{}, false
	}
	done := board.FlowNode(flowNodeID)
	if done == nil {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” is no longer on the board, so nothing says what"+
			" follows it; the chain run ends here.", title))
		r.end(run, "")
		return chainStep{}, false
	}
	// The chat is shortened **here**, after the flow node it belongs to and before anything is taken
	// off it: it is that flow node's own conversation, and what the flow node says about it is said
	// whether or not a chain leaves it. The last flow node of a board shortens its chat exactly as
	// the first one does, and the fork below is then taken from the short one, which is the
	// whole of why a long chain costs less with the box ticked.
	if done.OnSuccess.Compact && done.IsAI() && chat != "" {
		r.setState(run, flowNodeID, chat, chainRunStateCompacting)
		if !r.compact(ctx, run, chat) {
			r.end(run, "")
			return chainStep{}, false
		}
	}
	// Record and announce normal chain completion even with no browser watching.
	nextID := done.OnSuccess.FlowNode
	if selected != "" {
		nextID = selected
	}
	if nextID == "" {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{Done: *done, Decision: ChainRunChainEnd})
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” played its last flow node, “%s”; the chain run is done.",
			r.nameOf(run), title))
		r.end(run, "")
		return chainStep{}, false
	}
	next := board.FlowNode(nextID)
	if selected != "" && ((done.Type != pkgBoards.FlowNodeTypeExclusiveGateway && done.Type != pkgBoards.FlowNodeTypeLimiter) ||
		!slices.Contains(done.OnSuccess.FlowNodes, selected)) {
		next = nil
	}
	if next != nil && !next.Archived {
		if err := board.Workflow(next.Workflow).ValidateFiles(); err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.end(run, "")
			return chainStep{}, false
		}
	}
	if next != nil && next.IsHuman() && !next.Archived {
		if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Todo(run.Handle, next.ID) }); err != nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
			r.end(run, "")
			return chainStep{}, false
		}
		r.say(run, runstate.NoticeInfo, fmt.Sprintf("“%s” is to do; the chain run is done.", next.Title))
		r.end(run, "")
		return chainStep{}, false
	}
	if next == nil || !next.Runnable() {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: nextID, Decision: chainRunChainNextUnplayable,
		})
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” names a flow node after it that is not there to play;"+
			" the chain ends here.", title))
		r.end(run, "")
		return chainStep{}, false
	}
	// An AI flow node saying nothing — no title, no description and no success criteria — has
	// nothing to send. The chain ends rather than spending a turn on an empty prompt. What the
	// other types do is not written in words, so none of them ever runs out.
	if !next.HasWork() {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
			Decision: chainRunChainNextEmpty,
		})
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” has nothing to send; the chain ends here.",
			next.Title))
		r.end(run, "")
		return chainStep{}, false
	}
	// A flow node pinned to another runner is another machine's to play: the chain ends here rather
	// than running it where its folders are not.
	if refusal := r.RunnerRefusal(*next); refusal != "" {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
			Decision: chainRunChainPinned,
		})
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” %s; the chain ends here.",
			next.Title, strings.TrimPrefix(refusal, "this flow node ")))
		r.end(run, "")
		return chainStep{}, false
	}
	if played[next.ID] {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
			Decision: chainRunChainReplayed,
		})
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("The chain after “%s” comes back to a flow node it has already"+
			" played; it ends here.", title))
		r.end(run, "")
		return chainStep{}, false
	}
	var input *json.RawMessage
	if !next.IsGateway() && (step.input != nil || done.Type == pkgBoards.FlowNodeTypeExclusiveGateway || next.Type == pkgBoards.FlowNodeTypeExclusiveGateway) {
		input = &outcome.output
	}
	// Exclusive arrivals wait for a held flow node and carry their own input. Other
	// chains meeting on a held flow node stop, naming the run that got there first.
	if held := r.holderOf(run.Handle, next.ID); held != "" && input == nil {
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
			Holder: held, Decision: chainRunChainHeld,
		})
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("The flow node after “%s” is already being played by “%s”;"+
			" the chain ends here.", title, held))
		r.end(run, "")
		return chainStep{}, false
	}
	// The chat is carried on only by a flow node that has one. A Scheduler and a Shutdown speak to
	// nobody, so a mode saying `continue` in front of one is honoured as far as it can be: the
	// chain carries on, and the conversation stops there.
	previousChatIsSource := next.Status == pkgBoards.FlowNodeStatusDone && next.Chat == chat
	resumingTask := next.Status == pkgBoards.FlowNodeStatusInterrupted && next.Chat != ""
	carry := done.OnSuccess.CarriesChat() && next.IsAI() && chat != "" && !previousChatIsSource && !resumingTask
	if carry {
		source, err := r.convs.Get(chat)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.end(run, "")
			return chainStep{}, false
		}
		folder, err := r.successorFolder(board, next)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” cannot continue the chat: %s", next.Title, err))
			r.end(run, "")
			return chainStep{}, false
		}
		decision := ChainRunChainDecision{Done: *done, NextID: next.ID, ToFolder: folder, From: chat}
		decision.Done.Settings.Folder = source.Folder
		// A conversation is made for a folder and keeps it, so a flow node naming another cannot be
		// played in a fork of the chat it is being handed — a fork has the source's folder and
		// no other. Where a played turn writes is the one thing this board never decides for the
		// user, so it stops and says so rather than running the flow node somewhere it did not ask
		// for.
		if folder != source.Folder {
			decision.Decision = ChainRunChainFolderMismatch
			r.LogChain(run, flowNodeID, decision)
			r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” runs in another folder than the chat it would follow"+
				" on from, which cannot change folder; the play stops here.", next.Title))
			r.end(run, "")
			return chainStep{}, false
		}
		// Fork the transcript and compatible native session for the successor,
		// while keeping the completed flow node's conversation independent.
		target := *next
		target.Chat = target.ChatForPlay()
		targetAgent, err := r.ResolveAgent(target)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.end(run, "")
			return chainStep{}, false
		}
		if reason := r.AgentRefusal(target); reason != "" {
			r.say(run, runstate.NoticeError, reason)
			r.end(run, "")
			return chainStep{}, false
		}
		forked, err := r.forkChat(run, chat, next.Title, targetAgent)
		if err != nil {
			decision.Decision = chainRunChainForkFailed
			r.LogChain(run, flowNodeID, decision)
			r.say(run, runstate.NoticeError, fmt.Sprintf("The chat “%s” would follow on from could not be"+
				" forked, so the play stops here: %s", next.Title, err.Error()))
			r.end(run, "")
			return chainStep{}, false
		}
		decision.Forked, decision.Chat, decision.Decision = forked, forked, ChainRunChainForked
		r.LogChain(run, flowNodeID, decision)
		chat = forked
	} else {
		// The conversation ends with this flow node: what follows is played in a chat of its own —
		// whichever it already had, or one made for it. Unless the one it already had IS the
		// conversation just finished: a chain run before under `continue` writes it onto the
		// next flow node, and a mode flipped to `end` since does not take it back off. Playing the
		// next flow node there would send it into the very chat this flow node is ending, so nothing is
		// handed on and a fresh one is made for it instead.
		from := chat
		chat = next.ChatForPlay()
		if chat == from {
			chat = ""
		}
		r.LogChain(run, flowNodeID, ChainRunChainDecision{
			Done: *done, NextID: next.ID, ToFolder: next.Settings.WorkFolder(),
			From: from, Chat: chat, Decision: chainRunChainOwnChat,
		})
	}
	return chainStep{flowNodeID: next.ID, chat: chat, how: playHow{handoff: carry}, input: input}, true
}
