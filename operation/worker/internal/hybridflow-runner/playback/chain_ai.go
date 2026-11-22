package playback

import (
	"context"
	"encoding/json"
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"kiao/worker/internal/hybridflow-runner/turns"
	"strings"
)

// playAI resolves the agent, claims the card, builds its input and runs one attempt.
// The conversation pins its publication; effort and permissions belong to this card's turn.
func (r *ChainRunner) playAI(ctx context.Context, run *ChainRun, board *pkgBoards.BoardContent, flowNode *pkgBoards.FlowNode, chat string, how playHow) (PlayOneOutcome, *harnessfaults.TurnFault) {
	flowNodeID := flowNode.ID

	// What the card's agent names, resolved before anything is marked: a card whose agent is gone
	// — or was never one — ends the chain unmarked, the way a chain reaching a card nobody can
	// play ends it, rather than as a turn that ran and failed.
	resolving := *flowNode
	resolving.Chat = chat
	resolved, err := r.ResolveAgent(resolving)
	if err != nil {
		r.say(run, runstate.NoticeError, "“"+flowNode.Title+"” cannot be played: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if resolved.Harness == harnessapi.HarnessPi && r.Hub != nil && chat == "" {
		target, err := r.Hub.HarnessRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		resolved.profileID, resolved.Model = target.Profile.ID, target.Provider+"/"+target.ModelID
	}
	if chat != "" && resolved.Snapshot != nil {
		source, err := r.convs.Get(chat)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		if source.AgentVersion == nil || source.AgentVersion.AgentID != resolved.Snapshot.AgentID ||
			source.Harness != resolved.Harness || (resolved.profileID != "" && source.ProfileID != resolved.profileID) ||
			(flowNode.Settings.Harness != "" && flowNode.Settings.Model != "" && source.AgentVersion.ConversationModel(source.Model) != resolved.Model) ||
			(source.AgentVersion.Commit == "" && resolved.Snapshot.Commit != "") {
			forked, err := r.forkChat(run, chat, flowNode.Title, resolved)
			if err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
			}
			if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNodeID, forked) }); err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
			}
			chat = forked
		}
	}
	out := PlayOneOutcome{Chat: chat, Title: flowNode.Title, Harness: resolved.Harness}

	r.setState(run, flowNodeID, chat, ChainRunStatePlaying)
	// The flow node is the run's from here, and the board says so: a run is minutes to hours long,
	// and the spinner the board draws over the card is the view of whoever started it — a tab that was
	// closed, a second machine, tomorrow morning have nothing but the mark. It also settles what a
	// flowNode played again says, whatever the last play made of it: being worked on now, rather than
	// yesterday's error under a spinner.
	take := func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, flowNodeID, run.Id) }
	if how.resume {
		// The same play coming back to the same flow node: it is marked as being worked on again.
		take = func() (*pkgBoards.BoardContent, error) { return r.Boards.Reopen(run.Handle, flowNodeID, run.Id) }
	}
	if err := r.mark(run, take); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	contract, err := r.outputContract(*flowNode, board)
	if err != nil {
		r.say(run, runstate.NoticeError, "The output type could not be used: "+err.Error())
		r.fail(run, flowNodeID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	cardPrompt := pkgBoards.FlowNodePrompt(*flowNode)
	if !how.resume {
		cardPrompt, err = pkgBoards.RenderInput(cardPrompt, board.Input(flowNodeID))
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.fail(run, flowNodeID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	}

	if chat == "" {
		made, err := r.ConversationFor(run, *flowNode, resolved)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("A conversation could not be made for “%s”: %s", flowNode.Title, err.Error()))
			return PlayOneOutcome{Round: roundStop}, nil
		}
		chat, out.Chat = made, made
		// Before the prompt: the user is meant to be able to open what a running flow node is doing, and
		// a turn that then runs for ten minutes is ten minutes of the card having nowhere to point.
		if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNodeID, made) }); err != nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		r.setState(run, flowNodeID, chat, ChainRunStatePlaying)
	}

	if meta, err := r.convs.Get(chat); err == nil && meta.AgentVersion != nil {
		resolved = publishedPlayAgent(meta.AgentVersion)
		resolved.Model, resolved.profileID = meta.AgentVersion.ConversationModel(meta.Model), meta.ProfileID
		out.Harness = resolved.Harness
	}

	// What the turn is sent, and what it is sent with. A resumed one is sent neither the description
	// nor its pictures: the conversation was given both when the play took the flow node, and it still
	// holds them along with everything the cut-off turn had made of them.
	prompt, images := ChainRunResumePrompt, []harnessapi.PromptFile(nil)
	if !how.resume {
		prompt, images = cardPrompt, r.ImagesOf(run, *flowNode)
	}
	reply, refusal, stopped := r.turn(ctx, run, chat, turns.TurnRequest{
		ConversationID: chat,
		Prompt:         contract.Prompt(prompt),
		// All of it stated, nothing left to the deployment: there is nobody at the keyboard. The
		// effort and the mode are the flow node's own, a flow node missing either being one no run ever
		// reaches; the model comes from the card or publication. The
		// play itself travels too, so the turn's records name the card back.
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Instructions:   resolved.Instructions,
		ManagedAgent:   resolved.Name,
		AgentRef:       resolved.Id,
		RunID:          run.Id,
		FlowNodeID:     flowNode.ID,
		Board:          run.Handle,
		Images:         images,
	}, how.attach)
	if ctx.Err() != nil {
		// Stopped by a run replacing this one, which has already said what it is doing.
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	// What came back may be no answer at all: a prompt this service refused, or an error the CLI wrote
	// where the answer would have gone — at the head of the reply, or at the foot of an hour of work.
	// Either way the flow node was not finished, so it is not marked done; the only question left is
	// whether waiting is worth anything.
	//
	// A turn somebody *stopped* is none of that, whatever it came back with — `API Error: Request was
	// aborted.` is how the CLI words an interruption — so it is not a fault at all: the flow node is
	// marked interrupted rather than done, because it was worked on but not finished, and the run
	// stops because somebody said so.
	result := inspectCardTurn(reply, refusal, stopped, r.harnessLabel(out.Harness))
	promptKind := ChainRunPromptCard
	if how.attach {
		promptKind = chainRunPromptAttach
	} else if how.resume {
		promptKind = chainRunPromptResume
	}
	r.LogTurn(run, flowNodeID, chat, ChainRunTurnOutcome{
		Prompt: promptKind, Harness: out.Harness, Model: resolved.Model,
		Effort: flowNode.Settings.Effort, Permission: flowNode.Settings.Permission,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: result.fault,
	})
	// A turn blocked twice — stopped and resumed once by its driver, then blocked again — is
	// neither an error to mark nor one to wait out: the conversation is forked and the flow
	// node is played again from the fork. A blocked turn is silent, so the fork carries the
	// transcript as it stood at the first relaunch, and whatever the forked turn answers
	// decides the flow node like any other turn.
	if !stopped && refusal == nil && reply.Failure == harnessfaults.MuseBlockedTwiceMessage {
		return r.PlayBlockedFork(ctx, run, *flowNode, out, resolved, chat, contract)
	}
	return r.finishAITurn(run, *flowNode, out, contract, result)
}

