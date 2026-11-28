// Package memory is the ports held in maps: a store with no database behind it.
//
// **It is a test adapter, not a deployment option.** What it exists for is to make the claim the
// ports make checkable rather than asserted — every rule of the core, and every convention of the
// HTTP surface, is tested against this and never against PostgreSQL, so a rule that quietly needed
// a database would not compile. The suite that *does* need one (adapters/postgres) tests the three
// things only a database can promise: the conditional claim, the deferred chain constraint, and
// the change log the triggers write.
//
// It is deliberately not wired into main: a board kept in a map is a board lost at the next
// restart, and a service that silently offered that would be worse than one that refuses to start
// without its store. If a runtime without PostgreSQL ever has to be served, this is the beginning
// of the answer and not the answer.
package memory

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Store implements ports.BoardRepository, ports.AgentRepository, ports.RunnerRepository,
// ports.UsageRepository and ports.ChangeLog over maps. One Store is one whole store.
type Store struct {
	mu        sync.Mutex
	boards    map[string]*entities.Board
	folders   map[entities.FolderScope]map[string]entities.Folder
	flowNodes map[string]*entities.FlowNode
	slugs     map[string]string
	changes   []entities.Change
	seq       int64

	agents        map[string]*entities.Agent
	agentVersions map[string][]entities.AgentVersion
	runners       map[string]*entities.Runner

	// usage is what the AI flow nodes spent, by flow node, oldest report first — with the ids beside
	// it, so a replayed report is recognised and dropped the way ON CONFLICT DO NOTHING does.
	usage   map[string][]entities.TaskUsage
	usageID map[string]bool

	workflows map[string]*entities.Workflow

	// waiters are released whenever the change log moves, so Await is a wait here too and the
	// surface's watch endpoint is tested on the path it actually takes.
	waiters []chan struct{}
}

// New builds an empty store.
func New() *Store {
	return &Store{
		boards:        map[string]*entities.Board{},
		folders:       map[entities.FolderScope]map[string]entities.Folder{},
		flowNodes:     map[string]*entities.FlowNode{},
		slugs:         map[string]string{},
		agents:        map[string]*entities.Agent{},
		agentVersions: map[string][]entities.AgentVersion{},
		runners:       map[string]*entities.Runner{},
		usage:         map[string][]entities.TaskUsage{},
		usageID:       map[string]bool{},

		workflows: map[string]*entities.Workflow{},
	}
}

var (
	_ ports.BoardRepository    = (*Store)(nil)
	_ ports.FolderRepository   = (*Store)(nil)
	_ ports.WorkflowRepository = (*Store)(nil)
	_ ports.AgentRepository    = (*Store)(nil)
	_ ports.RunnerRepository   = (*Store)(nil)
	_ ports.UsageRepository    = (*Store)(nil)
	_ ports.ChangeLog          = (*Store)(nil)
)

func (f *Store) record(scope entities.ChangeScope, kind, boardID, flowNodeID, actor string, revision int64) {
	f.appendChange(entities.Change{
		Scope: scope, Kind: kind, BoardID: boardID, FlowNodeID: flowNodeID, Actor: actor, Revision: revision,
	})
}

// appendChange numbers a change, files it, and releases everybody waiting. Called with the lock
// held, which is what makes the sequence a sequence.
func (f *Store) appendChange(change entities.Change) {
	f.seq++
	change.Seq = f.seq
	change.At = time.Now()
	f.changes = append(f.changes, change)
	waiters := f.waiters
	f.waiters = nil
	for _, waiter := range waiters {
		close(waiter)
	}
}

func (f *Store) CreateBoard(_ context.Context, board *entities.Board, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, exists := f.folders[entities.BoardFolderScope][board.FolderID]; board.FolderID != "" && !exists {
		return entities.NotFoundf("board folder")
	}
	for _, held := range f.boards {
		if held.Name == board.Name {
			return entities.ErrNameTaken
		}
	}
	if _, taken := f.slugs[board.Slug]; taken {
		return entities.Conflictf("slug %q is taken", board.Slug)
	}
	copied := *board
	f.boards[board.ID] = &copied
	f.slugs[board.Slug] = board.ID
	f.record(entities.ScopeBoard, entities.ChangeCreated, board.ID, "", actor, board.Revision)
	return nil
}

