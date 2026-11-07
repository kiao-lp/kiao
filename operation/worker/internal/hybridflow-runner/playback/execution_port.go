package playback

import (
	"kiao/worker/internal/core/access"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/conversations"
	"kiao/worker/internal/hybridflow-runner/turns"
)

type TurnExecutor interface {
	ExecuteTurn(access.Identity, turns.TurnRequest) (*turns.Turn, *agentfaults.TurnRefusal)
	RunningTurn(conversationID string) *turns.Turn
	StopTurn(conversationID, requestedBy string) bool
	AgentRegistry() *agentapi.AgentRegistry
	NotifyRegistry(map[string]any)
	ConversationEvent(conversations.ConversationMeta) map[string]any
}
