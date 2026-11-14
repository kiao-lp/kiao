package entities

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrNotFound = errors.New("not found")
	ErrInvalid = errors.New("invalid")
	// ErrConflict requires rereading the row before retrying a conditional write.
	ErrConflict = errors.New("conflict")
	ErrNameTaken = errors.New("board name is taken")
	ErrAgentNameTaken = errors.New("agent name is taken")
	ErrRunnerNameTaken = errors.New("runner name is taken")
)

func NotFoundf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrNotFound)
}

func Invalidf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrInvalid)
}

func Conflictf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrConflict)
}

type ChangeScope string

const (
	ScopeBoard         ChangeScope = "board"
	ScopeFlowNode      ChangeScope = "flowNode"
	ScopeFlowNodeClass ChangeScope = "flowNodeClass"
	ScopeWorkflow      ChangeScope = "workflow"
	ScopeWorkflowClass ChangeScope = "workflowClass"
	ScopeAgent         ChangeScope = "agent"
	ScopeRunner        ChangeScope = "runner"
)

const (
	ChangeCreated = "created"
	ChangeUpdated = "updated"
	ChangeDeleted = "deleted"
)

// Change is the flat feed projection of an event and its scope-specific subtype.
type Change struct {
	// Seq is the store-wide order and client cursor.
	Seq   int64
	At    time.Time
	Scope ChangeScope
	Kind  string
	// BoardID is set for board changes and changes to anything on the board;
	// board-scoped feeds filter on it.
	BoardID    string
	FlowNodeID string
	// FlowNodeClassID identifies the class even for changes to its versions.
	FlowNodeClassID string
	// Agent changes have no BoardID and appear only in the global feed.
	AgentID string
	// Runner changes have no BoardID and appear only in the global feed.
	RunnerID string
	// Workflow and workflow-class changes also set BoardID.
	WorkflowID      string
	WorkflowClassID string
	// Actor is the authenticated identity or the run that caused the change.
	Actor string
	// Revision lets clients skip changes they already hold.
	Revision int64
}
