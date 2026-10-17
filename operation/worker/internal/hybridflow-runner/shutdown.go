package hybridflowrunner

import (
	"errors"
	"fmt"
	"kiao/worker/internal/core"
	"strings"
	"time"
)

// Shutdown cards remain portable: an unconfigured deployment marks them as errors
// rather than removing them from the board. chain_run.go decides when to shut down.

// Bounds the shutdown request, not the time until the machine powers off.
const shutdownTimeout = 30 * time.Second

// machinePowerOff returns nil when shutdown is unconfigured. The command is split on
// whitespace and executed without a shell; quoting and expansion are unsupported.
func machinePowerOff(cfg *Config) func() error {
	command := strings.Fields(cfg.ShutdownCommand)
	if len(command) == 0 {
		return nil
	}
	return func() error {
		result := core.RunProc(command, cfg.RootPath, shutdownTimeout, nil)
		if result.OK() {
			return nil
		}
		if said := result.Combined(); said != "" {
			return errors.New(said)
		}
		return fmt.Errorf("%s ended %d and said nothing", command[0], result.Exit)
	}
}
