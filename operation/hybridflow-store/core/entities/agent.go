package entities

import (
	"encoding/json"
	"strings"
	"time"
)

// Flow nodes reference agents by settings.agent ID, not engine. Legacy engine/model
// settings remain readable and playable, but new writes use managed agents.

// Harness lists known engines. Worker checks host availability per turn
// and rejects unavailable harnesses at play time.
type Harness string

const (
	HarnessClaude Harness = "claude"
	HarnessCodex  Harness = "codex"
	HarnessMuse   Harness = "muse"
	HarnessPi     Harness = "pi"
)

var harnesses = map[Harness]bool{
	HarnessClaude: true, HarnessCodex: true, HarnessMuse: true, HarnessPi: true,
}

func ReadHarness(said string) (Harness, bool) {
	harness := Harness(strings.ToLower(strings.TrimSpace(said)))
	return harness, harnesses[harness]
}

// Agent requires a name and harness. Empty Model selects the CLI default;
// Description and Instructions may be empty.
type Agent struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Harness      Harness       `json:"harness"`
	Model        string        `json:"model"`
	Effort       string        `json:"effort,omitempty"`
	ProfileID    string        `json:"profileId,omitempty"`
	Description  string        `json:"description,omitempty"`
	Instructions string        `json:"-"`
	Repository   string        `json:"-"`
	DraftError   string        `json:"-"`
	CreatedAt    time.Time     `json:"createdAt"`
	UpdatedAt    time.Time     `json:"updatedAt"`
	Revision     int64         `json:"revision"`
	Archived     bool          `json:"archived"`
	Published    *AgentVersion `json:"-"`
}

// AgentVersion is the immutable configuration published for new conversations.
type AgentVersion struct {
	ResolvedModel     string            `json:"resolvedModel,omitempty"`
	ResolvedEffort    string            `json:"resolvedEffort,omitempty"`
	ResolvedProfileID string            `json:"resolvedProfileId,omitempty"`
	ResolvedProfile   json.RawMessage   `json:"resolvedProfile,omitempty"`
	Resources         map[string]string `json:"resources,omitempty"`
	Repository        string            `json:"repository,omitempty"`
	Commit            string            `json:"commit,omitempty"`
	Tag               string            `json:"tag,omitempty"`
	LockDigest        string            `json:"lockDigest,omitempty"`
	Effort            string            `json:"effort,omitempty"`
	AgentID           string            `json:"agentId"`
	Version           int64             `json:"version"`
	Name              string            `json:"name"`
	Harness           Harness           `json:"harness"`
	Model             string            `json:"model"`
	ProfileID         string            `json:"profileId,omitempty"`
	Description       string            `json:"description,omitempty"`
	Instructions      string            `json:"instructions,omitempty"`
	PublishedAt       time.Time         `json:"publishedAt"`
}

func (a Agent) Publish(version int64, at time.Time) AgentVersion {
	return AgentVersion{AgentID: a.ID, Version: version, Name: a.Name, Harness: a.Harness,
		Model: a.Model, Effort: a.Effort, ProfileID: a.ProfileID, Description: a.Description,
		Instructions: a.Instructions, PublishedAt: at}
}

// AgentPatch excludes the stable ID referenced by flow nodes.
type AgentPatch struct {
	Name         *string
	Harness      *Harness
	Model        *string
	Effort       *string
	ProfileID    *string
	Description  *string
	Instructions *string
	Archived     *bool
}

func (p AgentPatch) Empty() bool {
	return p.Name == nil && p.Harness == nil && p.Model == nil && p.Effort == nil && p.ProfileID == nil && p.Description == nil && p.Instructions == nil && p.Archived == nil
}
