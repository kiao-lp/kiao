package turns

import (
	"kiao/worker/internal/core/access"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

type RunObserver interface {
	RunSnapshots() []*runstate.HarnessChainRunDto
	OnTurnStopped(conversationID string)
	ResumeWithPrompt(access.Identity, string, TurnRequest, func(string)) error
	ReportTurnUsage(job *Turn) error
}
