package muse

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	briefing "kiao/worker/internal/hybridflow-runner/harnesses/prompt"
)

// MuseServeArgs keeps tool enforcement on the approval channel in every mode.
func MuseServeArgs() []string { return []string{"serve", "--disable-sandbox"} }

// museRun is everything one turn needs from the host: HarnessRun translated into the calls this CLI
// happens to spell it with.
type MuseRun struct {
	model, effort, permissionMode, sessionID string
	// instructions are the managed agent's standing orders, prepended to the input text with the
	// briefing. Empty is a turn with no standing orders.
	instructions string
	// thinking is the model's extended reasoning. False asks for the `none` tier rather than for
	// the conversation's effort — asking for no reasoning, which is what the switch means.
	thinking bool
	// forkSession asks for a branch off sessionID rather than a continuation of it: the first turn
	// of a forked conversation, which holds the session id of the conversation it was copied from.
	forkSession bool
	// resumeAt is where in that session the branch cuts: the MSP turn id the fork's copied history
	// ends at, carried on every block the driver emits (see HarnessEvent.MessageID). Empty is the
	// session's end, which is a fork of a conversation whole.
	resumeAt string
	// DCMSRoot is passed as the session's workspaceRoot so turns in a subdirectory can
	// work across the store in manual mode.
	DCMSRoot string
	// workDir is the turn's own folder, the host process's working directory.
	workDir string
	// mcpConfig is the `mcp_servers` fragment rendered from the ledger, with the turn's token
	// still written as ${KIAO_MCP_TURN_TOKEN}. Empty is a turn handed no servers at all — and one
	// whose host runs with the user's own configuration untouched.
	McpConfig string
	// mcpToken is what that placeholder becomes.
	McpToken string
	// allowBypass is Config.BypassEnabled, carried this far so the one place the allowAll mode is
	// selected is also the place that can refuse to select it. Every path here is gated already;
	// this is what makes a path added later fail closed.
	allowBypass bool
}

// museRunFor is the port's turn as this CLI spells it.
func museRunFor(run harnessapi.HarnessRun) MuseRun {
	return MuseRun{
		model:          run.Model,
		effort:         run.Effort,
		permissionMode: run.PermissionMode,
		instructions:   run.Instructions,
		thinking:       run.Thinking,
		sessionID:      run.SessionID,
		forkSession:    run.ForkSession,
		resumeAt:       run.ResumeAt,
		DCMSRoot:       run.DCMSRoot,
		workDir:        run.WorkDir,
		McpConfig:      run.MCPConfig,
		McpToken:       run.MCPToken,
		allowBypass:    run.AllowBypass,
	}
}

// museApprovalMode is the MSP approval mode a turn runs in: every tool call asked about, or none.
// `manualLive` is this service's word for a client behaviour and the host has never heard of it —
// the countdown is the hub's, so both manual modes select the same enforcement.
func MuseApprovalMode(permissionMode string, allowBypass bool) string {
	if runnerconfig.AsksBeforeTools(permissionMode) || !allowBypass {
		return "onRequest"
	}
	return "allowAll"
}

// museReasoningEffort is the tier a turn runs at: `none` when extended thinking is off, the
// conversation's effort when it names a tier of the protocol's closed vocabulary, and nothing
// otherwise — which runs the host's own default rather than refusing a turn over a word the
// catalogue has moved past.
func MuseReasoningEffort(thinking bool, effort string) string {
	if !thinking {
		return "none"
	}
	switch strings.TrimSpace(effort) {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra":
		return strings.TrimSpace(effort)
	default:
		return ""
	}
}

