package entities

import (
	"strings"
	"time"
)

// Flow nodes reference agents by settings.agent ID, not engine. Legacy engine/model
// settings remain readable and playable, but new writes use managed agents.

// AgentPlatform lists known engines. Worker checks host availability per turn
// and rejects unavailable platforms at play time.
type AgentPlatform string

const (
	PlatformClaude   AgentPlatform = "claude"
	PlatformCodex    AgentPlatform = "codex"
	PlatformMuse     AgentPlatform = "muse"
	PlatformOpenCode AgentPlatform = "opencode"
	PlatformPi       AgentPlatform = "pi"
)

var agentPlatforms = map[AgentPlatform]bool{
	PlatformClaude: true, PlatformCodex: true, PlatformMuse: true, PlatformOpenCode: true, PlatformPi: true,
}

func ReadAgentPlatform(said string) (AgentPlatform, bool) {
	platform := AgentPlatform(strings.ToLower(strings.TrimSpace(said)))
	return platform, agentPlatforms[platform]
}

// Agent requires a name and platform. Empty Model selects the CLI default;
// Description and Instructions may be empty.
type Agent struct {
	// ID is service-generated.
	ID string
	// Name is unique across the store, case-insensitively.
	Name     string
	Platform AgentPlatform
	Model    string
	// ProfileID is resolved by the runner, never by this store. It carries no credentials.
	ProfileID string
	// Description helps choose an agent for a task; it is never sent to its turns.
	Description string
	// Instructions accompany the prompt as system instructions.
	Instructions string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Revision     int64
	Archived     bool
	Published    *AgentVersion
}

// AgentVersion is the immutable configuration published for new conversations.
type AgentVersion struct {
	AgentID      string        `json:"agentId"`
	Version      int64         `json:"version"`
	Name         string        `json:"name"`
	Platform     AgentPlatform `json:"platform"`
	Model        string        `json:"model"`
	ProfileID    string        `json:"profileId,omitempty"`
	Description  string        `json:"description,omitempty"`
	Instructions string        `json:"instructions,omitempty"`
	PublishedAt  time.Time     `json:"publishedAt"`
}

func (a Agent) Publish(version int64, at time.Time) AgentVersion {
	return AgentVersion{AgentID: a.ID, Version: version, Name: a.Name, Platform: a.Platform,
		Model: a.Model, ProfileID: a.ProfileID, Description: a.Description,
		Instructions: a.Instructions, PublishedAt: at}
}

// AgentPatch excludes the stable ID referenced by flow nodes.
type AgentPatch struct {
	Name         *string
	Platform     *AgentPlatform
	Model        *string
	ProfileID    *string
	Description  *string
	Instructions *string
	Archived     *bool
}

func (p AgentPatch) Empty() bool {
	return p.Name == nil && p.Platform == nil && p.Model == nil && p.ProfileID == nil && p.Description == nil && p.Instructions == nil && p.Archived == nil
}
