package muse

import (
	"errors"
	"fmt"
	"time"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

// MuseDriver runs one host per turn. Configuration is fixed before Spawn;
// Spawn publishes the host and startup events before handing control to relay.
// Only host and asks are shared with concurrent Answer, Say and Stop calls.
type MuseDriver struct {
	Cfg         *runnerconfig.Config
	Binary      string
	Run         harnessapi.HarnessRun
	Usage       *MuseUsageService
	EventStream chan harnessapi.HarnessEvent

	IdleTimeout     time.Duration
	UsageTimeout    time.Duration
	NoticeTimeout   time.Duration
	ResyncTimeout   time.Duration
	DrainTimeout    time.Duration
	subagentTimeout time.Duration

	host museHost
	asks museAsks

	// Owned by Spawn until relay starts, then by the relay alone.
	startup    museStartup
	stagingDir string
	subagents  harnessapi.SubagentReader
	activity   museActivity
	recovery   museRecovery
	background museBackground
}

type museStartup struct {
	events   []harnessapi.HarnessEvent
	finished bool
	code     int
}

var _ harnessapi.HarnessDriver = (*MuseDriver)(nil)

func (d *MuseDriver) Events() <-chan harnessapi.HarnessEvent { return d.EventStream }

// Answer sends a prepared approval decision or question response. The hub has
// already removed its pending card; a call failure is reported without retry.
func (d *MuseDriver) Answer(askID string, decision harnessapi.AskDecision) error {
	if !d.asks.contains(askID) {
		return errors.New("Muse is waiting for nothing by that name")
	}
	state := d.host.snapshot()
	conn, sessionID := state.conn, state.sessionID
	if conn == nil || sessionID == "" {
		return errors.New("The Muse turn has ended, so there is nothing to answer")
	}
	answer, err := d.asks.prepare(askID, decision)
	if err != nil {
		return err
	}
	answer.params["sessionId"] = sessionID
	if _, err := conn.Call(answer.method, answer.params); err != nil {
		return fmt.Errorf("Muse would not take the %s: %s", answer.failure, museSentence(err))
	}
	return nil
}

// Say steers the running native turn at its next tool boundary. A finished turn
// returns an error so the hub can restore the message to the input box.
func (d *MuseDriver) Say(text string) error {
	state := d.host.snapshot()
	conn, sessionID, turnID := state.conn, state.sessionID, state.turnID
	if conn == nil || sessionID == "" || turnID == "" {
		return errors.New("The Muse turn has ended, so there is nothing to speak to")
	}
	_, err := conn.Call("turn/steer", map[string]any{
		"commandId": MspCommandID(), "sessionId": sessionID, "expectedTurnId": turnID,
		"input": []any{map[string]any{"type": "text", "text": text}},
	})
	if err != nil {
		return fmt.Errorf("Muse would not take the message: %s", museSentence(err))
	}
	return nil
}

// Stop latches once, cancels the native turn and closes the host. The relay
// retains responsibility for the final event and stream cleanup.
func (d *MuseDriver) Stop() {
	state, first := d.host.stop()
	if !first {
		return
	}
	conn, sessionID, turnID := state.conn, state.sessionID, state.turnID
	if conn != nil && sessionID != "" {
		params := map[string]any{"commandId": MspCommandID(), "sessionId": sessionID}
		if turnID != "" {
			params["turnId"] = turnID
		}
		// Best effort: the host may already be gone, and killing it below ends the turn either
		// way. Waiting for the answer here would park Stop on a host that is itself parking on
		// an approval nobody will ever decide.
		go func() { _, _ = conn.Call("turn/cancel", params) }()
	}
	if conn != nil {
		harnessapi.LogClaudeWS.Info("process killed",
			"harness", harnessapi.HarnessMuse, "conversation", d.Run.Conversation, "turn", d.Run.Turn)
		conn.Close()
	}
}
