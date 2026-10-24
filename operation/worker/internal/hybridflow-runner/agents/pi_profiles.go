package agents

import (
	"kiao/worker/internal/core/equipment"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
)

// Profiles and secrets are worker state, never board documents or transcript context.
type PiProfilesDocument struct {
	Version            int                           `json:"version"`
	DefaultPiProfileID string                        `json:"defaultPiProfileId,omitempty"`
	Installations      []equipment.AgentInstallation `json:"installations"`
	Profiles           []PiProfile                   `json:"profiles"`
}

type PiProfile struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Revision       int64          `json:"revision"`
	InstallationID string         `json:"installationId"`
	Connections    []PiConnection `json:"connections"`
	DefaultModel   string         `json:"defaultModel,omitempty"`
	DefaultEffort  string         `json:"defaultEffort,omitempty"`
	Tools          []string       `json:"tools,omitempty"`
	// Nil means the toolbox selection; [] explicitly supplies no servers.
	MCPServers      []string     `json:"mcpServers"`
	Extensions      []PiResource `json:"extensions,omitempty"`
	PromptTemplates []PiResource `json:"promptTemplates,omitempty"`
}

// Provider is a connection's unique Pi provider name in this profile, including aliases.
// Models always use provider/id on the common wire, including providers with slashes in model IDs.
type PiConnection struct {
	Provider  string    `json:"provider"`
	API       string    `json:"api"`
	BaseURL   string    `json:"baseUrl"`
	SecretRef string    `json:"secretRef,omitempty"`
	Models    []PiModel `json:"models"`
}

type PiModel struct {
	ID            string             `json:"id"`
	Name          string             `json:"name,omitempty"`
	Reasoning     bool               `json:"reasoning"`
	Input         []string           `json:"input,omitempty"`
	ContextWindow int                `json:"contextWindow,omitempty"`
	MaxTokens     int                `json:"maxTokens,omitempty"`
	Cost          map[string]float64 `json:"cost,omitempty"`
	Compat        map[string]any     `json:"compat,omitempty"`
}

// Local resources are explicit, immutable by digest and version. No package fetching in a turn.
type PiResource struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

type AgentCapabilities struct {
	Steer         bool `json:"steer"`
	FollowUp      bool `json:"followUp"`
	Compact       bool `json:"compact"`
	Branch        bool `json:"branch"`
	ForkAtMessage bool `json:"forkAtMessage"`
	ImageInput    bool `json:"imageInput"`
}

type PiModelOffer struct {
	AgentOption
	Provider     string            `json:"provider"`
	ModelID      string            `json:"modelId"`
	Efforts      []AgentOption     `json:"efforts"`
	Capabilities AgentCapabilities `json:"capabilities"`
}

type PiProfileOffer struct {
	PiProfile
	Status       string          `json:"status"`
	Message      string          `json:"message,omitempty"`
	Models       []PiModelOffer  `json:"models"`
	SecretStates map[string]bool `json:"secretStates"`
}

type PiResolvedProfile struct {
	Profile      PiProfile
	Installation equipment.AgentInstallation
	Provider     string
	ModelID      string
	Effort       string
	// Keys are never serialized, logged, or put in command arguments.
	Keys map[string]string
}

func (p *PiResolvedProfile) Execution() *turntrace.AgentTurnExecution {
	if p == nil {
		return nil
	}
	return &turntrace.AgentTurnExecution{ProfileID: p.Profile.ID, ProfileRevision: p.Profile.Revision, Version: p.Installation.Version, Provider: p.Provider, Model: p.ModelID, Effort: p.Effort}
}
