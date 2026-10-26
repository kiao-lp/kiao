package turns

import (
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

type RunObserver interface {
	RunSnapshots() []*runstate.AgentChainRunDto
	OnTurnStopped(conversationID string)
}
