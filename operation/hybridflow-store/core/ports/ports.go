// Package ports defines the core's external contracts.
// Repository writes record the actor and change in the same transaction, or neither lands.
// UsageRepository is the exception.
package ports

import (
	"context"
	"time"

	"kiao/hybridflow-store/core/entities"
)

type Clock interface {
	Now() time.Time
}

// IDs mints UUIDs.
type IDs interface {
	NewID() string
}

type BoardFilter struct {
	IncludeArchived bool
}

// BoardRepository keeps boards and cards as one aggregate with board-local chains
// and a shared change sequence.
// Patch methods update only named fields; non-nil expected revisions must match
// or return entities.ErrConflict. Nil skips the revision check.
type BoardRepository interface {
	// CreateBoard returns ErrNameTaken if the name is already held.
	CreateBoard(ctx context.Context, board *entities.Board, actor string) error
	// ListBoards excludes cards.
	ListBoards(ctx context.Context, filter BoardFilter) ([]entities.Board, error)
	FindBoard(ctx context.Context, id string) (*entities.Board, error)
	FindBoardBySlug(ctx context.Context, slug string) (*entities.Board, error)
	PatchBoard(ctx context.Context, id string, patch entities.BoardPatch, expected *int64, actor string) (*entities.Board, error)
	// DeleteBoard removes the board and all its contents.
	DeleteBoard(ctx context.Context, id string, actor string) error

	// CreateFlowNodes writes all cards in one transaction.
	CreateFlowNodes(ctx context.Context, flowNodes []*entities.FlowNode, actor string) error
	FindFlowNode(ctx context.Context, id string) (*entities.FlowNode, error)
	ListFlowNodes(ctx context.Context, boardID string) ([]entities.FlowNode, error)
	// Run status writes may skip revision checks because the run holds the card.
	PatchFlowNode(ctx context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error)
	DeleteFlowNodes(ctx context.Context, ids []string, actor string) error

	// ClaimFlowNode atomically claims a free, ready card or returns entities.ErrFlowNodeHeld.
	// Claims are idempotent for the same run, including retries after usage limits refresh.
	// StartPlay, not the claim, prevents duplicate play records.
	ClaimFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string) (*entities.FlowNode, error)
	// ReleaseFlowNode sets the final status and clears the run only if runID holds the card,
	// preventing a stale run from changing another run's card.
	ReleaseFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string) (*entities.FlowNode, error)
	// ReleaseRun clears all cards held by the run, regardless of state, for restart recovery.
	ReleaseRun(ctx context.Context, runID string, status entities.FlowNodeStatus, actor string) (int, error)
	HeldFlowNodes(ctx context.Context, runID string) ([]entities.FlowNode, error)
}

// ClassRepository keeps classes and versions as an aggregate separate from cards.
// Patch methods update only named fields; non-nil expected must match or return
// entities.ErrConflict. Nil skips the revision check.
type ClassRepository interface {
	CreateClass(ctx context.Context, class *entities.FlowNodeClass, actor string) error
	FindClass(ctx context.Context, id string) (*entities.FlowNodeClass, error)
	ListClasses(ctx context.Context, boardID string) ([]entities.FlowNodeClass, error)
	// ListAllClasses orders by oldest board first.
	ListAllClasses(ctx context.Context) ([]entities.FlowNodeClass, error)
	PatchClass(ctx context.Context, id string, patch entities.FlowNodeClassPatch, expected *int64, actor string) (*entities.FlowNodeClass, error)
	// DeleteClasses removes versions too; instantiated cards retain content and lose their link.
	DeleteClasses(ctx context.Context, ids []string, actor string) error

	// CreateVersion uses the caller-supplied version number.
	CreateVersion(ctx context.Context, version *entities.FlowNodeClassVersion, actor string) error
	FindVersion(ctx context.Context, id string) (*entities.FlowNodeClassVersion, error)
	// ListVersions orders oldest first.
	ListVersions(ctx context.Context, classID string) ([]entities.FlowNodeClassVersion, error)
	PatchVersion(ctx context.Context, id string, patch entities.FlowNodeClassVersionPatch, expected *int64, actor string) (*entities.FlowNodeClassVersion, error)
	// DeleteVersion removes any supplied version; the service must protect published versions.
	DeleteVersion(ctx context.Context, id string, actor string) error
}

