package turns

import (
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
)

func (h *Engine) ExecuteTurn(id access.Identity, req TurnRequest) (*Turn, *harnessfaults.TurnRefusal) {
	return h.StartTurnFor(nil, id, req)
}

func (h *Engine) RunningTurn(conversationID string) *Turn { return h.GetJob(conversationID) }

func (h *Engine) StopTurn(conversationID, requestedBy string) bool {
	return h.StopProcess(conversationID, requestedBy)
}

func (h *Engine) HarnessRegistry() *harnessapi.HarnessRegistry { return h.Harnesses }

func (h *Engine) NotifyRegistry(frame map[string]any) { h.BroadcastRegistry(frame) }

func (h *Engine) ConversationEvent(meta conversations.ConversationMeta) map[string]any {
	return h.ConversationFrame(meta)
}