// A blocked fork already carries the transcript and partial work.
const ChainRunBlockedForkPrompt = "After two blockages, I forked this conversation. Please take it over and go through to the end of what was requested."

// PlayBlockedFork recovers a twice-blocked turn in a forked conversation.
// A second double blockage in that fork is a failure; it cannot fork recursively.
func (r *ChainRunner) PlayBlockedFork(ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome, resolved PlayAgent, chat string, contract *pkgBoards.OutputContract) (PlayOneOutcome, *harnessfaults.TurnFault) {
	r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” was blocked twice; the conversation is forked and played again from the fork.", flowNode.Title))
	forked, err := r.forkChat(run, chat, flowNode.Title)
	if err != nil {
		r.say(run, runstate.NoticeError, "The conversation could not be forked, so the play stops here: "+err.Error())
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	r.LogNote(run, flowNode.ID, forked, "", "chat forked "+chat+" -> "+forked)
	// The card points at the fork from here: ten minutes of a resumed turn is ten minutes of
	// somebody wanting to open what it is doing.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNode.ID, forked) }); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	out.Chat = forked
	r.setState(run, flowNode.ID, forked, ChainRunStatePlaying)
	reply, refusal, stopped := r.turn(ctx, run, forked, turns.TurnRequest{
		ConversationID: forked,
		Prompt:         contract.Prompt(ChainRunBlockedForkPrompt),
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Instructions:   resolved.Instructions,
		ManagedAgent:   resolved.Name,
		AgentRef:       resolved.Id,
		RunID:          run.Id,
		FlowNodeID:     flowNode.ID,
		Board:          run.Handle,
	}, false)
	if ctx.Err() != nil {
		// Stopped by a run replacing this one, which has already said what it is doing.
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	result := inspectCardTurn(reply, refusal, stopped, r.harnessLabel(out.Harness))
	r.LogTurn(run, flowNode.ID, forked, ChainRunTurnOutcome{
		Prompt: chainRunPromptBlockedFork, Harness: out.Harness, Model: resolved.Model,
		Effort: flowNode.Settings.Effort, Permission: flowNode.Settings.Permission,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: result.fault,
	})
	return r.finishAITurn(run, flowNode, out, contract, result)
}

// ImagesOf resolves card images from the store root. Missing or excess images
// raise notices without stopping the card.
func (r *ChainRunner) ImagesOf(run *ChainRun, flowNode pkgBoards.FlowNode) []harnessapi.PromptFile {
	images, missing, dropped := pkgBoards.FlowNodeImages(r.cfg.RootPath, flowNode.Body)
	if len(missing) == 1 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links an image the store does not hold, so the turn was "+
			"not given it: %s", flowNode.Title, missing[0]))
	} else if len(missing) > 1 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links %d images the store does not hold, so the turn was "+
			"not given them: %s", flowNode.Title, len(missing), strings.Join(missing, ", ")))
	}
	if dropped > 0 {
		r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” links %d images; the turn was given the first %d.",
			flowNode.Title, len(images)+dropped, pkgBoards.MaxFlowNodeImages))
	}
	return images
}

