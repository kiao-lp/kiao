package muse

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// subagentWait is how long one child transcript read may take.
func (d *MuseDriver) subagentWait() time.Duration {
	if d.subagentTimeout > 0 {
		return d.subagentTimeout
	}
	return museSubagentReadTimeout
}

// completedItem turns one finished transcript item into the blocks it means. A block is taken from
// `item/completed` and from nowhere else: the host announces an item opening, streaming and
// updating before it completes, and the port's contract is that a block is announced once and
// never revised.
//
// Every block carries the running turn's id as its MessageID: turn ids stay stable across
// compaction where item ids do not, so the last one of a turn is where a fork of this conversation
// picks the session up.
func (d *MuseDriver) completedItem(params map[string]any) []harnessapi.HarnessEvent {
	item, _ := params["item"].(map[string]any)
	if len(item) == 0 {
		return nil
	}
	// A finished item is finished whatever turn it names: background work is
	// untracked on the completion, before the turn filter below reads it.
	d.closeWork(pkgProtocol.AsString(item["itemId"]))
	state := d.host.snapshot()
	turnID, lastTurnID, compacting := state.turnID, state.lastTurnID, state.compacting

	kind := pkgProtocol.AsString(item["kind"])
	if compacting {
		// A compaction turn ends on the compaction landing; anything else completing meanwhile
		// belongs to a history this turn never asked to hear about.
		if kind != "compaction" {
			return nil
		}

		billed := d.host.completeUsage(item)

		var events []harnessapi.HarnessEvent
		if billed != nil {
			events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: billed})
		}
		return append(events,
			harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText,
				Text: "The session was compacted."}, MessageID: turnID},
			harnessapi.HarnessEvent{Kind: harnessapi.EventDone, ExitCode: 0},
		)
	}
	// Only this turn's items: a replaced turn's stragglers complete under their own id, and an
	// item outside any turn — the userShell kind — is one no turn asked for. The drop is said out
	// loud: a turn whose end arrives under an id this driver does not know waits forever, and
	// silence is what makes that wait a mystery. The turn that just ended counts as this
	// turn's own: background work completes under its id past its end, and the drain
	// reads those completions back as the turn's own blocks.
	if itemTurn := pkgProtocol.AsString(item["turnId"]); itemTurn != "" && itemTurn != turnID && itemTurn != lastTurnID {
		harnessapi.LogClaudeWS.Warn("muse dropped an item for another turn",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn,
			"expected", turnID, "received", itemTurn, "kind", kind)
		d.Run.Trace.Note(fmt.Sprintf(
			"muse dropped an item for another turn (expected %s, received %s, kind %s)",
			turnID, itemTurn, kind))
		return nil
	}
	// The roster learns of the landing whatever the item means as a block: a
	// delegation's transcript is filed below, but a workflow's end is told
	// nowhere else, and a finished task that stayed `running` on the roster
	// would be the wait that never ends all over again. It goes first, so a
	// block with nothing to say — dropped below — still settles the roster.
	var events []harnessapi.HarnessEvent
	if usage := d.host.noteChildUsage(item); usage != nil {
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: usage})
	}
	if MuseBackgroundKind(item) {
		if event := d.background.roster.finished(item); event != nil {
			events = append(events, *event)
		}
	}
	msgID := pkgProtocol.OrDefault(turnID, lastTurnID)
	if kind == "subagent" {
		block, ok := d.completedSubagent(item)
		if !ok {
			return events
		}
		return append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: block, MessageID: msgID})
	}
	block, ok := MuseBlock(item)
	if !ok {
		return events
	}
	return append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventBlock, Block: block, MessageID: msgID})
}