// WorkflowRepository keeps workflow groups; membership is stored on cards/classes
// and changed through their patches, with their own revisions and change rows.
// Patch methods require non-nil expected revisions to match or return entities.ErrConflict;
// nil skips the revision check.
type WorkflowRepository interface {
	CreateWorkflow(ctx context.Context, workflow *entities.Workflow, actor string) error
	FindWorkflow(ctx context.Context, id string) (*entities.Workflow, error)
	ListWorkflows(ctx context.Context, boardID string) ([]entities.Workflow, error)
	PatchWorkflow(ctx context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error)
	// DeleteWorkflows ungroups cards without deleting or moving them.
	DeleteWorkflows(ctx context.Context, ids []string, actor string) error

	CreateWorkflowClass(ctx context.Context, workflow *entities.WorkflowClass, actor string) error
	FindWorkflowClass(ctx context.Context, id string) (*entities.WorkflowClass, error)
	ListWorkflowClasses(ctx context.Context, boardID string) ([]entities.WorkflowClass, error)
	// ListAllWorkflowClasses orders by oldest board first.
	ListAllWorkflowClasses(ctx context.Context) ([]entities.WorkflowClass, error)
	PatchWorkflowClass(ctx context.Context, id string, patch entities.WorkflowClassPatch, expected *int64, actor string) (*entities.WorkflowClass, error)
	// DeleteWorkflowClasses ungroups classes without deleting them.
	DeleteWorkflowClasses(ctx context.Context, ids []string, actor string) error
}

// RunnerRepository keeps runners independently of boards.
// PatchRunner updates only named fields; non-nil expected must match or return
// entities.ErrConflict. Nil skips the revision check.
type RunnerRepository interface {
	// CreateRunner returns ErrRunnerNameTaken if the name is already held.
	CreateRunner(ctx context.Context, runner *entities.Runner, actor string) error
	// ListRunners orders by name.
	ListRunners(ctx context.Context) ([]entities.Runner, error)
	FindRunner(ctx context.Context, id string) (*entities.Runner, error)
	PatchRunner(ctx context.Context, id string, patch entities.RunnerPatch, expected *int64, actor string) (*entities.Runner, error)
	// DeleteRunner leaves task references intact; the next play reports the missing runner.
	DeleteRunner(ctx context.Context, id string, actor string) error
	// Heartbeat stamps last seen with now and returns the runner, or ErrNotFound if deleted.
	Heartbeat(ctx context.Context, id string, now time.Time, actor string) (*entities.Runner, error)
}

// AgentRepository keeps managed agents independently of boards.
// PatchAgent updates only named fields; non-nil expected must match or return
// entities.ErrConflict. Nil skips the revision check.
type AgentRepository interface {
	// CreateAgent returns ErrAgentNameTaken if the name is already held.
	CreateAgent(ctx context.Context, agent *entities.Agent, actor string) error
	// ListAgents orders by name.
	ListAgents(ctx context.Context) ([]entities.Agent, error)
	FindAgent(ctx context.Context, id string) (*entities.Agent, error)
	PatchAgent(ctx context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error)
	// DeleteAgent leaves card references intact; the next play reports the missing agent.
	DeleteAgent(ctx context.Context, id string, actor string) error
}

// UsageRepository is append-only: no revisions, actor or change events.
// Usage reports name their run and must not cause editor conflicts or redraws.
type UsageRepository interface {
	// RecordUsage is idempotent by ID: the first write wins, so spool replay cannot double count.
	RecordUsage(ctx context.Context, usage *entities.TaskUsage) error
	// UsageTotals returns zero totals and no priced cost when the card has no reports.
	UsageTotals(ctx context.Context, flowNodeID string) (entities.TaskUsageTotals, error)
}

// ChangeLog reads changes recorded transactionally by repository writes.
type ChangeLog interface {
	// Since returns changes after seq, oldest first, optionally scoped to a board and its cards.
	// latest is the log's latest sequence, allowing detection of truncated pages.
	Since(ctx context.Context, seq int64, boardID string, limit int) (changes []entities.Change, latest int64, err error)
	// Latest supplies the watch cursor alongside the initial full read to avoid missing changes.
	Latest(ctx context.Context) (int64, error)
	// Await blocks until the log passes seq or ctx ends, reporting whether it passed.
	// Adapters without wakeup support may return false immediately; callers then poll.
	Await(ctx context.Context, seq int64) bool
}