// Spawn opens the session, sets the model and the mode, and starts the turn — then hands the host
// to the relay goroutine, which is what emits every event including the first: this call only ever
// returns an error, never an event, because the stream has no reader until it has returned.
func (d *MuseDriver) Spawn(run harnessapi.HarnessRun) error {
	d.Run = run
	mrun := museRunFor(run)

	// A compaction is not a turn and starts none: it shortens the session's context instead. The
	// runner sends it between two flow nodes of a chain, and the user may type it too — either way it
	// arrives as a bare command, because the hub passes one through without the context a message
	// carries. With no session there is nothing to shorten, and the turn says so without spawning
	// a host at all.
	if strings.TrimSpace(run.Prompt) == briefing.ChainRunCompactCommand {
		return d.spawnCompact(mrun)
	}

	staging, env, err := stageMuseConfig(mrun)
	if err != nil {
		return err
	}
	d.stagingDir = staging

	conn, err := SpawnMSP(context.Background(), d.Binary, MuseServeArgs(), mrun.workDir, env, run.Trace)
	if err != nil {
		d.cleanup()
		return err
	}
	run.Trace.Exec(d.execRecord(conn.cmd, mrun))

	d.host.setConnection(conn)
	d.subagents = NewMuseSubagentReader(conn, run.Trace, d.subagentWait())

	sessionID, err := openMuseSession(conn, mrun)
	if err != nil {
		// The reader reports a nonzero exit without a session ID. The worker marks the
		// harness session as lost so the next turn opens a new one.
		conn.Close()

		d.host.setConnection(nil)
		d.subagents = nil
		d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventFailure, Message: err.Error()}}
		d.startup.finished, d.startup.code = true, 1

		go d.relay()
		return nil
	}

	if model := strings.TrimSpace(mrun.model); model != "" {
		if _, err := conn.Call("session/setModel", map[string]any{
			"commandId": MspCommandID(), "sessionId": sessionID,
			"model": map[string]any{"modelId": model},
		}); err != nil {
			conn.Close()
			d.cleanup()
			return fmt.Errorf("Muse refused the model %q: %s", model, museSentence(err))
		}
	}
	// The mode is selected on every turn rather than only at creation: a prompt may override the
	// conversation's mode, and a resumed session otherwise keeps whatever the last turn selected.
	if _, err := conn.Call("session/setApprovalMode", map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID,
		"mode": MuseApprovalMode(mrun.permissionMode, mrun.allowBypass),
	}); err != nil {
		conn.Close()
		d.cleanup()
		return fmt.Errorf("Muse refused the permission mode: %s", museSentence(err))
	}

	input := map[string]any{"type": "text",
		"text": briefing.HarnessBriefingWith(mrun.DCMSRoot, mrun.instructions) + "\n\n" + run.Prompt}
	start := map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID,
		"input": []any{input},
		// A busy session is a stale one: KIAO runs one turn per conversation, so a turn already
		// running is one whose host died without ending it. Replacing it reclaims the session
		// rather than queueing behind a turn that will never finish.
		"ifBusy": "replace",
	}
	if effort := MuseReasoningEffort(mrun.thinking, mrun.effort); effort != "" {
		start["reasoningEffort"] = effort
	}
	raw, err := conn.Call("turn/start", start)
	if err != nil {
		conn.Close()
		d.cleanup()
		return fmt.Errorf("Muse would not start the turn: %s", museSentence(err))
	}
	var started struct {
		TurnID string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.TurnID == "" {
		conn.Close()
		d.cleanup()
		return errors.New("Muse started a turn and did not say which.")
	}

	harnessapi.LogClaudeWS.Info("spawned",
		"harness", harnessapi.HarnessMuse, "conversation", run.Conversation, "turn", run.Turn,
		"work_dir", run.WorkDir, "store_root", run.DCMSRoot,
		"session", sessionID, "msp_turn", started.TurnID)

	d.host.opened(sessionID, started.TurnID, false)
	d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventSession, SessionID: sessionID}}

	// The run's own ids, as the host answered them: the trace's run record names this turn,
	// and this names the run the host executes for it — the id its own journal files the turn
	// under, and the one a post-mortem joins the two logs on.
	d.Run.Trace.Note("muse turn " + started.TurnID + " on session " + sessionID)
	go d.relay()
	return nil
}

