package fileshttp

import (
	"encoding/json"
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	fileconfig "kiao/worker/internal/files/configuration"
	"net/http"
	"os"
	"path/filepath"
	"slices"
)

func (s *Service) configDocPath(name string) (string, error) {
	if !slices.Contains(fileconfig.ConfigDocNames, name) {
		return "", &httpkit.HTTPError{Status: http.StatusNotFound, Msg: fmt.Sprintf("unknown configuration document: %s", name)}
	}
	return filepath.Join(s.cfg.StatePath, name), nil
}

// HandleGetConfigDoc serves GET /config/{name}. Missing documents return 404,
// which clients interpret as first run and seed with defaults.
func (s *Service) HandleGetConfigDoc(w http.ResponseWriter, r *http.Request) {
	path, err := s.configDocPath(r.PathValue("name"))
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		httpkit.WriteError(w, r, err)
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
		httpkit.WriteError(w, r, err)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, fileconfig.MaxConfigDocBytes))
	if err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: fmt.Sprintf("the configuration document could not be read (limit %d bytes)", fileconfig.MaxConfigDocBytes)})
		return
	}
	if !json.Valid(data) {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "the configuration document is not valid JSON"})
		return
	}
	if err := filesystem.WriteFileAtomic(path, data, fileconfig.ConfigDocPerm); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	// Run listeners synchronously before 204: a client may reload or start a turn
	// as soon as save succeeds, so plugin skills must already be installed.
	// View-state saves need no listener.
	if name == fileconfig.ConfigDocDashboard && s.configSaved != nil {
		s.configSaved()
	}
	if name == fileconfig.ConfigDocRunner && s.runnerSaved != nil {
		s.runnerSaved()
	}
	w.WriteHeader(http.StatusNoContent)
}
