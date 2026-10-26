package assembly

import (
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/conversations"
	"kiao/worker/internal/hybridflow-runner/turns"
)

func NewEngine(cfg *runnerconfig.Config, store *conversations.ConversationStore) *turns.Engine {
	return turns.NewEngine(cfg, store, NewAgentRegistry(cfg))
}