func (f *Store) ListBoards(_ context.Context, filter ports.BoardFilter) ([]entities.Board, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.Board{}
	for _, board := range f.boards {
		if board.Archived() && !filter.IncludeArchived {
			continue
		}
		out = append(out, *board)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *Store) FindBoard(_ context.Context, id string) (*entities.Board, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.findBoardLocked(id)
}

func (f *Store) findBoardLocked(id string) (*entities.Board, error) {
	board, ok := f.boards[id]
	if !ok {
		return nil, entities.NotFoundf("board %s", id)
	}
	out := *board
	return &out, nil
}

func (f *Store) FindBoardBySlug(ctx context.Context, slug string) (*entities.Board, error) {
	f.mu.Lock()
	id, ok := f.slugs[slug]
	f.mu.Unlock()
	if !ok {
		return nil, entities.NotFoundf("board %q", slug)
	}
	return f.FindBoard(ctx, id)
}

func (f *Store) PatchBoard(_ context.Context, id string, patch entities.BoardPatch, expected *int64, actor string) (*entities.Board, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	board, ok := f.boards[id]
	if !ok {
		return nil, entities.NotFoundf("board %s", id)
	}
	if expected != nil && *expected != board.Revision {
		return nil, entities.Conflictf("board %s is at revision %d, not %d", id, board.Revision, *expected)
	}
	if patch.FolderID != nil {
		folderID := *patch.FolderID
		if _, exists := f.folders[entities.BoardFolderScope][folderID]; folderID != "" && !exists {
			return nil, entities.NotFoundf("board folder")
		}
		board.FolderID = folderID
	}
	if patch.Name != nil {
		board.Name = *patch.Name
	}
	if patch.Archive != nil {
		if *patch.Archive {
			board.ArchivedAt = time.Now()
		} else {
			board.ArchivedAt = time.Time{}
		}
	}
	board.Revision++
	f.record(entities.ScopeBoard, entities.ChangeUpdated, id, "", actor, board.Revision)
	return f.findBoardLocked(id)
}

func (f *Store) DeleteBoard(_ context.Context, id string, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	board, ok := f.boards[id]
	if !ok {
		return entities.NotFoundf("board %s", id)
	}
	delete(f.slugs, board.Slug)
	delete(f.boards, id)
	for tid, flowNode := range f.flowNodes {
		if flowNode.BoardID == id {
			delete(f.flowNodes, tid)
		}
	}
	for wid, workflow := range f.workflows {
		if workflow.BoardID == id {
			delete(f.workflows, wid)
		}
	}
	f.record(entities.ScopeBoard, entities.ChangeDeleted, id, "", actor, 0)
	return nil
}

// cloned is a copy of a row a caller may keep. The task and the spot hang off it by pointer, and
// handing those pointers out would let the next write reach into a board somebody is already
// holding — which a store backed by a database cannot do and this one must not either.
func cloned(flowNode *entities.FlowNode) entities.FlowNode {
	out := *flowNode
	out.Routes = slices.Clone(flowNode.Routes)
	out.People = slices.Clone(flowNode.People)
	if flowNode.Nexts != nil {
		out.Nexts = append([]string(nil), flowNode.Nexts...)
	}
	if flowNode.Task != nil {
		task := *flowNode.Task
		if flowNode.Task.Criteria != nil {
			task.Criteria = append([]entities.SuccessCriterion(nil), flowNode.Task.Criteria...)
		}
		if flowNode.Task.Complexity != nil {
			complexity := *flowNode.Task.Complexity
			task.Complexity = &complexity
		}
		out.Task = &task
	}
	if flowNode.Spot != nil {
		spot := *flowNode.Spot
		out.Spot = &spot
	}
	if flowNode.Size != nil {
		size := *flowNode.Size
		out.Size = &size
	}
	return out
}

func (f *Store) CreateFlowNodes(_ context.Context, flowNodes []*entities.FlowNode, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.validateNewFlowNodesLocked(flowNodes); err != nil {
		return err
	}
	f.insertFlowNodesLocked(flowNodes, actor)
	return nil
}

func (f *Store) validateNewFlowNodesLocked(flowNodes []*entities.FlowNode) error {
	held := make([]entities.FlowNode, 0, len(f.flowNodes))
	for _, n := range f.flowNodes {
		held = append(held, *n)
	}
	changes := make([]entities.FlowNode, 0, len(flowNodes))
	seen := make(map[string]bool, len(flowNodes))
	for _, n := range flowNodes {
		if seen[n.ID] || f.flowNodes[n.ID] != nil {
			return entities.Conflictf("flow node %s already exists", n.ID)
		}
		seen[n.ID] = true
		if err := n.ValidateRoutes(); err != nil {
			return err
		}
		changes = append(changes, *n)
	}
	if err := checkRoleIDs(held, changes); err != nil {
		return err
	}
	return entities.ValidateConnectionChanges(held, changes)
}

func checkRoleIDs(held, changes []entities.FlowNode) error {
	type roleKey struct{ board, id string }
	active := make(map[roleKey]string)
	for _, node := range held {
		if node.Type == entities.FlowNodeRole && !node.Archived && node.RoleID != "" {
			active[roleKey{node.BoardID, node.RoleID}] = node.ID
		}
	}
	for _, node := range changes {
		if node.Type != entities.FlowNodeRole || node.Archived || node.RoleID == "" {
			continue
		}
		key := roleKey{node.BoardID, node.RoleID}
		if id, found := active[key]; found && id != node.ID {
			return entities.Conflictf("a role with that ID already exists on this board")
		}
		active[key] = node.ID
	}
	return nil
}

func (f *Store) insertFlowNodesLocked(flowNodes []*entities.FlowNode, actor string) {
	for _, flowNode := range flowNodes {
		copied := cloned(flowNode)
		f.flowNodes[flowNode.ID] = &copied
		f.record(entities.ScopeFlowNode, entities.ChangeCreated, flowNode.BoardID, flowNode.ID, actor, flowNode.Revision)
	}
}

func (f *Store) FindFlowNode(_ context.Context, id string) (*entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	flowNode, ok := f.flowNodes[id]
	if !ok {
		return nil, entities.NotFoundf("flow node %s", id)
	}
	out := cloned(flowNode)
	return &out, nil
}

func (f *Store) ListFlowNodes(_ context.Context, boardID string) ([]entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.FlowNode{}
	for _, flowNode := range f.flowNodes {
		if flowNode.BoardID == boardID {
			one := cloned(flowNode)
			out = append(out, one)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *Store) PatchFlowNode(_ context.Context, id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.patchFlowNodeLocked(id, patch, expected, actor)
}

func (f *Store) patchFlowNodeLocked(id string, patch entities.FlowNodePatch, expected *int64, actor string) (*entities.FlowNode, error) {
	flowNode, ok := f.flowNodes[id]
	if !ok {
		return nil, entities.NotFoundf("flow node %s", id)
	}
	if expected != nil && *expected != flowNode.Revision {
		return nil, entities.Conflictf("flow node %s is at revision %d, not %d", id, flowNode.Revision, *expected)
	}
	changed := *flowNode
	if patch.Next != nil {
		changed.Next = *patch.Next
	}
	if patch.Nexts != nil {
		changed.Nexts = slices.Clone(*patch.Nexts)
	}
	if patch.Type != nil {
		changed.Type = *patch.Type
	}
	if patch.RoleID != nil {
		changed.RoleID = *patch.RoleID
	}
	if patch.Archived != nil {
		changed.Archived = *patch.Archived
	}
	if patch.Routes != nil {
		changed.Routes = slices.Clone(*patch.Routes)
		if err := changed.ValidateRoutes(); err != nil {
			return nil, err
		}
	} else if changed.Type != entities.FlowNodeExclusiveGateway {
		changed.Routes = nil
	} else if patch.Nexts != nil {
		changed.Routes = slices.DeleteFunc(slices.Clone(changed.Routes), func(route entities.Route) bool {
			return !slices.Contains(changed.Nexts, route.FlowNode)
		})
	}
	topologyChanged := patch.Next != nil || patch.Nexts != nil || patch.Type != nil
	roleChanged := changed.Type == entities.FlowNodeRole && (patch.RoleID != nil || patch.Type != nil || patch.Archived != nil)
	if topologyChanged || roleChanged {
		held := make([]entities.FlowNode, 0, len(f.flowNodes))
		for _, n := range f.flowNodes {
			held = append(held, *n)
		}
		if topologyChanged {
			if err := entities.ValidateConnectionChanges(held, []entities.FlowNode{changed}); err != nil {
				return nil, err
			}
		}
		if roleChanged {
			if err := checkRoleIDs(held, []entities.FlowNode{changed}); err != nil {
				return nil, err
			}
		}
	}
	if patch.Title != nil {
		flowNode.Title = *patch.Title
	}
	if patch.Note != nil {
		flowNode.Note = *patch.Note
	}
	if patch.Value != nil {
		flowNode.Value = *patch.Value
	}
	if patch.ValueType != nil {
		flowNode.ValueType = *patch.ValueType
	}
	if patch.RoleID != nil {
		flowNode.RoleID = changed.RoleID
	}
	if patch.RoleKind != nil {
		flowNode.RoleKind = *patch.RoleKind
	}
	if patch.People != nil {
		flowNode.People = slices.Clone(*patch.People)
	}
	if patch.Description != nil {
		flowNode.Description = *patch.Description
	}
	if patch.ClearOutput {
		flowNode.Output = ""
	}
	if patch.OutputType != nil {
		flowNode.OutputType = *patch.OutputType
	}
	if patch.Output != nil {
		flowNode.Output = *patch.Output
	}
	if patch.Type != nil {
		flowNode.Type = *patch.Type
	}
	if patch.Tags != nil {
		flowNode.Tags = *patch.Tags
	}
	if patch.ScheduledAt != nil {
		flowNode.ScheduledAt = *patch.ScheduledAt
	}
	if patch.Duration != nil {
		flowNode.Duration = *patch.Duration
	}
	if patch.PullRequestID != nil {
		flowNode.PullRequestID = *patch.PullRequestID
	}
	if patch.PullRequestStatus != nil {
		flowNode.PullRequestStatus = *patch.PullRequestStatus
	}
	if patch.CommitID != nil {
		flowNode.CommitID = *patch.CommitID
	}
	if patch.CommitStatus != nil {
		flowNode.CommitStatus = *patch.CommitStatus
	}
	if patch.MaxPasses != nil {
		flowNode.MaxPasses = *patch.MaxPasses
	}
	if patch.RemainingPasses != nil {
		flowNode.RemainingPasses = *patch.RemainingPasses
	}
	if patch.Status != nil {
		flowNode.Status = *patch.Status
		if flowNode.Status == entities.StatusDone {
			flowNode.Completion = f.seq + 1
		}
	}
	if patch.Archived != nil {
		flowNode.Archived = *patch.Archived
	}
	flowNode.Next, flowNode.Nexts, flowNode.Routes = changed.Next, changed.Nexts, changed.Routes
	if patch.WorkflowID != nil {
		flowNode.WorkflowID = *patch.WorkflowID
	}
	// The task appears and disappears with the type, as its row does in the database: a flow node
	// becoming an AI or a Human one is given an empty task, and one becoming a Shutdown or a
	// Scheduler gives it up. Replaced rather than written into, so a copy already handed out is
	// not changed under its holder.
	task := entities.Task{}
	if flowNode.Task != nil {
		task = *flowNode.Task
	} else {
		task = task.For(flowNode.Type)
	}
	if patch.Body != nil {
		task.Body = *patch.Body
	}
	if patch.MultiPartTemplate != nil {
		task.MultiPartTemplate = *patch.MultiPartTemplate
	}
	if patch.Criteria != nil {
		task.Criteria = append([]entities.SuccessCriterion(nil), *patch.Criteria...)
	}
	if patch.Complexity != nil {
		complexity := *patch.Complexity
		task.Complexity = &complexity
	}
	if patch.ClearComplexity {
		task.Complexity = nil
	}
	if patch.Settings != nil {
		task.Settings = *patch.Settings
	}
	if patch.ConversationID != nil {
		task.ConversationID = *patch.ConversationID
	}
	if patch.Transition != nil {
		task.Transition = *patch.Transition
	}
	if flowNode.Type.IsTask() {
		flowNode.Task = &task
	} else {
		flowNode.Task = nil
	}
	if patch.Spot != nil {
		spot := *patch.Spot
		flowNode.Spot = &spot
	}
	if patch.ClearSpot {
		flowNode.Spot = nil
	}
	if patch.Size != nil {
		size := *patch.Size
		flowNode.Size = &size
	}
	flowNode.Revision++
	f.record(entities.ScopeFlowNode, entities.ChangeUpdated, flowNode.BoardID, id, actor, flowNode.Revision)
	out := cloned(flowNode)
	return &out, nil
}

func (f *Store) DeleteFlowNodes(_ context.Context, ids []string, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, id := range ids {
		flowNode, ok := f.flowNodes[id]
		if !ok {
			continue
		}
		delete(f.flowNodes, id)
		// The flow node's spend goes with it, as the schema's ON DELETE CASCADE does it.
		for _, report := range f.usage[id] {
			delete(f.usageID, report.ID)
		}
		delete(f.usage, id)
		// A chain onto a deleted flow node is broken, as the schema's ON DELETE SET NULL does it —
		// and a branch naming one is taken out of the list, as its ON DELETE CASCADE does.
		for _, other := range f.flowNodes {
			if other.ValueType == id {
				other.ValueType = ""
			}
			if other.Next == id {
				other.Next = ""
			}
			if len(other.Nexts) > 0 {
				kept := make([]string, 0, len(other.Nexts))
				for _, next := range other.Nexts {
					if next != id {
						kept = append(kept, next)
					}
				}
				if len(kept) != len(other.Nexts) {
					other.Nexts = kept
					other.Routes = slices.DeleteFunc(other.Routes, func(route entities.Route) bool { return route.FlowNode == id })
				}
			}
		}
		f.record(entities.ScopeFlowNode, entities.ChangeDeleted, flowNode.BoardID, id, actor, 0)
	}
	return nil
}

func (f *Store) ClaimFlowNode(_ context.Context, id, runID string, status entities.FlowNodeStatus, actor string, afterPredecessor ...bool) (*entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	flowNode, ok := f.flowNodes[id]
	if !ok {
		return nil, entities.NotFoundf("flow node %s", id)
	}
	if flowNode.Type == entities.FlowNodeLimiter {
		return nil, entities.Invalidf("a limiter is played through its pass operation")
	}
	if flowNode.RunID != "" && flowNode.RunID != runID {
		return nil, entities.ErrFlowNodeHeld
	}
	if !flowNode.Status.CanClaim(flowNode.Type, flowNode.RunID == runID) {
		return nil, entities.Invalidf("the flow node stands at %q", flowNode.Status)
	}
	if flowNode.RunID != runID {
		if flowNode.Type == entities.FlowNodeGateway {
			replaying := flowNode.Status == entities.StatusDone && len(afterPredecessor) > 0 && afterPredecessor[0]
			for _, input := range f.flowNodes {
				if input.BoardID == flowNode.BoardID && !input.Archived && slices.Contains(input.Successors(), id) &&
					(input.Status != entities.StatusDone || (replaying && input.Completion <= flowNode.Completion)) {
					return nil, entities.ErrGatewayWaiting
				}
			}
		}
		flowNode.Output = ""
	}
	if flowNode.Status == entities.StatusDone && flowNode.Type == entities.FlowNodeAI && flowNode.Task != nil {
		task := *flowNode.Task
		task.ConversationID = ""
		flowNode.Task = &task
	}
	flowNode.RunID = runID
	if flowNode.ClaimedAt.IsZero() {
		flowNode.ClaimedAt = time.Now()
	}
	flowNode.Status = status
	flowNode.Revision++
	f.record(entities.ScopeFlowNode, entities.ChangeUpdated, flowNode.BoardID, id, actor, flowNode.Revision)
	out := cloned(flowNode)
	return &out, nil
}

func (f *Store) ReleaseFlowNode(_ context.Context, id, runID, actor string, result entities.PlayResult) (*entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	flowNode, ok := f.flowNodes[id]
	if !ok {
		return nil, entities.NotFoundf("flow node %s", id)
	}
	if flowNode.RunID != runID {
		return nil, entities.Conflictf("flow node %s is held by %q, not by %q", id, flowNode.RunID, runID)
	}
	if update := result.Workflow; update != nil {
		workflow := f.workflows[update.ID]
		if workflow == nil || flowNode.WorkflowID != update.ID {
			return nil, entities.Conflictf("flow node %s no longer belongs to workflow %s", id, update.ID)
		}
		if err := patchWorkflowValues(workflow, update.Values, nil); err != nil {
			return nil, err
		}
		workflow.Revision++
		f.recordWorkflow(entities.ChangeUpdated, workflow.BoardID, workflow.ID, actor, workflow.Revision)
	}
	flowNode.RunID = ""
	flowNode.ClaimedAt = time.Time{}
	flowNode.Status = result.Status
	if result.Status == entities.StatusDone {
		flowNode.Completion = f.seq + 1
	}
	flowNode.Output = result.Output
	flowNode.Revision++
	f.record(entities.ScopeFlowNode, entities.ChangeUpdated, flowNode.BoardID, id, actor, flowNode.Revision)
	out := cloned(flowNode)
	return &out, nil
}

func (f *Store) ReleaseRun(_ context.Context, runID string, status entities.FlowNodeStatus, actor string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	settled := 0
	for id, flowNode := range f.flowNodes {
		if flowNode.RunID != runID {
			continue
		}
		flowNode.RunID = ""
		flowNode.Status = status
		flowNode.Revision++
		settled++
		f.record(entities.ScopeFlowNode, entities.ChangeUpdated, flowNode.BoardID, id, actor, flowNode.Revision)
	}
	return settled, nil
}

func (f *Store) HeldFlowNodes(_ context.Context, runID string) ([]entities.FlowNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.FlowNode{}
	for _, flowNode := range f.flowNodes {
		if flowNode.RunID == runID {
			one := cloned(flowNode)
			out = append(out, one)
		}
	}
	return out, nil
}

// ── workflows ───────────────────────────────────────────────────────────────

func (f *Store) recordWorkflow(kind, boardID, workflowID, actor string, revision int64) {
	f.appendChange(entities.Change{
		Scope: entities.ScopeWorkflow, Kind: kind,
		BoardID: boardID, WorkflowID: workflowID, Actor: actor, Revision: revision,
	})
}

func (f *Store) CreateWorkflow(_ context.Context, workflow *entities.Workflow, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.insertWorkflowLocked(workflow, actor)
}

func (f *Store) CreateWorkflowWithFlowNodes(_ context.Context, workflow *entities.Workflow, flowNodes []*entities.FlowNode, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.validateNewFlowNodesLocked(flowNodes); err != nil {
		return err
	}
	if err := f.insertWorkflowLocked(workflow, actor); err != nil {
		return err
	}
	f.insertFlowNodesLocked(flowNodes, actor)
	return nil
}

func (f *Store) insertWorkflowLocked(workflow *entities.Workflow, actor string) error {
	if f.boards[workflow.BoardID] == nil {
		return entities.NotFoundf("board %s", workflow.BoardID)
	}
	if f.workflows[workflow.ID] != nil {
		return entities.Conflictf("workflow %s already exists", workflow.ID)
	}
	copied := *workflow
	copied.Files = slices.Clone(workflow.Files)
	f.workflows[workflow.ID] = &copied
	f.recordWorkflow(entities.ChangeCreated, workflow.BoardID, workflow.ID, actor, workflow.Revision)
	return nil
}

func (f *Store) FindWorkflow(_ context.Context, id string) (*entities.Workflow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	workflow, ok := f.workflows[id]
	if !ok {
		return nil, entities.NotFoundf("workflow %s", id)
	}
	out := *workflow
	out.Files = slices.Clone(workflow.Files)
	return &out, nil
}

func (f *Store) ListWorkflows(_ context.Context, boardID string) ([]entities.Workflow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.Workflow{}
	for _, workflow := range f.workflows {
		if workflow.BoardID == boardID {
			copy := *workflow
			copy.Files = slices.Clone(workflow.Files)
			out = append(out, copy)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *Store) PatchWorkflow(_ context.Context, id string, patch entities.WorkflowPatch, expected *int64, actor string) (*entities.Workflow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	workflow, ok := f.workflows[id]
	if !ok {
		return nil, entities.NotFoundf("workflow %s", id)
	}
	if expected != nil && *expected != workflow.Revision {
		return nil, entities.Conflictf("workflow %s is at revision %d, not %d", id, workflow.Revision, *expected)
	}
	if patch.ChangesValues() {
		if err := patchWorkflowValues(workflow, patch.SetValues, patch.RemoveValues); err != nil {
			return nil, err
		}
	}
	if patch.Name != nil {
		workflow.Name = *patch.Name
	}
	if patch.WorkflowFolder != nil {
		workflow.WorkflowFolder = *patch.WorkflowFolder
	}
	if patch.Files != nil {
		workflow.Files = slices.Clone(patch.Files)
	}
	workflow.Revision++
	f.recordWorkflow(entities.ChangeUpdated, workflow.BoardID, id, actor, workflow.Revision)
	out := *workflow
	out.Files = slices.Clone(workflow.Files)
	return &out, nil
}

func patchWorkflowValues(workflow *entities.Workflow, set map[string]json.RawMessage, remove []string) error {
	values := make(map[string]json.RawMessage)
	if workflow.Values != "" {
		if err := json.Unmarshal([]byte(workflow.Values), &values); err != nil {
			return err
		}
	}
	for _, field := range remove {
		delete(values, field)
	}
	maps.Copy(values, set)
	raw, err := json.Marshal(values)
	if err != nil {
		return err
	}
	workflow.Values = string(raw)
	return nil
}

func (f *Store) DeleteWorkflows(_ context.Context, ids []string, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, id := range ids {
		workflow, ok := f.workflows[id]
		if !ok {
			continue
		}
		delete(f.workflows, id)
		// The flow nodes are ungrouped, as the schema's ON DELETE SET NULL does it — and left
		// where they are.
		for _, flowNode := range f.flowNodes {
			if flowNode.WorkflowID == id {
				flowNode.WorkflowID = ""
			}
		}
		f.recordWorkflow(entities.ChangeDeleted, workflow.BoardID, id, actor, 0)
	}
	return nil
}

// ── agents ──────────────────────────────────────────────────────────────────

func (f *Store) recordAgent(kind, agentID, actor string, revision int64) {
	f.appendChange(entities.Change{
		Scope: entities.ScopeAgent, Kind: kind, AgentID: agentID, Actor: actor, Revision: revision,
	})
}

func (f *Store) CreateAgent(_ context.Context, agent *entities.Agent, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, held := range f.agents {
		if strings.EqualFold(held.Name, agent.Name) {
			return entities.ErrAgentNameTaken
		}
	}
	copied := *agent
	f.agents[agent.ID] = &copied
	f.recordAgent(entities.ChangeCreated, agent.ID, actor, agent.Revision)
	return nil
}

func (f *Store) ListAgents(_ context.Context) ([]entities.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.Agent{}
	for _, agent := range f.agents {
		out = append(out, *agent)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *Store) FindAgent(_ context.Context, id string) (*entities.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent, ok := f.agents[id]
	if !ok {
		return nil, entities.NotFoundf("agent %s", id)
	}
	out := *agent
	return &out, nil
}

func (f *Store) PatchAgent(_ context.Context, id string, patch entities.AgentPatch, expected *int64, actor string) (*entities.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent, ok := f.agents[id]
	if !ok {
		return nil, entities.NotFoundf("agent %s", id)
	}
	if expected != nil && *expected != agent.Revision {
		return nil, entities.Conflictf("agent %s is at revision %d, not %d", id, agent.Revision, *expected)
	}
	if patch.Name != nil {
		for otherID, held := range f.agents {
			if otherID != id && strings.EqualFold(held.Name, *patch.Name) {
				return nil, entities.ErrAgentNameTaken
			}
		}
		agent.Name = *patch.Name
	}
	if patch.ProfileID != nil {
		agent.ProfileID = *patch.ProfileID
	}
	if patch.Harness != nil {
		agent.Harness = *patch.Harness
	}
	if patch.Model != nil {
		agent.Model = *patch.Model
	}
	if patch.Instructions != nil {
		agent.Instructions = *patch.Instructions
	}
	if patch.Description != nil {
		agent.Description = *patch.Description
	}
	if patch.Archived != nil {
		agent.Archived = *patch.Archived
	}
	agent.Revision++
	f.recordAgent(entities.ChangeUpdated, id, actor, agent.Revision)
	out := *agent
	return &out, nil
}

func (f *Store) DeleteAgent(_ context.Context, id string, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.agents[id]; !ok {
		return entities.NotFoundf("agent %s", id)
	}
	if f.agents[id].Published != nil {
		return entities.Invalidf("published agents retain their history; archive this agent instead")
	}
	delete(f.agents, id)
	// The flow nodes naming it are left as they are: they still say which agent they wanted, and the
	// next play says it is gone.
	f.recordAgent(entities.ChangeDeleted, id, actor, 0)
	return nil
}

func (f *Store) PublishAgent(_ context.Context, id string, expected *int64, at time.Time, actor string) (*entities.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent, ok := f.agents[id]
	if !ok {
		return nil, entities.NotFoundf("agent %s", id)
	}
	if expected != nil && *expected != agent.Revision {
		return nil, entities.Conflictf("agent %s is at revision %d", id, agent.Revision)
	}
	if agent.Archived {
		return nil, entities.Invalidf("an archived agent cannot be published")
	}
	version := agent.Publish(int64(len(f.agentVersions[id])+1), at)
	f.agentVersions[id] = append(f.agentVersions[id], version)
	agent.Published = &version
	agent.Revision++
	agent.UpdatedAt = at
	f.recordAgent(entities.ChangeUpdated, id, actor, agent.Revision)
	out := *agent
	return &out, nil
}

func (f *Store) AgentVersions(_ context.Context, id string) ([]entities.AgentVersion, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]entities.AgentVersion{}, f.agentVersions[id]...), nil
}

// ── runners ─────────────────────────────────────────────────────────────────

func (f *Store) recordRunner(kind, runnerID, actor string, revision int64) {
	f.appendChange(entities.Change{
		Scope: entities.ScopeRunner, Kind: kind, RunnerID: runnerID, Actor: actor, Revision: revision,
	})
}

func (f *Store) CreateRunner(_ context.Context, runner *entities.Runner, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, held := range f.runners {
		if strings.EqualFold(held.Name, runner.Name) {
			return entities.ErrRunnerNameTaken
		}
	}
	copied := *runner
	f.runners[runner.ID] = &copied
	f.recordRunner(entities.ChangeCreated, runner.ID, actor, runner.Revision)
	return nil
}

func (f *Store) ListRunners(_ context.Context) ([]entities.Runner, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.Runner{}
	for _, runner := range f.runners {
		out = append(out, *runner)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *Store) FindRunner(_ context.Context, id string) (*entities.Runner, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	runner, ok := f.runners[id]
	if !ok {
		return nil, entities.NotFoundf("runner %s", id)
	}
	out := *runner
	return &out, nil
}

func (f *Store) PatchRunner(_ context.Context, id string, patch entities.RunnerPatch, expected *int64, actor string) (*entities.Runner, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	runner, ok := f.runners[id]
	if !ok {
		return nil, entities.NotFoundf("runner %s", id)
	}
	if expected != nil && *expected != runner.Revision {
		return nil, entities.Conflictf("runner %s is at revision %d, not %d", id, runner.Revision, *expected)
	}
	if patch.Name != nil {
		for otherID, held := range f.runners {
			if otherID != id && strings.EqualFold(held.Name, *patch.Name) {
				return nil, entities.ErrRunnerNameTaken
			}
		}
		runner.Name = *patch.Name
	}
	runner.Revision++
	f.recordRunner(entities.ChangeUpdated, id, actor, runner.Revision)
	out := *runner
	return &out, nil
}

func (f *Store) DeleteRunner(_ context.Context, id string, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.runners[id]; !ok {
		return entities.NotFoundf("runner %s", id)
	}
	delete(f.runners, id)
	// The tasks naming it are left as they are: they still say which runner they wanted, and the
	// next play says it is gone.
	f.recordRunner(entities.ChangeDeleted, id, actor, 0)
	return nil
}

// Heartbeat stamps last seen with now, and nothing else: like the database's row, it moves
// neither the revision — a rename would otherwise race it — nor the change feed, which no client
// redraws a heartbeat on.
func (f *Store) Heartbeat(_ context.Context, id string, now time.Time, _ string) (*entities.Runner, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	runner, ok := f.runners[id]
	if !ok {
		return nil, entities.NotFoundf("runner %s", id)
	}
	runner.LastSeen = &now
	out := *runner
	return &out, nil
}

// ── what the AI flow nodes spent ─────────────────────────────────────────────────────

func (f *Store) RecordUsage(_ context.Context, usage *entities.TaskUsage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// The same id twice is the same report twice: the first write wins, and no change is
	// recorded either way — a usage write moves nothing but its own row.
	if f.usageID[usage.ID] {
		return nil
	}
	f.usageID[usage.ID] = true
	copied := *usage
	f.usage[usage.FlowNodeID] = append(f.usage[usage.FlowNodeID], copied)
	return nil
}

func (f *Store) UsageTotals(_ context.Context, flowNodeID string) (entities.TaskUsageTotals, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var totals entities.TaskUsageTotals
	var cost int64
	var priced bool
	for _, report := range f.usage[flowNodeID] {
		totals.Reports++
		totals.InputTokens += report.InputTokens
		totals.OutputTokens += report.OutputTokens
		totals.CacheReadTokens += report.CacheReadTokens
		totals.CacheWriteTokens += report.CacheWriteTokens
		totals.ReasoningTokens += report.ReasoningTokens
		if report.CostUsdMicros != nil {
			cost += *report.CostUsdMicros
			priced = true
		}
	}
	if priced {
		totals.CostUsdMicros = &cost
	}
	return totals, nil
}

// ── the change log ────────────────────────────────────────────────────────────

func (f *Store) Since(_ context.Context, seq int64, boardID string, limit int) ([]entities.Change, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if limit <= 0 {
		limit = 500
	}
	out := []entities.Change{}
	for _, change := range f.changes {
		if change.Seq <= seq {
			continue
		}
		if boardID != "" && change.BoardID != boardID {
			continue
		}
		out = append(out, change)
		if len(out) >= limit {
			break
		}
	}
	return out, f.seq, nil
}

func (f *Store) Latest(_ context.Context) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.seq, nil
}

func (f *Store) Await(ctx context.Context, seq int64) bool {
	f.mu.Lock()
	if f.seq > seq {
		f.mu.Unlock()
		return true
	}
	waiter := make(chan struct{})
	f.waiters = append(f.waiters, waiter)
	f.mu.Unlock()
	select {
	case <-ctx.Done():
		return false
	case <-waiter:
		return true
	}
}

func (f *Store) ListSchemaValues(_ context.Context) ([]entities.SchemaValue, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []entities.SchemaValue{}
	for _, node := range f.flowNodes {
		board := f.boards[node.BoardID]
		if node.IsSchemaValue() && !node.Archived && board != nil && !board.Archived() {
			out = append(out, entities.SchemaValue{ID: node.ID, Title: node.Title, Value: node.Value, BoardSlug: board.Slug, BoardName: board.Name})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].BoardName != out[j].BoardName {
			return out[i].BoardName < out[j].BoardName
		}
		if out[i].Title != out[j].Title {
			return out[i].Title < out[j].Title
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (f *Store) OutputTypeUsed(_ context.Context, id string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, node := range f.flowNodes {
		if node.OutputType == id {
			return true, nil
		}
	}
	return false, nil
}