// cardTurnResult keeps interruption ahead of fault interpretation, including aborted API replies.
type cardTurnResult struct {
	reply   harnessfaults.TurnReply
	refusal *harnessfaults.TurnRefusal
	stopped bool
	fault   *harnessfaults.TurnFault
}

func inspectCardTurn(reply harnessfaults.TurnReply, refusal *harnessfaults.TurnRefusal, stopped bool, label string) cardTurnResult {
	result := cardTurnResult{reply: reply, refusal: refusal, stopped: stopped}
	if !stopped {
		if refusal != nil {
			result.fault = harnessfaults.RefusalFault(refusal.Code)
		} else {
			result.fault = harnessfaults.ReplyFault(reply, label)
		}
	}
	return result
}

// finishAITurn applies the same retry, failure, output and interruption rules to every AI attempt.
func (r *ChainRunner) finishAITurn(run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome, contract *pkgBoards.OutputContract, result cardTurnResult) (PlayOneOutcome, *harnessfaults.TurnFault) {
	chat := out.Chat
	reply, refusal, stopped, fault := result.reply, result.refusal, result.stopped, result.fault

	if fault != nil && fault.Retry {
		out.Round = roundAgain
		return out, fault
	}
	if refusal != nil && !stopped {
		// No turn ran, so the flow node has not been worked on. Whatever follows it would meet the same
		// refusal.
		r.say(run, runstate.NoticeError, fmt.Sprintf("%s did not take “%s”: %s", r.harnessLabel(out.Harness), flowNode.Title, refusal.Message))
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if fault != nil {
		// A turn ran and ended in an error nothing but the user can clear.
		r.say(run, runstate.NoticeError, fmt.Sprintf("“%s” came back an error — %s — and is marked as one.",
			flowNode.Title, fault.Summary))
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}

	var output json.RawMessage
	if !stopped {
		var err error
		output, err = contract.Extract(reply.Tail)
		if err != nil {
			r.say(run, runstate.NoticeError, "Structured output could not be exported: "+err.Error())
			r.fail(run, flowNode.ID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	}
	status := pkgBoards.FlowNodeStatusDone
	if stopped {
		status = pkgBoards.FlowNodeStatusInterrupted
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, status, output)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if stopped {
		out.Round = roundSuspend
		return out, nil
	}
	out.Round = RoundOn
	return out, nil
}
