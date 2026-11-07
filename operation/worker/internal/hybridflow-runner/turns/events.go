package turns

import (
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
)

// emit holds emitMu across the superseded check and fan-out so draining output cannot
// arrive after stopped. See emitFinal.
func (h *Engine) Emit(job *Turn, frame map[string]any) {
	job.emitMu.Lock()
	defer job.emitMu.Unlock()

	// Lock order is h.mu → job.mu; release job.mu before fan-out takes h.mu.
	job.Mu.Lock()
	superseded := job.Superseded
	job.Mu.Unlock()
	if superseded {
		return
	}
	h.EmitFor(job.ConversationID, job.TurnID, frame)
}

// emitFinal bypasses the superseded gate for stopped. Holding emitMu ensures earlier
// emissions finish first; subsequent emit calls see superseded and drop their frames.
func (h *Engine) emitFinal(job *Turn, frame map[string]any) {
	job.emitMu.Lock()
	defer job.emitMu.Unlock()
	h.EmitFor(job.ConversationID, job.TurnID, frame)
}

// emitFor bypasses the job's superseded gate for stopped and pre-spawn refusals.
func (h *Engine) EmitFor(conversationID, turnID string, frame map[string]any) {
	frame["conversationId"] = conversationID
	if turnID != "" {
		frame["turnId"] = turnID
	}
	h.Fanout(conversationID, frame)
}

// subscribe is idempotent; re-subscribing requests a resync, even without a running turn.
func (h *Engine) subscribe(c *turnevents.Client, conversationID string) *Turn {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	h.Subscriptions.SubscribeLocked(c, conversationID)
	return h.Jobs[conversationID]
}
