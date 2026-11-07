package pi

import (
	"kiao/worker/internal/core/filesystem"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"os"
	"path/filepath"
	"strings"
)

func (s *PiProfiles) secrets() ([]agentapi.PiSecretOffer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	doc, err := s.read()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(s.cfg.StatePath, "agent-secrets"))
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	out := []agentapi.PiSecretOffer{}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !PiIdentifier.MatchString(entry.Name()) {
			continue
		}
		ref := "private:" + entry.Name()
		value, configured := s.secret(ref)
		if !configured {
			continue
		}
		offer := agentapi.PiSecretOffer{ID: entry.Name(), Reference: ref, Preview: "••••••••", UsedBy: []agentapi.PiSecretUse{}}
		if len(value) > 8 {
			offer.Preview += value[len(value)-4:]
		}
		for _, profile := range doc.Profiles {
			for _, connection := range profile.Connections {
				if connection.SecretRef == ref {
					offer.UsedBy = append(offer.UsedBy, agentapi.PiSecretUse{ProfileID: profile.ID, ProfileName: profile.Name, Provider: connection.Provider})
				}
			}
		}
		out = append(out, offer)
	}
	return out, nil
}

func (s *PiProfiles) putSecret(id, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Join(s.cfg.StatePath, "agent-secrets")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := filesystem.WriteFileAtomic(filepath.Join(dir, id), []byte(strings.TrimSpace(value)), 0o600); err != nil {
		return err
	}
	s.invalidateModels()
	return nil
}

func (s *PiProfiles) deleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.cfg.StatePath, "agent-secrets", id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	s.invalidateModels()
	return nil
}

func (s *PiProfiles) invalidateModels() {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.Cache = map[string][]agentapi.PiModelOffer{}
}

func (s *PiProfiles) Secrets() ([]agentapi.PiSecretOffer, error) { return s.secrets() }

func (s *PiProfiles) PutSecret(id, value string) error { return s.putSecret(id, value) }

func (s *PiProfiles) DeleteSecret(id string) error { return s.deleteSecret(id) }
