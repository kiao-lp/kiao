package playback

import (
	"context"
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"kiao/worker/internal/hybridflow-runner/turns"
	"strings"
)

// playAI resolves the agent, claims the flow node, builds its input and runs one attempt.
// The conversation pins its publication; effort and permissions belong to this flow node's turn.
func (r *ChainRunner) playAI(ctx context.Context, run *ChainRun, board *pkgBoards.BoardContent, flowNode *pkgBoards.FlowNode, step chainStep) (PlayOneOutcome, *harnessfaults.TurnFault) {
	flowNodeID := flowNode.ID
	chat, how := step.chat, step.how
	continuing := how.resume || how.suspended != nil ||
		(flowNode.Status == pkgBoards.FlowNodeStatusInterrupted && chat != "")
	resumePrompt := how.resume
	if continuing {
		meta, err := r.convs.Get(chat)
		if err != nil {
			r.say(run, runstate.NoticeError, "The task's conversation could not be resumed: "+err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		resumePrompt = resumePrompt || (meta.SessionID != "" && !meta.ForkPending)
		if previous := r.Hub.RunningTurn(chat); previous != nil {
			if drained := previous.InterruptedProcessDone(); drained != nil {
				select {
				case <-drained:
				case <-run.waking():
					return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
				case <-ctx.Done():
					return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
				}
			}
		}
	}
	fromChat := how.suspended != nil && how.suspended.message != nil

	// What the flow node's agent names, resolved before anything is marked: a flow node whose agent is gone
	// — or was never one — ends the chain unmarked, the way a chain reaching a flow node nobody can
	// play ends it, rather than as a turn that ran and failed.
	resolved, err := r.resolveFlowNodeAgent(*flowNode, chat)
	if err != nil {
		r.say(run, runstate.NoticeError, "“"+flowNode.Title+"” cannot be played: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	startingChat := chat
	r.setState(run, flowNodeID, startingChat, ChainRunStatePlaying)
	// The flow node is the run's from here, and the board says so: a run is minutes to hours long,
	// and the spinner the board draws over the flow node is the view of whoever started it — a tab that was
	// closed, a second machine, tomorrow morning have nothing but the mark. It also settles what a
	// flowNode played again says, whatever the last play made of it: being worked on now, rather than
	// yesterday's error under a spinner.
	take := func() (*pkgBoards.BoardContent, error) { return r.Boards.Start(run.Handle, flowNodeID, run.Id) }
	if how.resume {
		// The same play coming back to the same flow node: it is marked as being worked on again.
		take = func() (*pkgBoards.BoardContent, error) { return r.Boards.Reopen(run.Handle, flowNodeID, run.Id) }
	}
	claimed, err := r.claimFlowNode(ctx, run, step.input != nil && !how.resume, take)
	if err != nil {
		if !r.stopping(run) && ctx.Err() == nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		}
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	current := claimed.FlowNode(flowNodeID)
	if current == nil {
		r.say(run, runstate.NoticeError, "The flow node is no longer on the board; the play stops here.")
		return PlayOneOutcome{Round: roundStop}, nil
	}
	// The claim can detach a conversation if the flow node completed after our first read.
	if continuing && chat != current.Chat && !how.resume {
		r.say(run, runstate.NoticeError, "The task's conversation changed before it could be resumed.")
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if !continuing && chat != "" && !how.handoff && chat != current.Chat {
		chat = current.Chat
		resolved, err = r.resolveFlowNodeAgent(*flowNode, chat)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	}

	contract, err := r.outputContract(*flowNode, board)
	if err != nil {
		r.say(run, runstate.NoticeError, "The output type could not be used: "+err.Error())
		r.fail(run, flowNodeID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	promptNode := *flowNode
	values := step.nodeContext(claimed, current)
	workflow, err := r.prepareTaskWorkflow(run, &promptNode, values.Workflow, continuing)
	if err != nil {
		r.say(run, runstate.NoticeError, err.Error())
		r.fail(run, flowNodeID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	values.Workflow = workflow
	var flowNodePrompt string
	if !resumePrompt && !fromChat {
		flowNodePrompt, err = values.Render(pkgBoards.FlowNodePrompt(promptNode))
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.fail(run, flowNodeID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	}

	if !continuing {
		folderChat, err := r.chatForTaskFolder(&promptNode, values, chat, how.handoff)
		if err != nil {
			r.say(run, runstate.NoticeError, err.Error())
			r.fail(run, flowNodeID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		if folderChat != chat {
			chat = folderChat
			resolved, err = r.resolveFlowNodeAgent(promptNode, chat)
			if err != nil {
				r.say(run, runstate.NoticeError, err.Error())
				r.fail(run, flowNodeID)
				return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
			}
		}
		chat, err = r.conversationForFlowNode(run, promptNode, resolved, chat)
		if err != nil {
			r.say(run, runstate.NoticeError, fmt.Sprintf("A conversation could not be prepared for “%s”: %s", flowNode.Title, err.Error()))
			return PlayOneOutcome{Round: roundStop}, nil
		}
	}
	// Link the conversation after taking the flow node and before sending the prompt.
	if chat != current.Chat {
		if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNodeID, chat) }); err != nil {
			r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	}
	if chat != startingChat {
		r.setState(run, flowNodeID, chat, ChainRunStatePlaying)
	}

	out := PlayOneOutcome{Chat: chat, Title: flowNode.Title, Harness: resolved.Harness}
	if meta, err := r.convs.Get(chat); err == nil && meta.AgentVersion != nil {
		resolved = publishedPlayAgent(meta.AgentVersion)
		resolved.Model, resolved.profileID = meta.AgentVersion.ConversationModel(meta.Model), meta.ProfileID
		out.Harness = resolved.Harness
	}

	// A continuation can pick up the existing session. A task interrupted before
	// the harness opened a session still needs the description and images.
	req := turns.TurnRequest{
		ConversationID: chat,
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
	}
	promptKind := ChainRunPromptFlowNode
	switch {
	case fromChat:
		req = *how.suspended.message
		how.suspended.message = nil
		promptKind = chainRunPromptAttach
	case resumePrompt:
		req.Prompt = contract.Prompt(workflow.Prompt(ChainRunResumePrompt))
		promptKind = chainRunPromptResume
	default:
		req.Prompt = contract.Prompt(workflow.Prompt(flowNodePrompt))
		// The rendered prompt already validated the description's references.
		promptNode.Body, _ = values.Render(promptNode.Body)
		req.Images = r.ImagesOf(run, promptNode)
	}
	if how.suspended != nil && how.suspended.awaitMessage {
		promptKind = chainRunPromptAttach
	}
	req.Instructions, req.ManagedAgent, req.AgentRef = resolved.Instructions, resolved.Name, resolved.Id
	req.RunID, req.FlowNodeID, req.Board = run.Id, flowNode.ID, run.Handle
	reply, refusal, stopped := r.turn(ctx, run, chat, req, how.suspended)
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
	result := inspectAITurn(reply, refusal, stopped, r.harnessLabel(out.Harness))
	r.LogTurn(run, flowNodeID, chat, ChainRunTurnOutcome{
		Prompt: promptKind, Harness: out.Harness, Model: resolved.Model,
		Effort: req.Effort, Permission: req.PermissionMode,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: result.fault,
	})
	// A turn blocked twice — stopped and resumed once by its driver, then blocked again — is
	// neither an error to mark nor one to wait out: the conversation is forked and the flow
	// node is played again from the fork. A blocked turn is silent, so the fork carries the
	// transcript as it stood at the first relaunch, and whatever the forked turn answers
	// decides the flow node like any other turn.
	if !stopped && refusal == nil && reply.Failure == harnessfaults.MuseBlockedTwiceMessage {
		return r.PlayBlockedFork(ctx, run, *flowNode, out, resolved, chat, contract, workflow)
	}
	if fromChat && refusal != nil {
		// The composer can retry its message against the same suspended run.
		result.stopped, result.fault = true, nil
	}
	return r.finishAITurn(run, *flowNode, out, contract, result)
}

func (r *ChainRunner) resolveFlowNodeAgent(flowNode pkgBoards.FlowNode, chat string) (PlayAgent, error) {
	flowNode.Chat = chat
	resolved, err := r.ResolveAgent(flowNode)
	if err != nil || resolved.Harness != harnessapi.HarnessPi || r.Hub == nil || chat != "" {
		return resolved, err
	}
	target, err := r.Hub.HarnessRegistry().Profiles.ResolveProfile(resolved.profileID, resolved.Model, flowNode.Settings.Effort)
	if err != nil {
		return PlayAgent{}, err
	}
	resolved.profileID, resolved.Model = target.Profile.ID, target.Provider+"/"+target.ModelID
	return resolved, nil
}

func (r *ChainRunner) conversationForFlowNode(run *ChainRun, flowNode pkgBoards.FlowNode, resolved PlayAgent, chat string) (string, error) {
	if chat == "" {
		return r.ConversationFor(run, flowNode, resolved)
	}
	if resolved.Snapshot == nil {
		return chat, nil
	}
	source, err := r.convs.Get(chat)
	if err != nil {
		return "", err
	}
	if source.AgentVersion == nil || source.AgentVersion.AgentID != resolved.Snapshot.AgentID ||
		source.Harness != resolved.Harness || (resolved.profileID != "" && source.ProfileID != resolved.profileID) ||
		(flowNode.Settings.Harness != "" && flowNode.Settings.Model != "" && source.AgentVersion.ConversationModel(source.Model) != resolved.Model) ||
		(source.AgentVersion.Commit == "" && resolved.Snapshot.Commit != "") {
		return r.forkChat(run, chat, flowNode.Title, resolved)
	}
	return chat, nil
}

// A blocked fork already carries the transcript and partial work.
const ChainRunBlockedForkPrompt = "After two blockages, I forked this conversation. Please take it over and go through to the end of what was requested."

// PlayBlockedFork recovers a twice-blocked turn in a forked conversation.
// A second double blockage in that fork is a failure; it cannot fork recursively.
func (r *ChainRunner) PlayBlockedFork(ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome, resolved PlayAgent, chat string, contract *pkgBoards.OutputContract, workflow *pkgBoards.Workflow) (PlayOneOutcome, *harnessfaults.TurnFault) {
	r.say(run, runstate.NoticeWarning, fmt.Sprintf("“%s” was blocked twice; the conversation is forked and played again from the fork.", flowNode.Title))
	forked, err := r.forkChat(run, chat, flowNode.Title)
	if err != nil {
		r.say(run, runstate.NoticeError, "The conversation could not be forked, so the play stops here: "+err.Error())
		r.fail(run, flowNode.ID)
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	r.LogNote(run, flowNode.ID, forked, "", "chat forked "+chat+" -> "+forked)
	// The flow node points at the fork from here: ten minutes of a resumed turn is ten minutes of
	// somebody wanting to open what it is doing.
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) { return r.Boards.Chat(run.Handle, flowNode.ID, forked) }); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	out.Chat = forked
	r.setState(run, flowNode.ID, forked, ChainRunStatePlaying)
	reply, refusal, stopped := r.turn(ctx, run, forked, turns.TurnRequest{
		ConversationID: forked,
		Prompt:         contract.Prompt(workflow.Prompt(ChainRunBlockedForkPrompt)),
		Model:          resolved.Model,
		Effort:         flowNode.Settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Instructions:   resolved.Instructions,
		ManagedAgent:   resolved.Name,
		AgentRef:       resolved.Id,
		RunID:          run.Id,
		FlowNodeID:     flowNode.ID,
		Board:          run.Handle,
	}, nil)
	if ctx.Err() != nil {
		// Stopped by a run replacing this one, which has already said what it is doing.
		return PlayOneOutcome{Round: roundStop, Chat: forked}, nil
	}
	result := inspectAITurn(reply, refusal, stopped, r.harnessLabel(out.Harness))
	r.LogTurn(run, flowNode.ID, forked, ChainRunTurnOutcome{
		Prompt: chainRunPromptBlockedFork, Harness: out.Harness, Model: resolved.Model,
		Effort: flowNode.Settings.Effort, Permission: flowNode.Settings.Permission,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: result.fault,
	})
	return r.finishAITurn(run, flowNode, out, contract, result)
}

// ImagesOf resolves flow node images from the DCMS root. Missing or excess images
// raise notices without stopping the flow node.
func (r *ChainRunner) ImagesOf(run *ChainRun, flowNode pkgBoards.FlowNode) []harnessapi.PromptFile {
	images, missing, dropped := pkgBoards.FlowNodeImages(r.cfg.DCMSRoot, flowNode.Body)
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

// aiTurnResult keeps interruption ahead of fault interpretation, including aborted API replies.
type aiTurnResult struct {
	reply   harnessfaults.TurnReply
	refusal *harnessfaults.TurnRefusal
	stopped bool
	fault   *harnessfaults.TurnFault
}

func inspectAITurn(reply harnessfaults.TurnReply, refusal *harnessfaults.TurnRefusal, stopped bool, label string) aiTurnResult {
	result := aiTurnResult{reply: reply, refusal: refusal, stopped: stopped}
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
func (r *ChainRunner) finishAITurn(run *ChainRun, flowNode pkgBoards.FlowNode, out PlayOneOutcome, contract *pkgBoards.OutputContract, result aiTurnResult) (PlayOneOutcome, *harnessfaults.TurnFault) {
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

	completion := pkgBoards.PlayResult{Status: pkgBoards.FlowNodeStatusDone}
	if !stopped {
		var err error
		completion.Output, err = contract.Extract(reply.Tail)
		if err != nil {
			r.say(run, runstate.NoticeError, "Structured output could not be exported: "+err.Error())
			r.fail(run, flowNode.ID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
		completion.Workflow, err = r.exportWorkflow(run, reply.Tail)
		if err != nil {
			r.say(run, runstate.NoticeError, "Workflow values could not be exported: "+err.Error())
			r.fail(run, flowNode.ID)
			return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
		}
	} else {
		completion.Status = pkgBoards.FlowNodeStatusInterrupted
	}
	if err := r.mark(run, func() (*pkgBoards.BoardContent, error) {
		return r.Boards.Finish(run.Handle, flowNode.ID, run.Id, completion)
	}); err != nil {
		r.say(run, runstate.NoticeError, "The board could not be written, so the play stops here: "+err.Error())
		return PlayOneOutcome{Round: roundStop, Chat: chat}, nil
	}
	if stopped {
		out.Round = roundSuspend
		return out, nil
	}
	out.Round = RoundOn
	out.output = completion.Output
	return out, nil
}
