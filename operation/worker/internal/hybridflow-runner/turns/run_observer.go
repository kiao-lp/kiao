package turns

import (
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

type RunObserver interface {
	RunSnapshots() []*runstate.HarnessChainRunDto
	OnTurnStopped(conversationID string)
	ReportTurnUsage(job *Turn)
}
