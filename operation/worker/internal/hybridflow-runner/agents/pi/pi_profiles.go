package pi

import (
	"bytes"
	"encoding/json"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/filesystem"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const PiRPCProtocol = "pi-rpc-1.3"

type PiProfiles struct {
	cfg *runnerconfig.Config
	mu  sync.Mutex
	// Catalogue queries are cached by profile revision, installation and model metadata.
	cacheMu sync.Mutex
	Cache   map[string][]agentapi.PiModelOffer
}

func NewPiProfiles(cfg *runnerconfig.Config) *PiProfiles {
	return &PiProfiles{cfg: cfg, Cache: map[string][]agentapi.PiModelOffer{}}
}

var PiIdentifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$`)

var piEnvName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func (s *PiProfiles) path() string { return filepath.Join(s.cfg.StatePath, "agent-profiles.json") }

func (s *PiProfiles) read() (agentapi.PiProfilesDocument, error) {
	var doc agentapi.PiProfilesDocument
	doc.Version, doc.Profiles, doc.Installations = 1, []agentapi.PiProfile{}, []equipment.AgentInstallation{}
	data, err := os.ReadFile(s.path())
	if os.IsNotExist(err) {
		return doc, nil
	}
	if err != nil {
		return doc, err
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return doc, faults.Invalid("invalid agent-profiles.json")
	}
	if doc.Version != 1 {
		return doc, faults.Invalid("unsupported agent profile schema")
	}
	return doc, nil
}

func (s *PiProfiles) write(doc agentapi.PiProfilesDocument) error {
	if err := validatePiProfiles(doc); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	old, err := s.read()
	if err != nil {
		return err
	}
	for i := range doc.Profiles {
		doc.Profiles[i].Revision = 1
		for _, previous := range old.Profiles {
			if previous.ID == doc.Profiles[i].ID {
				candidate := doc.Profiles[i]
				candidate.Revision = 0
				previousRevision := previous.Revision
				previous.Revision = 0
				before, _ := json.Marshal(previous)
				after, _ := json.Marshal(candidate)
				doc.Profiles[i].Revision = previousRevision
				if !bytes.Equal(before, after) {
					doc.Profiles[i].Revision++
				}
			}
		}
	}
	body, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.cfg.StatePath, 0o700); err != nil {
		return err
	}
	if err := filesystem.WriteFileAtomic(s.path(), append(body, '\n'), 0o600); err != nil {
		return err
	}
	s.invalidateModels()
	return nil
}

func validatePiProfiles(doc agentapi.PiProfilesDocument) error {
	if doc.Version != 1 {
		return faults.Invalid("profile document version must be 1")
	}
	ids := map[string]bool{}
	for _, in := range doc.Installations {
		if !PiIdentifier.MatchString(in.ID) || ids[in.ID] || in.Engine != agentapi.AgentPi || !in.External || (!filepath.IsAbs(in.Path) && !PiIdentifier.MatchString(in.Path)) {
			return faults.Invalid("declare each external Pi installation with a unique id and absolute executable path")
		}
		if !piCompatible(in) {
			return faults.Invalid("Pi installation has not passed the supported RPC qualification")
		}
		ids[in.ID] = true
	}
	ids = map[string]bool{}
	for _, p := range doc.Profiles {
		if !PiIdentifier.MatchString(p.ID) || ids[p.ID] || strings.TrimSpace(p.Name) == "" {
			return faults.Invalid("profiles require a unique stable id and a name")
		}
		ids[p.ID] = true
		providers := map[string]bool{}
		models := map[string]bool{}
		for _, c := range p.Connections {
			if !PiIdentifier.MatchString(c.Provider) || providers[c.Provider] {
				return faults.Invalid("each profile connection requires a unique provider name")
			}
			providers[c.Provider] = true
			switch c.API {
			case "openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai":
			default:
				return faults.Invalid("unsupported Pi connection API")
			}
			u, err := url.Parse(c.BaseURL)
			if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
				return faults.Invalid("connection URL must be an HTTP(S) endpoint without credentials or query")
			}
			if c.SecretRef != "" && !validPiSecretRef(c.SecretRef) {
				return faults.Invalid("secretRef must be env:NAME or private:id; OAuth is not qualified")
			}
			for _, m := range c.Models {
				key := c.Provider + "/" + m.ID
				if strings.TrimSpace(m.ID) == "" || strings.ContainsAny(m.ID, "\r\n") || models[key] {
					return faults.Invalid("profile models require distinct provider/model identifiers")
				}
				models[key] = true
			}
		}
		if p.DefaultModel != "" && !models[p.DefaultModel] {
			return faults.Invalid("profile default model must be in its connections")
		}
		for _, r := range append(append([]agentapi.PiResource{}, p.Extensions...), p.PromptTemplates...) {
			if !filepath.IsAbs(r.Path) || r.Version == "" || len(r.SHA256) != 64 {
				return faults.Invalid("Pi resources require an absolute file path, version and SHA256")
			}
		}
	}
	if doc.DefaultPiProfileID != "" && !ids[doc.DefaultPiProfileID] {
		return faults.Invalid("default Pi profile is not declared")
	}
	return nil
}

func validPiSecretRef(ref string) bool {
	kind, id, _ := strings.Cut(ref, ":")
	return (kind == "env" && piEnvName.MatchString(id)) || (kind == "private" && PiIdentifier.MatchString(id))
}

func (s *PiProfiles) secret(ref string) (string, bool) {
	kind, id, _ := strings.Cut(ref, ":")
	if !validPiSecretRef(ref) {
		return "", false
	}
	if kind == "env" {
		v := os.Getenv(id)
		return v, v != ""
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.StatePath, "agent-secrets", id))
	return strings.TrimSpace(string(data)), err == nil && strings.TrimSpace(string(data)) != ""
}

func piCompatible(in equipment.AgentInstallation) bool {
	return in.Protocol == PiRPCProtocol && (in.Version == "1.3.0" || in.Version == "1.2.0")
}

func (s *PiProfiles) installations(doc agentapi.PiProfilesDocument) []equipment.AgentInstallation {
	all := append([]equipment.AgentInstallation{}, doc.Installations...)
	if s.cfg.PiInstallations != nil {
		all = append(all, s.cfg.PiInstallations()...)
	}
	return all
}

func (s *PiProfiles) profile(id string) (agentapi.PiProfile, equipment.AgentInstallation, error) {
	doc, err := s.read()
	if err != nil {
		return agentapi.PiProfile{}, equipment.AgentInstallation{}, err
	}
	if err := validatePiProfiles(doc); err != nil {
		return agentapi.PiProfile{}, equipment.AgentInstallation{}, err
	}
	if id == "" {
		id = doc.DefaultPiProfileID
	}
	if id == "" {
		return agentapi.PiProfile{}, equipment.AgentInstallation{}, faults.Invalid("select a Pi execution profile or configure a Pi default")
	}
	var profile *agentapi.PiProfile
	for i := range doc.Profiles {
		if doc.Profiles[i].ID == id {
			profile = &doc.Profiles[i]
			break
		}
	}
	if profile == nil {
		return agentapi.PiProfile{}, equipment.AgentInstallation{}, faults.Invalid("Pi profile " + id + " is absent on this runner")
	}
	installations := s.installations(doc)
	matches := 0
	for _, in := range installations {
		if in.ID == profile.InstallationID {
			matches++
		}
	}
	if matches > 1 {
		return *profile, equipment.AgentInstallation{}, faults.Invalid("ambiguous Pi installation reference: " + profile.InstallationID)
	}
	for _, in := range installations {
		if in.ID != profile.InstallationID {
			continue
		}
		if !piCompatible(in) {
			return *profile, in, faults.Invalid("Pi installation has not passed RPC qualification")
		}
		path := in.Path
		if !filepath.IsAbs(path) {
			path, err = exec.LookPath(path)
		}
		if err != nil || path == "" {
			return *profile, in, faults.Invalid("Pi installation is absent")
		}
		stat, err := os.Stat(path)
		if err != nil || stat.IsDir() || stat.Mode()&0o111 == 0 {
			return *profile, in, faults.Invalid("Pi installation is absent or not executable")
		}
		in.Path = path
		return *profile, in, nil
	}
	return *profile, equipment.AgentInstallation{}, faults.Invalid("Pi installation " + profile.InstallationID + " is absent on this runner")
}

func (s *PiProfiles) resolve(id, model, effort string) (*agentapi.PiResolvedProfile, error) {
	p, in, err := s.profile(id)
	if err != nil {
		return nil, err
	}
	if model == "" {
		model = p.DefaultModel
	}
	if model == "" {
		return nil, faults.Invalid("select a provider/model in this Pi profile")
	}
	provider, modelID, ok := strings.Cut(model, "/")
	if !ok {
		return nil, faults.Invalid("Pi models use provider/model identifiers")
	}
	resolved := &agentapi.PiResolvedProfile{Profile: p, Installation: in, Provider: provider, ModelID: modelID, Keys: map[string]string{}}
	found := false
	for _, c := range p.Connections {
		for _, m := range c.Models {
			if c.Provider == provider && m.ID == modelID {
				found = true
			}
		}
		if c.SecretRef == "" {
			resolved.Keys[c.Provider] = "pi-local"
			continue
		}
		key, configured := s.secret(c.SecretRef)
		if !configured && c.Provider == provider {
			return nil, faults.Invalid("configure the secret reference for Pi provider " + provider)
		}
		if configured {
			resolved.Keys[c.Provider] = key
		}
	}
	if !found {
		return nil, faults.Invalid("model " + model + " is not allowed in Pi profile " + p.ID)
	}
	resolved.Effort = protocol.OrDefault(effort, p.DefaultEffort)
	return resolved, nil
}

func (s *PiProfiles) offered() []agentapi.PiProfileOffer {
	doc, err := s.read()
	if err != nil {
		return []agentapi.PiProfileOffer{}
	}
	out := make([]agentapi.PiProfileOffer, 0, len(doc.Profiles))
	for _, p := range doc.Profiles {
		offer := agentapi.PiProfileOffer{PiProfile: p, Status: "ready", Models: []agentapi.PiModelOffer{}, SecretStates: map[string]bool{}}
		for _, c := range p.Connections {
			_, set := s.secret(c.SecretRef)
			offer.SecretStates[c.Provider] = c.SecretRef == "" || set
		}
		_, _, problem := s.profile(p.ID)
		if problem != nil {
			offer.Status, offer.Message = "installation_missing", problem.Error()
		} else if len(p.Connections) == 0 || p.DefaultModel == "" {
			offer.Status, offer.Message = "incomplete", "Choose connections and a default model"
		}
		if offer.Status == "ready" {
			for _, c := range p.Connections {
				if !offer.SecretStates[c.Provider] {
					offer.Status, offer.Message = "auth_required", "Configure the secret reference for "+c.Provider
					break
				}
			}
		}
		out = append(out, offer)
	}
	return out
}

func (s *PiProfiles) validateTurn(p *agentapi.PiResolvedProfile, thinking bool) error {
	models, err := s.modelsFor(p.Profile, p.Installation, false)
	if err != nil {
		return err
	}
	for _, model := range models {
		if model.Value != p.Provider+"/"+p.ModelID {
			continue
		}
		if !thinking {
			p.Effort = "off"
		}
		if p.Effort == "" && len(model.Efforts) > 0 {
			p.Effort = model.Efforts[0].Value
		}
		for _, effort := range model.Efforts {
			if effort.Value == p.Effort {
				return nil
			}
		}
		return faults.Invalid("this Pi model does not support the selected thinking level")
	}
	return faults.Invalid("this Pi model is unavailable")
}

func (s *PiProfiles) ReadProfiles() (agentapi.PiProfilesDocument, error) { return s.read() }

func (s *PiProfiles) WriteProfiles(doc agentapi.PiProfilesDocument) error { return s.write(doc) }

func (s *PiProfiles) Secret(ref string) (string, bool) { return s.secret(ref) }

func (s *PiProfiles) Installations(doc agentapi.PiProfilesDocument) []equipment.AgentInstallation {
	return s.installations(doc)
}

func (s *PiProfiles) Profile(id string) (agentapi.PiProfile, equipment.AgentInstallation, error) {
	return s.profile(id)
}

func (s *PiProfiles) ResolveProfile(id, model, effort string) (*agentapi.PiResolvedProfile, error) {
	return s.resolve(id, model, effort)
}

func (s *PiProfiles) OfferedProfiles() []agentapi.PiProfileOffer { return s.offered() }

func (s *PiProfiles) ValidateTurn(p *agentapi.PiResolvedProfile, thinking bool) error {
	return s.validateTurn(p, thinking)
}
