package boards

import (
	"kiao/worker/internal/core/logging"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"time"
)

const runnerHeartbeatEvery = 15 * time.Second

// startRunnerHeartbeat returns nil without a store or runner ID; otherwise its stop function
// waits for the heartbeat goroutine to exit. Failures only warn and do not interrupt turns.
// Read the ID on every beat: saving runner.json can change it without a restart.
func StartRunnerHeartbeat(cfg *runnerconfig.Config, upstream *HybridflowStore) func() {
	if cfg == nil || upstream == nil || cfg.HybridflowURL == "" || cfg.CurrentRunnerID() == "" {
		return nil
	}
	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		beat(cfg, upstream)
		ticker := time.NewTicker(runnerHeartbeatEvery)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				beat(cfg, upstream)
			}
		}
	}()
	logging.LogMain.Info("runner heartbeat started",
		"runner", cfg.CurrentRunnerID(), "every", runnerHeartbeatEvery.String())
	return func() {
		close(done)
		<-stopped
	}
}

func beat(cfg *runnerconfig.Config, upstream *HybridflowStore) {
	if err := upstream.Heartbeat(cfg.CurrentRunnerID()); err != nil {
		logging.LogMain.Warn("runner heartbeat failed", "runner", cfg.CurrentRunnerID(), "error", err)
	}
}