// completedSubagent emits a delegation once, in parent order, with the child transcript
// read through the host on the relay goroutine. A missing child, host or failed read
// keeps the summary alone without failing the parent turn.
func (d *MuseDriver) completedSubagent(item map[string]any) (harnessapi.TurnBlock, bool) {
	reader := d.subagents

	ref := MuseSubagentRef(item)
	if reader == nil || strings.TrimSpace(ref.ChildSessionID) == "" {
		return MuseBlock(item)
	}
	sub, err := reader.ReadSubagent(ref)
	if err != nil {
		harnessapi.LogClaudeWS.Warn("muse subagent could not be read back; filing the summary line",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn,
			"subagent", ref.SubagentID, "child", ref.ChildSessionID, "error", err)
		d.Run.Trace.Note("muse subagent " + pkgProtocol.OrDefault(ref.SubagentID, ref.ChildSessionID) +
			" could not be read back: " + museSentence(err))
		return MuseBlock(item)
	}
	text := MuseSubagentSummary(item)
	if text == "" && len(sub.Blocks) == 0 {
		return harnessapi.TurnBlock{}, false
	}
	return harnessapi.TurnBlock{Kind: harnessapi.BlockKindSubagent, Text: text, Subagent: sub}, true
}

// museBlock is one transcript item as a reply block. False is an item with nothing to say to the
// transcript: the echo of the turn's own input, a kind outside a turn's story, or a kind this
// driver has never heard of carrying no summary to render generically.
func MuseBlock(item map[string]any) (harnessapi.TurnBlock, bool) {
	switch pkgProtocol.AsString(item["kind"]) {
	case "userMessage":
		// The echo of the input this turn was started — or steered — with, briefing included.
		// The hub's transcript records what the user wrote; repeating the composed text here
		// would show the briefing back to the reader it was never meant for.
		return harnessapi.TurnBlock{}, false
	case "agentMessage":
		return harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: pkgProtocol.AsString(item["text"])}, true
	case "reasoning":
		// Raw reasoning where the provider exposes it, the summary parts where it does not, and
		// an empty block where it exposes neither — that the model thought here is still the
		// thing being recorded.
		if text := pkgProtocol.AsString(item["text"]); text != "" {
			return harnessapi.TurnBlock{Kind: harnessapi.BlockKindThinking, Text: text}, true
		}
		var parts []string
		if summary, ok := item["summary"].([]any); ok {
			for _, part := range summary {
				if text := pkgProtocol.AsString(part); text != "" {
					parts = append(parts, text)
				}
			}
		}
		return harnessapi.TurnBlock{Kind: harnessapi.BlockKindThinking, Text: strings.Join(parts, "\n\n")}, true
	case "toolCall":
		args := museToolArgs(item)
		block := harnessapi.TurnBlock{
			Kind:      harnessapi.BlockKindToolUse,
			Name:      pkgProtocol.OrDefault(pkgProtocol.AsString(item["tool"]), "tool"),
			Input:     harnessapi.SummarizeToolInput(args),
			Detail:    pkgProtocol.PermissionInputSummary(args),
			ToolUseID: pkgProtocol.OrDefault(pkgProtocol.AsString(item["id"]), pkgProtocol.AsString(item["itemId"])),
		}
		if result, isError, exitCode, durationMs, ok := harnessapi.ToolOutcome(item); ok {
			block.Result, block.IsError = result, isError
			block.ExitCode, block.DurationMs = exitCode, durationMs
		}
		return block, true
	case "reminderChild":
		// Internal housekeeping, never a reply: the host's generic summary is the placeholder
		// "Reminder child session", with no user-readable content beside it (the item carries
		// only ids — child session, task, generation). Emitting it would persist that
		// placeholder into the transcript and show it in the CMS, so it is dropped outright.
		return harnessapi.TurnBlock{}, false
	case "subagent", "userShell", "workflow", "compaction":
		// A turn of a turn, and the turns beside the turn, each folded to the line the host
		// summarised it with. The child's own items are its own story; this is the parent's
		// account of having run one — a turn that delegated its work reads as what it delegated,
		// not as a single line about having delegated it. A delegation normally never reaches
		// here: completedSubagent reads the child's transcript back and files it whole, and this
		// is what it falls back to where that read has nothing to read through.
		if text := pkgProtocol.OrDefault(pkgProtocol.AsString(item["fallbackText"]),
			pkgProtocol.OrDefault(pkgProtocol.AsString(item["text"]), pkgProtocol.AsString(item["summary"]))); text != "" {
			return harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: text}, true
		}
		return harnessapi.TurnBlock{}, false
	default:
		// An unknown kind renders generically — the line the host summarised it with, or nothing.
		// The protocol's item vocabulary is open by design, and a client that failed a turn on a
		// kind it had never heard of would break on every CLI upgrade.
		if text := pkgProtocol.AsString(item["fallbackText"]); text != "" {
			return harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: text}, true
		}
		return harnessapi.TurnBlock{}, false
	}
}