// openMuseSession is the conversation's session on this host: started fresh, resumed, or forked off the
// session the fork was copied from. What comes back is the session id this turn runs on — the
// fork's own after a branch, which is the moment the branch exists.
func openMuseSession(conn *MspConn, run MuseRun) (string, error) {
	if run.forkSession && strings.TrimSpace(run.sessionID) != "" {
		params := map[string]any{
			"commandId": MspCommandID(), "sessionId": strings.TrimSpace(run.sessionID),
		}
		// Where the copy stops. Without it the host copies every completed turn, which is right
		// for a fork of a whole conversation and wrong for a fork from a point: the copy would
		// show half the conversation and Muse would remember all of it.
		if anchor := strings.TrimSpace(run.resumeAt); anchor != "" {
			params["cutPoint"] = map[string]any{"lastTurnId": anchor}
		}
		raw, err := conn.Call("session/fork", params)
		if err != nil {
			// The muse command has no file birth time on this harness.
			if strings.Contains(err.Error(), "file birth time is unavailable") {
				return "", errors.New("The Muse session could not be branched. " +
					"This is a bug in the muse command: session/fork cannot get a file birth time here.")
			}
			return "", fmt.Errorf("The Muse session could not be branched: %s", museSentence(err))
		}
		var forked struct {
			Session struct {
				SessionID string `json:"sessionId"`
			} `json:"session"`
		}
		if err := json.Unmarshal(raw, &forked); err != nil || forked.Session.SessionID == "" {
			return "", errors.New("Muse branched the session and did not name the branch.")
		}
		return forked.Session.SessionID, nil
	}
	if session := strings.TrimSpace(run.sessionID); session != "" {
		raw, err := conn.Call("session/resume", map[string]any{
			"commandId": MspCommandID(), "sessionId": session,
			// The history stays server-side: the transcript is the hub's own, read from its
			// store, and paging the session's would be a second account of the same turns.
			"excludeItems": true,
		})
		if err != nil {
			return "", fmt.Errorf("The Muse session could not be resumed: %s", museSentence(err))
		}
		var resumed struct {
			Session struct {
				SessionID string `json:"sessionId"`
			} `json:"session"`
		}
		if err := json.Unmarshal(raw, &resumed); err != nil || resumed.Session.SessionID == "" {
			return "", errors.New("Muse resumed the session and did not name it.")
		}
		return resumed.Session.SessionID, nil
	}
	workspace := strings.TrimSpace(run.DCMSRoot)
	if workspace == "" {
		workspace = run.workDir
	}
	raw, err := conn.Call("session/start", map[string]any{
		"commandId": MspCommandID(), "workspaceRoot": workspace,
		"approvalMode": MuseApprovalMode(run.permissionMode, run.allowBypass),
	})
	if err != nil {
		return "", fmt.Errorf("Muse would not start a session: %s", museSentence(err))
	}
	var started struct {
		Session struct {
			SessionID string `json:"sessionId"`
		} `json:"session"`
	}
	if err := json.Unmarshal(raw, &started); err != nil || started.Session.SessionID == "" {
		return "", errors.New("Muse started a session and did not name it.")
	}
	return started.Session.SessionID, nil
}

// spawnCompact shortens the session's context instead of starting a turn. The compaction runs
// asynchronously; the reader ends on the compaction item landing, or on a wait no turn should
// outlast — whichever comes first.
func (d *MuseDriver) spawnCompact(run MuseRun) error {
	if strings.TrimSpace(run.sessionID) == "" {
		d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventBlock,
			Block: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "Nothing to compact yet."}}}
		d.startup.finished, d.startup.code = true, 0
		go d.relay()
		return nil
	}
	conn, err := SpawnMSP(context.Background(), d.Binary, MuseServeArgs(), run.workDir, nil, d.Run.Trace)
	if err != nil {
		return err
	}
	d.Run.Trace.Exec(d.execRecord(conn.cmd, run))

	d.host.setConnection(conn)

	// The session has to be loaded on this host before it can be compacted: one host per
	// turn means no session is loaded yet, and compacting an id no host holds is refused.
	sessionID, err := openMuseSession(conn, MuseRun{sessionID: run.sessionID})
	if err != nil {
		conn.Close()

		d.host.setConnection(nil)
		d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventFailure, Message: err.Error()}}
		d.startup.finished, d.startup.code = true, 1

		go d.relay()
		return nil
	}
	raw, err := conn.Call("session/compact", map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID,
	})
	if err != nil {
		conn.Close()
		d.cleanup()
		return fmt.Errorf("Muse would not compact the session: %s", museSentence(err))
	}
	var admitted struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(raw, &admitted); err != nil {
		conn.Close()
		d.cleanup()
		return errors.New("Muse answered the compaction with something unreadable.")
	}
	if admitted.Status == "noop" {
		conn.Close()

		d.host.setConnection(nil)
		d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventBlock,
			Block: harnessapi.TurnBlock{Kind: harnessapi.BlockKindText, Text: "Nothing to compact."}}}
		d.startup.finished, d.startup.code = true, 0

		go d.relay()
		return nil
	}

	d.host.opened(sessionID, "", true)
	d.startup.events = []harnessapi.HarnessEvent{{Kind: harnessapi.EventSession, SessionID: sessionID}}

	go d.relay()
	return nil
}

// museSentence is what a turn that never ran is refused with: the host's own message, or the
// error's. It is shown to the user as it stands, so it names Muse rather than a code.
func museSentence(err error) string {
	var rpcErr *mspError
	if errors.As(err, &rpcErr) && strings.TrimSpace(rpcErr.Message) != "" {
		return rpcErr.Message
	}
	return err.Error()
}
