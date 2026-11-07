package turns

import (
	"kiao/worker/internal/core/access"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/conversations"
)

func (h *Engine) ExecuteTurn(id access.Identity, req TurnRequest) (*Turn, *agentfaults.TurnRefusal) {
	return h.StartTurnFor(nil, id, req)
}

func (h *Engine) RunningTurn(conversationID string) *Turn { return h.GetJob(conversationID) }

func (h *Engine) StopTurn(conversationID, requestedBy string) bool {
	return h.StopProcess(conversationID, requestedBy)
}

func (h *Engine) AgentRegistry() *agentapi.AgentRegistry { return h.Agents }

func (h *Engine) NotifyRegistry(frame map[string]any) { h.BroadcastRegistry(frame) }

func (h *Engine) ConversationEvent(meta conversations.ConversationMeta) map[string]any {
	return h.ConversationFrame(meta)
}
