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
)

var agentPlatforms = map[AgentPlatform]bool{
	PlatformClaude: true, PlatformCodex: true, PlatformMuse: true, PlatformOpenCode: true,
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
	// Description helps choose an agent for a task; it is never sent to its turns.
	Description string
	// Instructions accompany the prompt as system instructions.
	Instructions string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Revision     int64
}

// AgentPatch excludes the stable ID referenced by flow nodes.
type AgentPatch struct {
	Name         *string
	Platform     *AgentPlatform
	Model        *string
	Description  *string
	Instructions *string
}

func (p AgentPatch) Empty() bool {
	return p.Name == nil && p.Platform == nil && p.Model == nil && p.Description == nil && p.Instructions == nil
}
