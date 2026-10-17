package files

import (
	"encoding/json"
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"net/http"
	"os"
	"path/filepath"
	"slices"
)

// Dashboard configuration lives in the state directory outside the content root,
// so it needs dedicated endpoints for whole-document reads and writes.

const (
	// The program adopts these two legacy documents from the data root.
	ConfigDocDashboard = "dashboard.json"
	ConfigDocViewState = "dashboard-view-state.json"
	// Separate narrow-screen state prevents phone and desktop layouts overwriting each other.
	ConfigDocViewStateSmall = "dashboard-view-state-small.json"

	// ConfigDocRunner stores {"runnerId": "…"}, set by the runners panel and read by
	// hybridflow-runner at startup and on every save.
	ConfigDocRunner = "runner.json"

	// Owner-only: view state contains paths of files the user has worked on.
	configDocPerm = 0o600

	// Bound view state, which grows with opened files and is only pruned by the user.
	maxConfigDocBytes = 1 << 20
)

// Use an explicit allowlist: the state directory also holds the migration ledger
// and other service files that this endpoint must not expose or overwrite.
var configDocNames = []string{ConfigDocDashboard, ConfigDocViewState, ConfigDocViewStateSmall, ConfigDocRunner}

func (s *Service) configDocPath(name string) (string, error) {
	if !slices.Contains(configDocNames, name) {
		return "", &core.HTTPError{Status: http.StatusNotFound, Msg: fmt.Sprintf("unknown configuration document: %s", name)}
	}
	return filepath.Join(s.cfg.StatePath, name), nil
}

// HandleGetConfigDoc serves GET /config/{name}. Missing documents return 404,
// which clients interpret as first run and seed with defaults.
func (s *Service) HandleGetConfigDoc(w http.ResponseWriter, r *http.Request) {
	path, err := s.configDocPath(r.PathValue("name"))
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

// HandlePutConfigDoc serves PUT /config/{name}, replacing the whole document.
// Validate JSON syntax to avoid saving corrupt uploads that cause clients to reseed
// and lose state; schema validation belongs to the client and its plugins.
func (s *Service) HandlePutConfigDoc(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	path, err := s.configDocPath(name)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxConfigDocBytes))
	if err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: fmt.Sprintf("the configuration document could not be read (limit %d bytes)", maxConfigDocBytes)})
		return
	}
	if !json.Valid(data) {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "the configuration document is not valid JSON"})
		return
	}
	if err := core.WriteFileAtomic(path, data, configDocPerm); err != nil {
		core.WriteError(w, r, err)
		return
	}
	// Run listeners synchronously before 204: a client may reload or start a turn
	// as soon as save succeeds, so plugin skills must already be installed.
	// View-state saves need no listener.
	if name == ConfigDocDashboard && s.configSaved != nil {
		s.configSaved()
	}
	if name == ConfigDocRunner && s.runnerSaved != nil {
		s.runnerSaved()
	}
	w.WriteHeader(http.StatusNoContent)
}
