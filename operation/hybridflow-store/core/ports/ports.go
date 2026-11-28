// Package ports defines the core's external contracts.
// Repositories record changes to feed subjects and their actor in the same transaction.
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

// FolderRepository stores named folders within a collection. Deleting a folder detaches
// its members in the same write.
type FolderRepository interface {
	ListFolders(ctx context.Context, scope entities.FolderScope) ([]entities.Folder, error)
	CreateFolder(ctx context.Context, scope entities.FolderScope, folder entities.Folder) error
	RenameFolder(ctx context.Context, scope entities.FolderScope, id, name string) (*entities.Folder, error)
	DeleteFolder(ctx context.Context, scope entities.FolderScope, id, actor string) error
}

// BoardRepository keeps boards and flow nodes as one aggregate with board-local chains
// and a shared change sequence.
// Patch methods update only named fields; non-nil expected revisions must match
// or return entities.ErrConflict. Nil skips the revision check.
type BoardRepository interface {
	// CreateBoard returns ErrNameTaken if the name is already held.
	CreateBoard(ctx context.Context, board *entities.Board, actor string) error
	// ListBoards excludes flow nodes.
	ListBoards(ctx context.Context, filter BoardFilter) ([]entities.Board, error)
	FindBoard(ctx context.Context, id string) (*entities.Board, error)
	FindBoardBySlug(ctx context.Context, slug string) (*entities.Board, error)
	PatchBoard(ctx context.Context, id string, patch entities.BoardPatch, expected *int64, actor string) (*entities.Board, error)
	// DeleteBoard removes the board and all its contents.
	DeleteBoard(ctx context.Context, id string, actor string) error

	// CreateFlowNodes writes all flow nodes in one transaction.
	CreateFlowNodes(ctx context.Context, flowNodes []*entities.FlowNode, actor string) error
	FindFlowNode(ctx context.Context, id string) (*entities.FlowNode, error)
	ListFlowNodes(ctx context.Context, boardID string) ([]entities.FlowNode, error)
	ListSchemaValues(ctx context.Context) ([]entities.SchemaValue, error)
	OutputTypeUsed(ctx context.Context, id string) (bool, error)
	// Run status writes may skip revision checks because the run holds the flow node.
	PatchFlowNode(ctx context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error)
	DeleteFlowNodes(ctx context.Context, ids []string, actor string) error

	// ClaimFlowNode atomically claims a free, ready or done flow node. A done AI flow node loses its previous chat link.
	// Claims are idempotent for the same run, including retries after usage limits refresh.
	// A gateway reached from a predecessor checks that its inputs have completed for this firing.
	ClaimFlowNode(ctx context.Context, id, runID string, status entities.FlowNodeStatus, actor string, afterPredecessor ...bool) (*entities.FlowNode, error)
	// ReleaseFlowNode commits the result and clears the claim if runID still holds the flow node.
	// A workflow update also requires the flow node to still belong to that workflow.
	ReleaseFlowNode(ctx context.Context, id, runID, actor string, result entities.PlayResult) (*entities.FlowNode, error)
	// ReleaseRun clears all flow nodes held by the run, regardless of state, for restart recovery.
	ReleaseRun(ctx context.Context, runID string, status entities.FlowNodeStatus, actor string) (int, error)
	HeldFlowNodes(ctx context.Context, runID string) ([]entities.FlowNode, error)
}

// WorkflowRepository keeps workflow groups; membership is stored on flow nodes
// and changed through their patches, with their own revisions and change rows.
// Patch methods require non-nil expected revisions to match or return entities.ErrConflict;
// nil skips the revision check.
type WorkflowRepository interface {
	CreateWorkflow(ctx context.Context, workflow *entities.Workflow, actor string) error
	// CreateWorkflowWithFlowNodes writes the group, its new members and their changes atomically.
	CreateWorkflowWithFlowNodes(ctx context.Context, workflow *entities.Workflow, flowNodes []*entities.FlowNode, actor string) error
	FindWorkflow(ctx context.Context, id string) (*entities.Workflow, error)
	ListWorkflows(ctx context.Context, boardID string) ([]entities.Workflow, error)
	PatchWorkflow(ctx context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error)
	// DeleteWorkflows ungroups flow nodes without deleting or moving them.
	DeleteWorkflows(ctx context.Context, ids []string, actor string) error
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
type AgentLookup interface {
	FindAgent(context.Context, string) (*entities.Agent, error)
}

type AgentRepository interface {
	// CreateAgent returns ErrAgentNameTaken if the name is already held.
	CreateAgent(ctx context.Context, agent *entities.Agent, actor string) error
	// ListAgents orders by name.
	ListAgents(ctx context.Context) ([]entities.Agent, error)
	FindAgent(ctx context.Context, id string) (*entities.Agent, error)
	PatchAgent(ctx context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error)
	PublishAgent(ctx context.Context, id string, expected *int64, at time.Time, actor string) (*entities.Agent, error)
	AgentVersions(ctx context.Context, id string) ([]entities.AgentVersion, error)
	// Published agents retain their history and can only be archived.
	DeleteAgent(ctx context.Context, id string, actor string) error
}

// UsageRepository is append-only: no revisions, actor or change events.
// Usage reports name their run and must not cause editor conflicts or redraws.
type UsageRepository interface {
	// RecordUsage is idempotent by ID: the first write wins, so spool replay cannot double count.
	RecordUsage(ctx context.Context, usage *entities.TaskUsage) error
	// UsageTotals returns zero totals and no priced cost when the flow node has no reports.
	UsageTotals(ctx context.Context, flowNodeID string) (entities.TaskUsageTotals, error)
}

// ChangeLog reads changes recorded transactionally by repository writes.
type ChangeLog interface {
	// Since returns changes after seq, oldest first, optionally scoped to a board and its flow nodes.
	// latest is the log's latest sequence, allowing detection of truncated pages.
	Since(ctx context.Context, seq int64, boardID string, limit int) (changes []entities.Change, latest int64, err error)
	// Latest supplies the watch cursor alongside the initial full read to avoid missing changes.
	Latest(ctx context.Context) (int64, error)
	// Await blocks until the log passes seq or ctx ends, reporting whether it passed.
	// Adapters without wakeup support may return false immediately; callers then poll.
	Await(ctx context.Context, seq int64) bool
}

type ExecutionRepository interface {
	RecordExecution(context.Context, entities.TaskExecution) error
	Executions(context.Context, string) ([]entities.TaskExecution, error)
}
