package muse

import (
	"encoding/json"
	"time"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
)

// museUsageReadTimeout bounds the harvest: the quota question a turn's end asks its host before it
// settles. A host that will not answer it in this long holds the turn's end up for nothing — the
// quota keeps its last figures instead.
const museUsageReadTimeout = 60 * time.Second

// harvestWait is how long the harvest waits for the host's quota answer.
func (d *MuseDriver) harvestWait() time.Duration {
	if d.UsageTimeout > 0 {
		return d.UsageTimeout
	}
	return museUsageReadTimeout
}

// harvestUsage asks the turn's host what it observed of the account and records it for the quota. A
// host that observed nothing — a turn that never reached the provider — answers `{}`, which is
// recorded as nothing rather than reported: the quota keeps its last figures, from an older turn. A
// host that cannot be asked at all is the same silence, one log line louder; either way the turn's
// own end is unaffected, which is what makes this a harvest rather than a read. The question is
// bounded: an unanswered harvest must not hold the turn's end, which is what it sits in front of.
func (d *MuseDriver) harvestUsage(conn *MspConn) {
	if d.Usage == nil || conn == nil {
		return
	}
	raw, err := conn.callTimeout("usage/read", map[string]any{}, d.harvestWait())
	if err != nil {
		harnessapi.LogClaudeWS.Debug("muse usage/read failed; the quota keeps its last figures",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn, "error", err)
		d.Run.Trace.Note("muse quota harvest failed: " + err.Error())
		return
	}
	observed, err := MuseUsageFromRead(raw)
	if err != nil {
		harnessapi.LogClaudeWS.Warn("muse usage/read could not be understood",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn, "error", err)
		return
	}
	if observed == nil {
		return
	}
	d.noteSubscription(observed)
}

// noteUsageChanged records one `usage/changed` notification: the host's account figures moved
// mid-turn, in the same payload shape `usage/read` answers with. Best effort, like the harvest —
// a notification this driver cannot understand is stepped over rather than failing anything.
func (d *MuseDriver) noteUsageChanged(raw json.RawMessage) {
	if d.Usage == nil || len(raw) == 0 {
		return
	}
	var observed MuseSubscriptionUsage
	if err := json.Unmarshal(raw, &observed); err != nil {
		harnessapi.LogClaudeWS.Warn("muse usage/changed could not be understood",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn, "error", err)
		return
	}
	d.noteSubscription(&observed)
}

// noteSubscription files one observation with the harness's quota, unless it carries nothing to
// draw — an empty payload would blank the quota's last figures with zeros.
func (d *MuseDriver) noteSubscription(observed *MuseSubscriptionUsage) {
	if observed == nil || observed.IsEmpty() {
		return
	}
	d.Usage.Note(observed.Dto(), observed.ObservedAtMs)
}
