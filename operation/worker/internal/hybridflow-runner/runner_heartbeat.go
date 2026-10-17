package hybridflowrunner

import (
	"time"

	"kiao/worker/internal/core"
)

const runnerHeartbeatEvery = 15 * time.Second

// startRunnerHeartbeat returns nil without a store or runner ID; otherwise its stop function
// waits for the heartbeat goroutine to exit. Failures only warn and do not interrupt turns.
// Read the ID on every beat: saving runner.json can change it without a restart.
func startRunnerHeartbeat(cfg *Config, upstream *hybridflowStore) func() {
	if cfg == nil || upstream == nil || cfg.HybridflowURL == "" || cfg.currentRunnerID() == "" {
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
	core.LogMain.Info("runner heartbeat started",
		"runner", cfg.currentRunnerID(), "every", runnerHeartbeatEvery.String())
	return func() {
		close(done)
		<-stopped
	}
}

func beat(cfg *Config, upstream *hybridflowStore) {
	if err := upstream.Heartbeat(cfg.currentRunnerID()); err != nil {
		core.LogMain.Warn("runner heartbeat failed", "runner", cfg.currentRunnerID(), "error", err)
	}
}
