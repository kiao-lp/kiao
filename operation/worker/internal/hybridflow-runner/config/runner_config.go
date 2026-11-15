package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const runnerDocName = "runner.json"

type runnerDoc struct {
	RunnerID string `json:"runnerId"`
}

func (c *Config) CurrentRunnerID() string {
	if c == nil {
		return ""
	}
	c.runnerMu.RLock()
	defer c.runnerMu.RUnlock()
	return strings.TrimSpace(c.RunnerID)
}

// Restart the heartbeat after adopting an ID; affinity checks see it on the next Play.
func (c *Config) AdoptRunnerID(id string) {
	c.runnerMu.Lock()
	defer c.runnerMu.Unlock()
	c.RunnerID = strings.TrimSpace(id)
}

// RunnerIDFromState returns "" for a missing document. Unreadable or malformed
// documents must fail startup rather than play under a missing or wrong identity.
func RunnerIDFromState(statePath string) (string, error) {
	data, err := os.ReadFile(filepath.Join(statePath, runnerDocName))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("the runner this root names could not be read: %w", err)
	}
	var doc runnerDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		return "", fmt.Errorf("the runner this root names could not be read: %w", err)
	}
	return strings.TrimSpace(doc.RunnerID), nil
}
