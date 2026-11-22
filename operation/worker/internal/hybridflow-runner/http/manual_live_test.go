package runnerhttp

import (
	"encoding/json"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func readManualLiveDoc(t *testing.T, statePath string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(statePath, pkgTurns.ConversationsDocName))
	if err != nil {
		t.Fatalf("reading %s: %v", pkgTurns.ConversationsDocName, err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parsing %s: %v", pkgTurns.ConversationsDocName, err)
	}
	return doc
}

func TestManualLiveDelaySeedsTheDefaultWhenTheFileIsMissing(t *testing.T) {
	dir := t.TempDir()

	if got := pkgTurns.ResolveManualLiveCountdownSeconds(dir); got != 10 {
		t.Fatalf("seconds = %d, want the 10 the countdown has always used", got)
	}
	if doc := readManualLiveDoc(t, dir); doc[pkgTurns.ManualLiveCountdownKey] != 10.0 {
		t.Fatalf("file = %v, want the default written for the next start", doc)
	}
}

func TestManualLiveDelayAddsTheDefaultBesideExistingKeys(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, pkgTurns.ConversationsDocName), "{\"other\": true}\n")

	if got := pkgTurns.ResolveManualLiveCountdownSeconds(dir); got != 10 {
		t.Fatalf("seconds = %d, want the default where the key is missing", got)
	}
	doc := readManualLiveDoc(t, dir)
	if doc[pkgTurns.ManualLiveCountdownKey] != 10.0 || doc["other"] != true {
		t.Fatalf("file = %v, want the default added without touching the rest", doc)
	}
}

func TestManualLiveDelayHonoursAConfiguredValue(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, pkgTurns.ConversationsDocName), "{\"manualLiveCountdownSeconds\": 25}\n")

	if got := pkgTurns.ResolveManualLiveCountdownSeconds(dir); got != 25 {
		t.Fatalf("seconds = %d, want the configured 25", got)
	}
	if doc := readManualLiveDoc(t, dir); doc[pkgTurns.ManualLiveCountdownKey] != 25.0 {
		t.Fatalf("file = %v, want a valid value left alone", doc)
	}
}

func TestManualLiveDelayFallsBackOnBadValues(t *testing.T) {
	for _, body := range []string{
		"{\"manualLiveCountdownSeconds\": 0}\n",
		"{\"manualLiveCountdownSeconds\": -5}\n",
		"{\"manualLiveCountdownSeconds\": \"soon\"}\n",
		"{\"manualLiveCountdownSeconds\": null}\n",
		"not json\n",
	} {
		dir := t.TempDir()
		mustWrite(t, filepath.Join(dir, pkgTurns.ConversationsDocName), body)

		if got := pkgTurns.ResolveManualLiveCountdownSeconds(dir); got != 10 {
			t.Fatalf("seconds = %d for %q, want the default", got, body)
		}
	}
}

func TestNewClaudeHubUsesTheConfiguredDelay(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, pkgTurns.ConversationsDocName), "{\"manualLiveCountdownSeconds\": 7}\n")

	h := assembly.NewEngine(&runnerconfig.Config{Config: &coreconfig.Config{StatePath: dir}}, nil)
	defer h.Shutdown()
	if h.AutoAllowDelay != 7*time.Second {
		t.Fatalf("autoAllowDelay = %v, want the configured 7s", h.AutoAllowDelay)
	}
}

func TestNewClaudeHubWithoutStateKeepsTheDefault(t *testing.T) {
	h := assembly.NewEngine(&runnerconfig.Config{}, nil)
	defer h.Shutdown()
	if h.AutoAllowDelay != pkgTurns.ClaudeAutoAllowDelay {
		t.Fatalf("autoAllowDelay = %v, want the built-in default", h.AutoAllowDelay)
	}
}
