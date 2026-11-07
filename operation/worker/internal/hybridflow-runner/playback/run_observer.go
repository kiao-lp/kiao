package playback

import (
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

func (r *ChainRunner) RunSnapshots() []*runstate.AgentChainRunDto { return r.Snapshots() }

func (r *ChainRunner) OnTurnStopped(conversationID string) { r.turnStopped(conversationID) }
