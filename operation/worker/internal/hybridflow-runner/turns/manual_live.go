package turns

import (
	"encoding/json"
	"kiao/worker/internal/core/filesystem"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"path/filepath"
	"time"
)

// Live countdown tuning, kept in the state directory so it moves with the store.
const ConversationsDocName = "conversations.json"

const ManualLiveCountdownKey = "manualLiveCountdownSeconds"

// Seeded when the file or the key is missing.
const defaultManualLiveCountdownSeconds = 10

// Longer than a day is not a countdown; shorter than a second is not one either.
const maxManualLiveCountdownSeconds = 24 * 60 * 60

func manualLiveDelay(cfg *runnerconfig.Config) time.Duration {
	if cfg == nil || cfg.Config == nil || cfg.StatePath == "" {
		return ClaudeAutoAllowDelay
	}
	return time.Duration(ResolveManualLiveCountdownSeconds(cfg.StatePath)) * time.Second
}

func ResolveManualLiveCountdownSeconds(statePath string) int {
	path := filepath.Join(statePath, ConversationsDocName)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		writeManualLiveDoc(path, map[string]any{ManualLiveCountdownKey: defaultManualLiveCountdownSeconds})
		return defaultManualLiveCountdownSeconds
	}
	if err != nil {
		agentapi.LogClaudeWS.Warn("live countdown unreadable; using the default", "path", path, "error", err)
		return defaultManualLiveCountdownSeconds
	}
	var doc map[string]any
	if json.Unmarshal(data, &doc) != nil || doc == nil {
		agentapi.LogClaudeWS.Warn("live countdown unparseable; using the default", "path", path)
		return defaultManualLiveCountdownSeconds
	}
	if seconds, ok := manualLiveSeconds(doc[ManualLiveCountdownKey]); ok {
		return seconds
	}
	doc[ManualLiveCountdownKey] = defaultManualLiveCountdownSeconds
	writeManualLiveDoc(path, doc)
	return defaultManualLiveCountdownSeconds
}

func manualLiveSeconds(value any) (int, bool) {
	seconds, ok := value.(float64)
	if !ok || seconds < 1 || seconds > maxManualLiveCountdownSeconds {
		return 0, false
	}
	return int(seconds), true
}

func writeManualLiveDoc(path string, doc map[string]any) {
	body, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return
	}
	if err := filesystem.WriteFileAtomic(path, append(body, '\n'), 0o600); err != nil {
		agentapi.LogClaudeWS.Warn("live countdown not saved; using the default", "path", path, "error", err)
	}
}
