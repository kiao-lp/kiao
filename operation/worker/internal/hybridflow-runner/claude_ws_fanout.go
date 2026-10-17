package hybridflowrunner

// Routing: socket-scoped frames (hello, no conversationId) reach one socket; registry-scoped
// frames (conversationId, no turnId) reach all sockets; conversation-scoped frames
// (conversationId, usually turnId) reach subscribers.
// Subscriptions belong to the hub, not jobs: they must survive turn boundaries and idle periods.

// Wire values must match ClaudeErrorCode in reference/npm/kiao-worker/src/agent-types.ts.
const (
	errCodeUnknownConversation   = "unknown_conversation"
	errCodeConversationBusy      = "conversation_busy"
	errCodeBadFolder             = "bad_folder"
	errCodeUnknownPermissionMode = "unknown_permission_mode"
	errCodeUnknownAgent          = "unknown_agent"
	errCodeModeUnsupported       = "mode_unsupported"
	errCodeBypassDisabled        = "bypass_disabled"
	errCodeTooManyTurns          = "too_many_turns"
	errCodeBadAttachment         = "bad_attachment"
	errCodeSpawnFailed           = "spawn_failed"
	errCodeNotPermitted          = "not_permitted"
	errCodeNoRunningTurn         = "no_running_turn"
	errCodeCLIError              = "cli_error"
	errCodeNotSignedIn           = "not_signed_in"
)

const bypassDisabledMessage = "Bypass permissions is switched off on this service. " +
	"Choose Manual or Manual Live, in which every tool call is put to you first."

// emit holds emitMu across the superseded check and fan-out so draining output cannot
// arrive after stopped. See emitFinal.
func (h *ClaudeHub) emit(job *claudeJob, frame map[string]any) {
	job.emitMu.Lock()
	defer job.emitMu.Unlock()

	// Lock order is h.mu → job.mu; release job.mu before fan-out takes h.mu.
	job.mu.Lock()
	superseded := job.superseded
	job.mu.Unlock()
	if superseded {
		return
	}
	h.emitFor(job.conversationID, job.turnID, frame)
}

// emitFinal bypasses the superseded gate for stopped. Holding emitMu ensures earlier
// emissions finish first; subsequent emit calls see superseded and drop their frames.
func (h *ClaudeHub) emitFinal(job *claudeJob, frame map[string]any) {
	job.emitMu.Lock()
	defer job.emitMu.Unlock()
	h.emitFor(job.conversationID, job.turnID, frame)
}

// emitFor bypasses the job's superseded gate for stopped and pre-spawn refusals.
func (h *ClaudeHub) emitFor(conversationID, turnID string, frame map[string]any) {
	frame["conversationId"] = conversationID
	if turnID != "" {
		frame["turnId"] = turnID
	}
	h.fanout(conversationID, frame)
}

// State replays (sync, not_running) go only to the requester to avoid rewriting other tabs.
func (h *ClaudeHub) emitTo(c *wsConn, conversationID string, frame map[string]any) {
	frame["conversationId"] = conversationID
	if err := c.sendJSON(frame); err != nil {
		logClaudeWS.Warn("send failed, dropping the socket",
			"socket", c.id, "conversation", conversationID, "error", err)
		c.close()
	}
}

// Write outside h.mu: a slow socket backpressures this fan-out and its turn, not the hub
// or other conversations.
func (h *ClaudeHub) fanout(conversationID string, frame map[string]any) {
	h.mu.Lock()
	targets := make([]*wsConn, 0, len(h.subs[conversationID]))
	for _, c := range h.subs[conversationID] {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	for _, c := range targets {
		if err := c.sendJSON(frame); err != nil {
			// Close unblocks the read loop to remove subscriptions; the turn survives even
			// when no subscribers remain.
			logClaudeWS.Warn("send failed, dropping the socket",
				"socket", c.id, "conversation", conversationID, "error", err)
			c.close()
		}
	}
}

// Registry updates reach all sockets so lists stay live without conversation subscriptions.
func (h *ClaudeHub) broadcastRegistry(frame map[string]any) {
	h.mu.Lock()
	targets := make([]*wsConn, 0, len(h.conns))
	for _, c := range h.conns {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	for _, c := range targets {
		if err := c.sendJSON(frame); err != nil {
			logClaudeWS.Warn("send failed, dropping the socket", "socket", c.id, "error", err)
			c.close()
		}
	}
}

// subscribe is idempotent; re-subscribing requests a resync, even without a running turn.
func (h *ClaudeHub) subscribe(c *wsConn, conversationID string) *claudeJob {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.subs[conversationID]
	if set == nil {
		set = map[string]*wsConn{}
		h.subs[conversationID] = set
	}
	set[c.id] = c
	c.subs[conversationID] = struct{}{}
	return h.jobs[conversationID]
}

// Unsubscribing never stops the turn.
func (h *ClaudeHub) unsubscribe(c *wsConn, conversationID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.unsubscribeLocked(c, conversationID)
}

func (h *ClaudeHub) unsubscribeAll(c *wsConn) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	dropped := make([]string, 0, len(c.subs))
	for conversationID := range c.subs {
		dropped = append(dropped, conversationID)
	}
	for _, conversationID := range dropped {
		h.unsubscribeLocked(c, conversationID)
	}
	return dropped
}

// unsubscribeLocked requires h.mu. Delete empty sets to avoid retaining every visited conversation.
func (h *ClaudeHub) unsubscribeLocked(c *wsConn, conversationID string) {
	if set := h.subs[conversationID]; set != nil {
		delete(set, c.id)
		if len(set) == 0 {
			delete(h.subs, conversationID)
		}
	}
	delete(c.subs, conversationID)
}

func (h *ClaudeHub) subscriberCount(conversationID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs[conversationID])
}

// Refusals share one frame type; clients branch on code, while message is for display.
func errorFrame(conversationID, code, message string) map[string]any {
	return map[string]any{
		"type":           "error",
		"conversationId": conversationID,
		"code":           code,
		"message":        message,
	}
}

// Retained frames (permission requests, tool calls) must be cloned before emission:
// emit stamps IDs, which would race encoders reading the retained map.
func cloneFrame(frame map[string]any) map[string]any {
	copied := make(map[string]any, len(frame)+2)
	for key, value := range frame {
		copied[key] = value
	}
	return copied
}
