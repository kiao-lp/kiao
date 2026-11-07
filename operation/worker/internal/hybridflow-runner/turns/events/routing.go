package events

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
)

const ErrCodeUnknownConversation = "unknown_conversation"

const ErrCodeConversationBusy = "conversation_busy"

const ErrCodeBadFolder = "bad_folder"

const ErrCodeUnknownPermissionMode = "unknown_permission_mode"

const ErrCodeUnknownAgent = "unknown_agent"

const ErrCodeModeUnsupported = "mode_unsupported"

const ErrCodeBypassDisabled = "bypass_disabled"

const ErrCodeTooManyTurns = "too_many_turns"

const ErrCodeBadAttachment = "bad_attachment"

const ErrCodeSpawnFailed = "spawn_failed"

const ErrCodeNotPermitted = "not_permitted"

const ErrCodeNoRunningTurn = "no_running_turn"

const ErrCodeCLIError = "cli_error"

const ErrCodeNotSignedIn = "not_signed_in"

const BypassDisabledMessage = "Bypass permissions is switched off on this service. " +
	"Choose Manual or Manual Live, in which every tool call is put to you first."

// State replays (sync, not_running) go only to the requester to avoid rewriting other tabs.
func (h *Subscriptions) EmitTo(c *Client, conversationID string, frame map[string]any) {
	frame["conversationId"] = conversationID
	if err := c.SendJSON(frame); err != nil {
		agentapi.LogClaudeWS.Warn("send failed, dropping the socket",
			"socket", c.Id, "conversation", conversationID, "error", err)
		c.Close()
	}
}

// Write outside h.mu: a slow socket backpressures this fan-out and its turn, not the hub
// or other conversations.
func (h *Subscriptions) Fanout(conversationID string, frame map[string]any) {
	h.mu.Lock()
	targets := make([]*Client, 0, len(h.subs[conversationID]))
	for _, c := range h.subs[conversationID] {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	for _, c := range targets {
		if err := c.SendJSON(frame); err != nil {
			// Close unblocks the read loop to remove subscriptions; the turn survives even
			// when no subscribers remain.
			agentapi.LogClaudeWS.Warn("send failed, dropping the socket",
				"socket", c.Id, "conversation", conversationID, "error", err)
			c.Close()
		}
	}
}

// Registry updates reach all sockets so lists stay live without conversation subscriptions.
func (h *Subscriptions) BroadcastRegistry(frame map[string]any) {
	h.mu.Lock()
	targets := make([]*Client, 0, len(h.Conns))
	for _, c := range h.Conns {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	for _, c := range targets {
		if err := c.SendJSON(frame); err != nil {
			agentapi.LogClaudeWS.Warn("send failed, dropping the socket", "socket", c.Id, "error", err)
			c.Close()
		}
	}
}

func (h *Subscriptions) SubscribeLocked(c *Client, conversationID string) {
	set := h.subs[conversationID]
	if set == nil {
		set = map[string]*Client{}
		h.subs[conversationID] = set
	}
	set[c.Id] = c
	c.subs[conversationID] = struct{}{}
}

// Unsubscribing never stops the turn.
func (h *Subscriptions) Unsubscribe(c *Client, conversationID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.unsubscribeLocked(c, conversationID)
}

func (h *Subscriptions) UnsubscribeAll(c *Client) []string {
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
func (h *Subscriptions) unsubscribeLocked(c *Client, conversationID string) {
	if set := h.subs[conversationID]; set != nil {
		delete(set, c.Id)
		if len(set) == 0 {
			delete(h.subs, conversationID)
		}
	}
	delete(c.subs, conversationID)
}

func (h *Subscriptions) SubscriberCount(conversationID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs[conversationID])
}

// Refusals share one frame type; clients branch on code, while message is for display.
func ErrorFrame(conversationID, code, message string) map[string]any {
	return map[string]any{
		"type":           "error",
		"conversationId": conversationID,
		"code":           code,
		"message":        message,
	}
}

// Retained frames (permission requests, tool calls) must be cloned before emission:
// emit stamps IDs, which would race encoders reading the retained map.
func CloneFrame(frame map[string]any) map[string]any {
	copied := make(map[string]any, len(frame)+2)
	for key, value := range frame {
		copied[key] = value
	}
	return copied
}
