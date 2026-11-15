package playback

import (
	"errors"
	"fmt"
	"kiao/worker/internal/core/process"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"strings"
	"time"
)

// Bounds the shutdown request, not the time until the machine powers off.
const shutdownTimeout = 30 * time.Second

// machinePowerOff returns nil when shutdown is unconfigured. The command is split on
// whitespace and executed without a shell; quoting and expansion are unsupported.
func MachinePowerOff(cfg *runnerconfig.Config) func() error {
	command := strings.Fields(cfg.ShutdownCommand)
	if len(command) == 0 {
		return nil
	}
	return func() error {
		result := process.RunProc(command, cfg.RootPath, shutdownTimeout, nil)
		if result.OK() {
			return nil
		}
		if said := result.Combined(); said != "" {
			return errors.New(said)
		}
		return fmt.Errorf("%s ended %d and said nothing", command[0], result.Exit)
	}
}
