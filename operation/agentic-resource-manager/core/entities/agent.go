package entities

import (
	"encoding/json"
	"strings"
	"time"
)

// Harness identifies the execution engine requested by an agent.
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
	Harnesses    []Harness     `json:"harnesses,omitempty"`
	Supersedes   []string      `json:"supersedes,omitempty"`
	Model        string        `json:"model"`
	Effort       string        `json:"effort,omitempty"`
	ProfileID    string        `json:"profileId,omitempty"`
	Description  string        `json:"description,omitempty"`
	Instructions string        `json:"instructions,omitempty"`
	Project      string        `json:"project,omitempty"`
	Repository   string        `json:"repository,omitempty"`
	DraftError   string        `json:"draftError,omitempty"`
	CreatedAt    time.Time     `json:"createdAt"`
	UpdatedAt    time.Time     `json:"updatedAt"`
	Revision     int64         `json:"revision"`
	Version      string        `json:"version,omitempty"`
	Published    *AgentVersion `json:"published,omitempty"`

	HasUnpublishedChanges bool `json:"hasUnpublishedChanges"`
}

// AgentVersion is the immutable configuration for a publication or a draft conversation.
type AgentVersion struct {
	ResolvedModel     string            `json:"resolvedModel,omitempty"`
	ResolvedEffort    string            `json:"resolvedEffort,omitempty"`
	ResolvedProfileID string            `json:"resolvedProfileId,omitempty"`
	ResolvedProfile   json.RawMessage   `json:"resolvedProfile,omitempty"`
	Resources         map[string]string `json:"resources,omitempty"`
	Repository        string            `json:"repository,omitempty"`
	Commit            string            `json:"commit,omitempty"`
	DraftID           string            `json:"draftId,omitempty"`
	Tag               string            `json:"tag,omitempty"`
	LockDigest        string            `json:"lockDigest,omitempty"`
	Effort            string            `json:"effort,omitempty"`
	AgentID           string            `json:"agentId"`
	Version           string            `json:"version,omitempty"`
	Name              string            `json:"name"`
	Harness           Harness           `json:"harness"`
	Harnesses         []Harness         `json:"harnesses,omitempty"`
	Supersedes        []string          `json:"supersedes,omitempty"`
	Model             string            `json:"model"`
	ProfileID         string            `json:"profileId,omitempty"`
	Description       string            `json:"description,omitempty"`
	Instructions      string            `json:"instructions,omitempty"`
	PublishedAt       time.Time         `json:"publishedAt"`
}

func (a Agent) Publish(version string, at time.Time) AgentVersion {
	return AgentVersion{AgentID: a.ID, Version: version, Name: a.Name, Harness: a.Harness,
		Harnesses: a.Harnesses, Supersedes: a.Supersedes,
		Model: a.Model, Effort: a.Effort, ProfileID: a.ProfileID, Description: a.Description,
		Instructions: a.Instructions, PublishedAt: at}
}

// AgentPatch excludes the stable ID referenced by flow nodes.
type AgentPatch struct {
	Name         *string  `json:"name,omitempty"`
	Harness      *Harness `json:"harness,omitempty"`
	Model        *string  `json:"model,omitempty"`
	Effort       *string  `json:"effort,omitempty"`
	ProfileID    *string  `json:"profileId,omitempty"`
	Description  *string  `json:"description,omitempty"`
	Instructions *string  `json:"instructions,omitempty"`
}

func (p AgentPatch) Empty() bool {
	return p.Name == nil && p.Harness == nil && p.Model == nil && p.Effort == nil && p.ProfileID == nil && p.Description == nil && p.Instructions == nil
}
