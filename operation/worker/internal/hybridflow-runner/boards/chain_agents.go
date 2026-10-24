package boards

import (
	"errors"
)

// ErrAgentUnknown allows legacy engine/model fallback; other lookup errors stop play.
var ErrAgentUnknown = errors.New("unknown agent")

// Without a resolver, only legacy cards can play.
type AgentResolver interface {
	Agent(id string) (*ManagedAgent, error)
}

// ErrRunnerUnknown makes pinned-card refusals identify the missing runner by id.
var ErrRunnerUnknown = errors.New("unknown runner")

// Without a resolver, pinned-card refusals use ids rather than runner names.
type RunnerResolver interface {
	Runner(id string) (*ManagedRunner, error)
}
