package playback

import (
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/hybridflow-runner/conversations"
	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	"kiao/worker/internal/hybridflow-runner/turns"
)

type TurnExecutor interface {
	ExecuteTurn(access.Identity, turns.TurnRequest) (*turns.Turn, *harnessfaults.TurnRefusal)
	RunningTurn(conversationID string) *turns.Turn
	StopTurn(conversationID, requestedBy string) bool
	HarnessRegistry() *harnessapi.HarnessRegistry
	NotifyRegistry(map[string]any)
	ConversationEvent(conversations.ConversationMeta) map[string]any
}