// museToolArgs is a toolCall item's arguments as a value: the verbatim JSON parsed where it parses,
// and the raw string where the model emitted almost-JSON — which the protocol keeps verbatim
// precisely so a client can still show it.
func museToolArgs(item map[string]any) any {
	raw, _ := item["args"].(string)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	return parsed
}

// turnCompleted ends the turn the host has just finished. A terminal naming another turn is a
// replaced turn's straggler and ends nothing; a terminal the vocabulary has moved past fails the
// turn rather than reporting an end nobody asked for.
//
// It reports the end in three parts: whether the turn ends here, on what synthesised exit code,
// and on what terminal word — the host's own vocabulary, which the transcript files beside the
// number so no reader mistakes one for a process exit. Anything the end carries besides the word
// itself — why it failed, what the turn cost — goes out as events first, in order.
func (d *MuseDriver) turnCompleted(params map[string]any) (bool, int, string, []harnessapi.HarnessEvent) {
	state := d.host.snapshot()
	turnID, compacting := state.turnID, state.compacting
	if compacting {
		return false, 0, "", nil
	}
	if completed := pkgProtocol.AsString(params["turnId"]); completed != "" && completed != turnID {
		harnessapi.LogClaudeWS.Warn("muse dropped a turn end for another turn",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn,
			"expected", turnID, "received", completed,
			"terminal", pkgProtocol.AsString(params["terminal"]))
		d.Run.Trace.Note(fmt.Sprintf(
			"muse dropped a turn end for another turn (expected %s, received %s, terminal %s)",
			turnID, completed, pkgProtocol.AsString(params["terminal"])))
		return false, 0, "", nil
	}

	billed := d.host.completeTurn(params)
	var events []harnessapi.HarnessEvent
	if billed != nil {
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventUsage, Usage: billed})
	}
	switch terminal := pkgProtocol.AsString(params["terminal"]); terminal {
	case "completed":
		return true, 0, terminal, events
	case "cancelled":
		return true, -1, terminal, events
	case "failed":
		message := "The Muse turn failed."
		authRequired := false
		if failure, ok := params["error"].(map[string]any); ok {
			if text := pkgProtocol.AsString(failure["message"]); text != "" {
				message = text
			}
			// The schema's own word for a host with no credentials — `TurnErrorKind`, stable
			// across CLI wordings, which is why this branches on it rather than on the sentence.
			authRequired = pkgProtocol.AsString(failure["kind"]) == "authRequired"
		} else if reason := pkgProtocol.AsString(params["reason"]); reason != "" {
			message = reason
		}
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventFailure, Message: message, AuthRequired: authRequired})
		return true, 1, terminal, events
	default:
		events = append(events, harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
			Message: "The Muse turn ended as " + pkgProtocol.OrDefault(pkgProtocol.AsString(params["terminal"]), "unknown") + "."})
		return true, 1, pkgProtocol.AsString(params["terminal"]), events
	}
}

// turnUnqueued ends a turn the host reclaimed before it ran: another submission took the session,
// and per the schema no turn/started and no turn/completed is ever emitted for the reclaimed id.
// SDK turn-waits settle on this event too, and so does this one — waiting for the completion that
// never comes is a turn that never ends. A reclaim naming another turn is a replaced turn's
// straggler and ends nothing, as a terminal for one would.
func (d *MuseDriver) turnUnqueued(params map[string]any) (bool, int, *harnessapi.HarnessEvent) {
	state := d.host.snapshot()
	turnID, compacting := state.turnID, state.compacting
	if compacting {
		return false, 0, nil
	}
	if reclaimed := pkgProtocol.AsString(params["turnId"]); reclaimed != "" && reclaimed != turnID {
		harnessapi.LogClaudeWS.Warn("muse dropped a turn reclaim for another turn",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn,
			"expected", turnID, "received", reclaimed)
		d.Run.Trace.Note(fmt.Sprintf(
			"muse dropped a turn reclaim for another turn (expected %s, received %s)",
			turnID, reclaimed))
		return false, 0, nil
	}

	d.host.endTurn()
	return true, 1, &harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
		Message: "The Muse turn was reclaimed before it ran."}
}
