package entities

import (
	"crypto/sha256"
	"encoding/hex"
)

// AgenticResource is one independently versioned APM project.
type AgenticResource struct {
	Name             string   `json:"name"`
	Kind             string   `json:"kind"`
	Description      string   `json:"description,omitempty"`
	Repository       string   `json:"repository,omitempty"`
	Commit           string   `json:"commit,omitempty"`
	Version          string   `json:"version,omitempty"`
	PublishedVersion string   `json:"publishedVersion,omitempty"`
	Dirty            bool     `json:"dirty"`
	Files            []string `json:"files"`
}

type AgentDependencyKind string

const (
	AgentSkill AgentDependencyKind = "skill"
	AgentMCP   AgentDependencyKind = "mcp"
)

type AgentDependency struct {
	Name      string `json:"name"`
	Linked    bool   `json:"linked"`
	Available bool   `json:"available"`
	HasRemote bool   `json:"hasRemote"`
	Local     bool   `json:"local"`
}

type ResourceFile struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision string `json:"revision,omitempty"`
}

func (f ResourceFile) Versioned() ResourceFile {
	sum := sha256.Sum256([]byte(f.Content))
	f.Revision = hex.EncodeToString(sum[:])
	return f
}

const AgentPackageFormat = "apm-deployment-v1"

// AgentPackage carries a prepared deployment and its APM lock.
type AgentPackage struct {
	Format  string            `json:"format"`
	Project string            `json:"project"`
	Commit  string            `json:"commit,omitempty"`
	DraftID string            `json:"draftId,omitempty"`
	Files   map[string][]byte `json:"files"`
}

type DraftAgentPackage struct {
	Agent   AgentVersion `json:"agent"`
	Package AgentPackage `json:"package"`
}

type PushConfirmation struct {
	Dependencies []string `json:"dependencies"`
	Token        string   `json:"token"`
}

func (*PushConfirmation) Error() string {
	return "this agent requires Kiao to use its local dependencies"
}
func (*PushConfirmation) Unwrap() error { return ErrConflict }
