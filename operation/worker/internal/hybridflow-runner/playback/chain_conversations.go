package playback

import (
	"context"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	briefing "kiao/worker/internal/hybridflow-runner/harnesses/prompt"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"strings"
	"time"
)

// turn sends one prompt and waits for the turn to end, or attaches to the one already running.
//
// It reports the reply as the transcript holds it, the refusal where no turn ever ran, and whether
// the turn was *stopped* rather than finished. A turn killed mid-sentence is often recorded as
// having said nothing at all: the CLI does not hand over a message it never finished, and inventing
// one here would put words in the model's mouth.
func (r *ChainRunner) turn(ctx context.Context, run *ChainRun, chat string, req turns.TurnRequest, attach bool) (reply harnessfaults.TurnReply, refusal *harnessfaults.TurnRefusal, stopped bool) {
	var job *turns.Turn
	if attach && chat != "" {
		job = r.awaitTurnStart(ctx, chat)
		if ctx.Err() == nil {
			if job != nil {
				r.LogNote(run, req.FlowNodeID, chat, "", "joined the turn started in this chat")
			} else {
				r.LogNote(run, req.FlowNodeID, chat, "", "no turn started in time; the flow node is played as written")
			}
		}
	}
	if job == nil {
		if ctx.Err() != nil {
			return harnessfaults.TurnReply{}, nil, false
		}
		job, refusal = r.Hub.ExecuteTurn(run.Owner, req)
		if refusal != nil {
			return harnessfaults.TurnReply{}, refusal, false
		}
	}

	select {
	case <-job.Settled:
	case <-ctx.Done():
		return harnessfaults.TurnReply{}, nil, false
	}

	interrupted, failure := job.Outcome()
	if failure != "" {
		// The turn was recorded and then never got off the ground. It is a refusal as far as the run
		// is concerned: nothing ran, and nothing waits for it.
		return harnessfaults.TurnReply{}, &harnessfaults.TurnRefusal{Code: turnevents.ErrCodeSpawnFailed, Message: failure}, false
	}
	// The transcript holds what the turn *said*; the job holds what it reported going wrong, which is
	// where `codex exec` puts an error and where the transcript therefore has nothing. Both readings
	// travel, and replyFault decides which of them is the turn's story.
	said := r.lastReply(chat)
	said.Failure = job.LastFailure()
	return said, nil, interrupted
}

