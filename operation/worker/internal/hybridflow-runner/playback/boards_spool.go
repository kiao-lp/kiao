package playback

import (
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
)

// closeBoards stops the board store's background work, if it has any. Only the spooling store
// has any — its sender loop — and a runner with no store has nothing to stop.
func (r *ChainRunner) CloseBoards() {
	if r == nil {
		return
	}
	if closer, ok := r.Boards.(interface{ Close() error }); ok {
		if err := closer.Close(); err != nil {
			pkgBoards.LogChainRun.Warn("cannot stop the board store", "error", err)
		}
	}
}