// awaitTurnStart finds a live user turn within ResumeWindow. Nil asks the caller to submit the card.
func (r *ChainRunner) awaitTurnStart(ctx context.Context, chat string) *turns.Turn {
	deadline := time.Now().Add(r.ResumeWindow)
	for {
		if job := r.Hub.RunningTurn(chat); job != nil {
			job.Mu.Lock()
			live := !job.IsDone
			job.Mu.Unlock()
			if live {
				return job
			}
		}
		if time.Now().After(deadline) {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// lastReply reads the settled turn's last assistant record. Every settled turn writes one,
// including empty and failed turns, so a previous answer cannot be mistaken for this one.
func (r *ChainRunner) lastReply(chat string) harnessfaults.TurnReply {
	records, err := r.convs.Messages(chat)
	if err != nil {
		pkgBoards.LogChainRun.Warn("cannot read back the reply", "conversation", chat, "error", err)
		return harnessfaults.TurnReply{}
	}
	for i := len(records) - 1; i >= 0; i-- {
		if records[i].Role == conversations.RoleAssistant {
			return harnessfaults.TurnReply{
				Text:     records[i].BlockText(),
				Tail:     records[i].BlockTail(),
				ExitCode: records[i].ExitCode,
			}
		}
	}
	return harnessfaults.TurnReply{}
}

// compact sends the chat command through TurnExecutor. Failure ends progression immediately;
// the card required compaction before its conversation could be handed over.
func (r *ChainRunner) compact(ctx context.Context, run *ChainRun, chat string) bool {
	flowNodeID := run.FlowNodeID
	reply, refusal, stopped := r.turn(ctx, run, chat, turns.TurnRequest{
		ConversationID: chat, Prompt: briefing.ChainRunCompactCommand,
		RunID: run.Id, FlowNodeID: flowNodeID, Board: run.Handle,
	}, false)
	if ctx.Err() != nil {
		return false
	}
	harness := ""
	if r.convs != nil {
		if meta, err := r.convs.Get(chat); err == nil {
			harness = meta.Harness
		}
	}
	var fault *harnessfaults.TurnFault
	if refusal == nil && !stopped {
		fault = harnessfaults.ReplyFault(reply, r.chatHarnessLabel(chat))
	}
	r.LogTurn(run, flowNodeID, chat, ChainRunTurnOutcome{
		Prompt: ChainRunPromptCompact, Harness: harness,
		ExitCode: reply.ExitCode, Stopped: stopped, Refusal: refusal, Fault: fault,
	})
	if refusal != nil {
		r.say(run, runstate.NoticeError, "The chat could not be shortened: "+refusal.Message)
		return false
	}
	if stopped {
		r.say(run, runstate.NoticeInfo, "The compaction was stopped, so the play stops with it.")
		return false
	}
	if fault != nil {
		r.say(run, runstate.NoticeError, "The chat could not be shortened — "+fault.Summary+" — and the play stops here.")
		return false
	}
	return !r.stopping(run)
}

// harnessLabel uses the registry label, with a fallback for incomplete assemblies.
func (r *ChainRunner) harnessLabel(harness string) string {
	if r.Hub == nil || r.Hub.HarnessRegistry() == nil {
		return protocol.OrDefault(harness, "the harness")
	}
	// A card that names no agent is one no run reaches — a flow node missing any of its five settings
	// is not playable — but a summary is a sentence shown to somebody, and " is overloaded" is not
	// one.
	if strings.TrimSpace(harness) == "" {
		harness = r.Hub.HarnessRegistry().DefaultName()
	}
	return protocol.OrDefault(r.Hub.HarnessRegistry().Label(harness), "the harness")
}

// chatHarnessLabel resolves the harness of a conversation, including compaction turns.
func (r *ChainRunner) chatHarnessLabel(chat string) string {
	if r.convs == nil || chat == "" {
		return r.harnessLabel("")
	}
	meta, err := r.convs.Get(chat)
	if err != nil {
		return r.harnessLabel("")
	}
	return r.harnessLabel(meta.Harness)
}

// ConversationFor creates a chat with the card's settings and current published agent version.
func (r *ChainRunner) ConversationFor(run *ChainRun, flowNode pkgBoards.FlowNode, resolved PlayAgent) (string, error) {
	folder, err := runnerconfig.ResolveFolder(r.cfg.RootPath, flowNode.Settings.WorkFolder())
	if err != nil {
		return "", err
	}
	settings := harnessapi.ExecutionSettings{
		ProfileID: resolved.profileID, Model: resolved.Model, Effort: flowNode.Settings.Effort,
		CaptureDefaults: resolved.Snapshot != nil && len(resolved.Snapshot.Harnesses) != 0,
	}
	if r.Hub != nil {
		settings, err = r.Hub.HarnessRegistry().ResolveExecutionSettings(resolved.Harness, settings)
		if err != nil {
			return "", err
		}
	}
	meta, err := r.convs.Create(conversations.ConversationMeta{
		AgentVersion:   pkgBoards.ConfiguredAgentVersion(resolved.Snapshot, settings.Model, settings.ProfileID, settings.Effort),
		Title:          strings.TrimSpace(flowNode.Title),
		TitleSetByUser: strings.TrimSpace(flowNode.Title) != "",
		Folder:         folder.Virtual,
		Harness:        resolved.Harness,
		ProfileID:      settings.ProfileID,
		Owner:          run.Owner.User,
		Model:          settings.Model,
		Effort:         settings.Effort,
		PermissionMode: flowNode.Settings.Permission,
		Thinking:       true,
	})
	if err != nil {
		return "", err
	}
	// The id is the join between this log and the conversation registry: a reader with the run's
	// log and the chat's transcript has both halves of the play.
	r.LogNote(run, flowNode.ID, meta.ID, "",
		"conversation made in "+protocol.OrDefault(folder.Virtual, "/")+" on "+resolved.Harness)
	if r.Hub != nil {
		r.Hub.NotifyRegistry(r.Hub.ConversationEvent(meta))
	}
	return meta.ID, nil
}

// forkChat names the successor conversation after its card, avoiding duplicate titles
// in the conversation switcher. The fork notice identifies its source.
// Compatible engines and profiles branch the native session; other targets receive
// the common transcript as context in a fresh session.
func (r *ChainRunner) forkChat(run *ChainRun, chat, title string, targets ...PlayAgent) (string, error) {
	source, err := r.convs.Get(chat)
	if err != nil {
		return "", err
	}
	harness := harnessapi.ResolvedHarness(source.Harness)
	target := conversations.ForkTarget{Harness: harness, Label: r.harnessLabel(harness), Branches: r.branches(harness), ProfileID: source.ProfileID}
	if len(targets) > 0 {
		onto := targets[0]
		target.AgentVersion, target.ReplaceVersion = onto.Snapshot, true
		target.Harness, target.Label, target.Branches = onto.Harness, r.harnessLabel(onto.Harness), r.branches(onto.Harness)
		target.PermissionMode = source.PermissionMode
		settings := harnessapi.ExecutionSettings{
			ProfileID: onto.profileID, Model: onto.Model, Effort: source.Effort,
			CaptureDefaults: onto.Snapshot != nil && len(onto.Snapshot.Harnesses) != 0,
		}
		if r.Hub != nil {
			if onto.Harness == harnessapi.HarnessPi {
				settings.Effort = ""
			}
			settings, err = r.Hub.HarnessRegistry().ResolveExecutionSettings(onto.Harness, settings)
			if err != nil {
				return "", err
			}
		}
		target.ProfileID, target.Model, target.Effort = settings.ProfileID, settings.Model, settings.Effort
	}
	forked, err := r.convs.Fork(chat, run.Owner.User, "", target)
	if err != nil {
		return "", err
	}
	named := strings.TrimSpace(title)
	if named != "" {
		// The rename is a second write rather than an argument to the fork: forking is the
		// conversation store's business and what a board calls the copy is this runner's.
		if renamed, err := r.convs.Update(forked.ID, func(meta *conversations.ConversationMeta) {
			meta.Title, meta.TitleSetByUser = conversations.NormaliseTitle(named), true
		}); err == nil {
			forked = renamed
		} else {
			// A copy under the fork's own title is a copy that works; the run is not stopped over
			// what it is called.
			pkgBoards.LogChainRun.Warn("cannot name the forked chat after its flow node",
				"run", run.Id, "conversation", forked.ID, "error", err)
		}
	}
	if r.Hub != nil {
		r.Hub.NotifyRegistry(r.Hub.ConversationEvent(forked))
	}
	pkgBoards.LogChainRun.Info("chat forked for the next flow node", "run", run.Id, "from", chat, "to", forked.ID)
	return forked.ID, nil
}

// branches reports native session branching support; otherwise forks carry the transcript.
func (r *ChainRunner) branches(harness string) bool {
	return r.Hub != nil && r.Hub.HarnessRegistry() != nil && r.Hub.HarnessRegistry().Branches(harness)
}
