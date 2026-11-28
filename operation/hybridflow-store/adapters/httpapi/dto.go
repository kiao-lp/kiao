// Package httpapi is the HTTP adapter: the core's services published as a JSON API.
//
// The DTOs are **the wire, and not the entities**. They are written out rather than shared with
// core/entities for the reason every hexagonal boundary is: the wire is a contract with clients
// that are deployed separately from this binary — Dashboard in a browser cache, worker on the
// same machine but built at another time — so a field renamed in the domain must be a deliberate
// act on the wire and not a consequence.
//
// The field names are camelCase, which is what `reference/kiao-worker` types are written in and
// what every other DCMS payload uses.
package httpapi

import (
	"encoding/json"
	"time"

	"kiao/hybridflow-store/core/entities"
)

// BoardDto is a board in a listing: what it is called, where it lives, and nothing on it.
type BoardDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Slug is the handle a URL carries. `/dashboard/boards/<slug>` is the board's address.
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Revision  int64     `json:"revision"`
	Archived  bool      `json:"archived"`
	FolderID  string    `json:"folderId,omitempty"`
}

func boardDto(board entities.Board) BoardDto {
	return BoardDto{
		ID: board.ID, Name: board.Name, Slug: board.Slug,
		CreatedAt: board.CreatedAt, UpdatedAt: board.UpdatedAt,
		Revision: board.Revision, Archived: board.Archived(),
		FolderID: board.FolderID,
	}
}

// SettingsDto is what a turn is run with.
type SettingsDto struct {
	Agent      string `json:"agent,omitempty"`
	Harness    string `json:"harness,omitempty"`
	ProfileID  string `json:"profileId,omitempty"`
	Model      string `json:"model,omitempty"`
	Effort     string `json:"effort,omitempty"`
	Permission string `json:"permission,omitempty"`
	Folder     string `json:"folder,omitempty"`
	// Runner is which runner plays the task — a runner's id, or absent for wherever a Play is
	// pressed. A pin rather than a setting a turn is run with, but one the task says beside them.
	Runner string            `json:"runner,omitempty"`
	Extra  map[string]string `json:"extra,omitempty"`
}

// SuccessDto holds successor IDs and the AI task's conversation handoff settings.
type SuccessDto struct {
	FlowNode string `json:"flowNode,omitempty"`
	// FlowNodes are the parallel successors of a Gateway, in branch order.
	FlowNodes []string `json:"flowNodes,omitempty"`
	Mode      string   `json:"mode,omitempty"`
	// Compact is absent for false, which is what every client that has never heard of it says.
	Compact bool `json:"compact,omitempty"`
}

// CriterionDto is one success criterion: what the work is done when, under the id the editor
// gave it.
type CriterionDto struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// SpotDto is where a card sits on the board.
type SpotDto struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// SizeDto is how large a card is drawn. H zero keeps the card's natural height.
type SizeDto struct {
	W int `json:"w"`
	H int `json:"h,omitempty"`
}

// FlowNodeDto is one board element with one revision for conditional writes.
// For AI and Human nodes it includes the task fields in the same object.
type FlowNodeDto struct {
	NewFlowNodeDto
	Output json.RawMessage `json:"output,omitempty"`
	// Run identifies the current holder so clients can show the claim and suppress Play.
	Run        string    `json:"run,omitempty"`
	Completion int64     `json:"completion,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	// Revision is what a client sends back in `If-Match` to make its next write conditional. A
	// client that sends none is saying "whatever it says now", which is what a run's status write
	// means and what a person's rename does not.
	Revision int64 `json:"revision"`
}

func newFlowNodeDto(flowNode entities.FlowNode) NewFlowNodeDto {
	dto := NewFlowNodeDto{
		ID: flowNode.ID, Title: flowNode.Title, Type: string(flowNode.Type),
		OutputType: flowNode.OutputType,
		Tags:       flowNode.Tags, Note: flowNode.Note, ValueType: flowNode.ValueType, At: flowNode.ScheduledAt, Duration: flowNode.Duration, Status: string(flowNode.Status),
		RoleID: flowNode.RoleID, RoleKind: flowNode.RoleKind, People: flowNode.People, Description: flowNode.Description,
		PullRequestID: flowNode.PullRequestID, PullRequestStatus: flowNode.PullRequestStatus,
		CommitID: flowNode.CommitID, CommitStatus: flowNode.CommitStatus,
		Archived: flowNode.Archived,
		Workflow: flowNode.WorkflowID,
		Routes:   flowNode.Routes,
	}
	if flowNode.Value != "" {
		dto.Value = json.RawMessage(flowNode.Value)
	}
	if flowNode.Type == entities.FlowNodeLimiter {
		dto.MaxPasses, dto.RemainingPasses = &flowNode.MaxPasses, &flowNode.RemainingPasses
	}
	transition := entities.Transition{Mode: entities.TransitionModeDefault}
	if task := flowNode.Task; task != nil {
		dto.Body, dto.Chat, transition = task.Body, task.ConversationID, task.Transition
		dto.MultiPartTemplate = task.MultiPartTemplate
		dto.Criteria = criteriaDto(task.Criteria)
		dto.Complexity = task.Complexity
		if !task.Settings.Empty() || len(task.Settings.Extra) > 0 {
			dto.Settings = &SettingsDto{
				Agent: task.Settings.Agent, Harness: task.Settings.Harness, ProfileID: task.Settings.ProfileID,
				Model: task.Settings.Model, Effort: task.Settings.Effort,
				Permission: task.Settings.Permission, Folder: task.Settings.Folder,
				Runner: task.Settings.Runner, Extra: task.Settings.Extra,
			}
		}
	}
	if flowNode.Spot != nil {
		dto.Spot = &SpotDto{X: flowNode.Spot.X, Y: flowNode.Spot.Y}
	}
	if flowNode.Size != nil {
		dto.Size = &SizeDto{W: flowNode.Size.W, H: flowNode.Size.H}
	}
	if flowNode.Next != "" || len(flowNode.Nexts) > 0 ||
		transition.Mode != entities.TransitionModeDefault || transition.Compact {
		dto.OnSuccess = &SuccessDto{
			FlowNode: flowNode.Next, FlowNodes: flowNode.Nexts,
			Mode: string(transition.Mode), Compact: transition.Compact,
		}
	}
	return dto
}

func flowNodeDto(flowNode entities.FlowNode) FlowNodeDto {
	dto := FlowNodeDto{
		NewFlowNodeDto: newFlowNodeDto(flowNode),
		Output:         json.RawMessage(flowNode.Output), Run: flowNode.RunID, Completion: flowNode.Completion,
		CreatedAt: flowNode.CreatedAt, UpdatedAt: flowNode.UpdatedAt, Revision: flowNode.Revision,
	}
	return dto
}

// BoardDetailDto is a whole board: the board, its flow nodes and its workflows. One call,
// because a board is drawn all at once.
type BoardDetailDto struct {
	Board     BoardDto      `json:"board"`
	FlowNodes []FlowNodeDto `json:"flowNodes"`
	// Workflows are the board's workflows: the names round the sets of flow nodes.
	Workflows []WorkflowDto `json:"workflows"`
	// Cursor is the change-log sequence number this board was read at. A client holds it and asks
	// `GET /changes?since=<cursor>` — so there is no window between the read and the watch in which
	// a change could be missed.
	Cursor int64 `json:"cursor"`
}

// NewBoardRequestDto creates a board.
type NewBoardRequestDto struct {
	Name     string `json:"name"`
	FolderID string `json:"folderId,omitempty"`
}

// BoardPatchDto changes the board itself.
type BoardPatchDto struct {
	Name     *string `json:"name,omitempty"`
	Archive  *bool   `json:"archive,omitempty"`
	FolderID *string `json:"folderId,omitempty"`
}

// criteriaDto is the criteria a task holds, as the wire carries them: the pair the editor
// added, in the order the task holds them. Empty is absent, which is what every client that has
// never heard of them says.
func criteriaDto(criteria []entities.SuccessCriterion) []CriterionDto {
	out := make([]CriterionDto, 0, len(criteria))
	for _, criterion := range criteria {
		out = append(out, CriterionDto{ID: criterion.ID, Text: criterion.Text})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// criteriaOf reads the criteria a request describes. Minting a missing id is the service's, so
// what arrives here is carried as said.
func criteriaOf(dtos []CriterionDto) []entities.SuccessCriterion {
	out := make([]entities.SuccessCriterion, 0, len(dtos))
	for _, dto := range dtos {
		out = append(out, entities.SuccessCriterion{ID: dto.ID, Text: dto.Text})
	}
	return out
}

// NewFlowNodeDto accepts a client-generated ID for immediate rendering and links within a pasted
// batch. The service assigns an ID when the client omits it.
type NewFlowNodeDto struct {
	ID         string          `json:"id,omitempty"`
	Title      string          `json:"title"`
	Type       string          `json:"type,omitempty"`
	Tags       []string        `json:"tags,omitempty"`
	Note       string          `json:"note,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	ValueType  string          `json:"valueType,omitempty"`
	OutputType string          `json:"outputType,omitempty"`
	Body       string          `json:"body,omitempty"`
	Criteria   []CriterionDto  `json:"criteria,omitempty"`
	Complexity *int            `json:"complexity,omitempty"`
	Settings   *SettingsDto    `json:"settings,omitempty"`
	At         string          `json:"at,omitempty"`
	Duration   string          `json:"duration,omitempty"`
	Spot       *SpotDto        `json:"spot,omitempty"`
	Size       *SizeDto        `json:"size,omitempty"`
	Status     string          `json:"status,omitempty"`
	Archived   bool            `json:"archived,omitempty"`
	Chat       string          `json:"chat,omitempty"`

	RoleID      string            `json:"roleId,omitempty"`
	RoleKind    entities.RoleKind `json:"roleKind,omitempty"`
	People      []string          `json:"people,omitempty"`
	Description string            `json:"description,omitempty"`

	PullRequestID     string `json:"pullRequestId,omitempty"`
	PullRequestStatus string `json:"pullRequestStatus,omitempty"`
	CommitID          string `json:"commitId,omitempty"`
	CommitStatus      string `json:"commitStatus,omitempty"`
	MaxPasses         *int   `json:"maxPasses,omitempty"`
	RemainingPasses   *int   `json:"remainingPasses,omitempty"`
	// OnSuccess is applied after insertion so it can link flow nodes in the same batch.
	OnSuccess *SuccessDto      `json:"onSuccess,omitempty"`
	Routes    []entities.Route `json:"routes,omitempty"`
	// Workflow is the optional ID of the group this flow node joins on the board.
	Workflow string `json:"workflow,omitempty"`

	MultiPartTemplate bool `json:"multiPartTemplate,omitempty"`
}

// NewFlowNodesRequestDto creates flow nodes in one batch, for example on paste.
type NewFlowNodesRequestDto struct {
	FlowNodes []NewFlowNodeDto `json:"flowNodes"`
}

// FlowNodePatchDto changes the fields it names and no others — which is the whole concurrency story
// on the wire. A run sends `{"status": "done"}`; the person typing sends `{"title": "…"}`.
//
// The field that can be *cleared* needs saying twice, because JSON has no way to tell an absent
// key from one set to nothing once null is taken: `clearSpot` clears the saved position.
type FlowNodePatchDto struct {
	Title      *string         `json:"title,omitempty"`
	Note       *string         `json:"note,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	ValueType  *string         `json:"valueType,omitempty"`
	OutputType *string         `json:"outputType,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Type       *string         `json:"type,omitempty"`
	Tags       *[]string       `json:"tags,omitempty"`
	Body       *string         `json:"body,omitempty"`
	Criteria   *[]CriterionDto `json:"criteria,omitempty"`
	// Complexity replaces the task's estimation; ClearComplexity takes it off, which a
	// Complexity of nil cannot say.
	Complexity      *int              `json:"complexity,omitempty"`
	ClearComplexity bool              `json:"clearComplexity,omitempty"`
	Settings        *SettingsDto      `json:"settings,omitempty"`
	At              *string           `json:"at,omitempty"`
	Duration        *string           `json:"duration,omitempty"`
	Status          *string           `json:"status,omitempty"`
	Archived        *bool             `json:"archived,omitempty"`
	OnSuccess       *SuccessDto       `json:"onSuccess,omitempty"`
	Routes          *[]entities.Route `json:"routes,omitempty"`
	Chat            *string           `json:"chat,omitempty"`
	Spot            *SpotDto          `json:"spot,omitempty"`
	ClearSpot       bool              `json:"clearSpot,omitempty"`
	Size            *SizeDto          `json:"size,omitempty"`

	RoleID      *string            `json:"roleId,omitempty"`
	RoleKind    *entities.RoleKind `json:"roleKind,omitempty"`
	People      *[]string          `json:"people,omitempty"`
	Description *string            `json:"description,omitempty"`

	PullRequestID     *string `json:"pullRequestId,omitempty"`
	PullRequestStatus *string `json:"pullRequestStatus,omitempty"`
	CommitID          *string `json:"commitId,omitempty"`
	CommitStatus      *string `json:"commitStatus,omitempty"`
	MaxPasses         *int    `json:"maxPasses,omitempty"`
	ResetPasses       bool    `json:"resetPasses,omitempty"`
	// Workflow groups the flow node in the workflow it names — one of this board — or takes
	// it out with the empty string.
	Workflow *string `json:"workflow,omitempty"`

	MultiPartTemplate *bool `json:"multiPartTemplate,omitempty"`
}

// WorkflowDto holds a workflow's configuration. Its flow nodes carry their membership.
type WorkflowDto struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Values         json.RawMessage `json:"values,omitempty"`
	WorkflowFolder string          `json:"workflowFolder,omitempty"`
	Files          []string        `json:"files,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	Revision       int64           `json:"revision"`
}

func workflowDto(workflow entities.Workflow) WorkflowDto {
	return WorkflowDto{
		ID: workflow.ID, Name: workflow.Name, Values: json.RawMessage(workflow.Values),
		WorkflowFolder: workflow.WorkflowFolder, Files: workflow.Files,
		CreatedAt: workflow.CreatedAt, UpdatedAt: workflow.UpdatedAt, Revision: workflow.Revision,
	}
}

// NewWorkflowRequestDto accepts an optional client-generated ID and the group's initial members.
type NewWorkflowRequestDto struct {
	ID             string   `json:"id,omitempty"`
	Name           string   `json:"name,omitempty"`
	WorkflowFolder string   `json:"workflowFolder,omitempty"`
	Files          []string `json:"files,omitempty"`
	// FlowNodes contains the IDs of board elements to move into this workflow.
	FlowNodes []string `json:"flowNodes,omitempty"`
}

// WorkflowPatchDto replaces supplied fields and applies top-level changes to shared values.
type WorkflowPatchDto struct {
	Name           *string                    `json:"name,omitempty"`
	WorkflowFolder *string                    `json:"workflowFolder,omitempty"`
	Files          []string                   `json:"files,omitzero"`
	SetValues      map[string]json.RawMessage `json:"setValues,omitempty"`
	RemoveValues   []string                   `json:"removeValues,omitempty"`
}

// DeleteWorkflowsRequestDto removes workflows. Their flow nodes are ungrouped and left where they
// are.
type DeleteWorkflowsRequestDto struct {
	Workflows []string `json:"workflows"`
}

// ChainRequestDto links a flow node to the one played after it; an empty target takes the link off.
// On a Gateway the target is added to its branches, and an empty one takes them all off.
type ChainRequestDto struct {
	FlowNode string `json:"flowNode"`
}

// DeleteFlowNodesRequestDto removes flow nodes.
type DeleteFlowNodesRequestDto struct {
	FlowNodes []string `json:"flowNodes"`
}

// PlayRequestDto takes a flow node for a run.
type PlayRequestDto struct {
	Run              string `json:"run"`
	AgentPackage     bool   `json:"agentPackage"`
	AfterPredecessor bool   `json:"afterPredecessor"`
}

// PlayedRequestDto hands a flow node back with what the play ended on.
type PlayedRequestDto struct {
	Output   json.RawMessage    `json:"output,omitempty"`
	Run      string             `json:"run"`
	Status   string             `json:"status"`
	Workflow *WorkflowUpdateDto `json:"workflow,omitempty"`
}

type WorkflowUpdateDto struct {
	ID     string                     `json:"id"`
	Values map[string]json.RawMessage `json:"values"`
}

type PassLimiterRequestDto struct {
	Revision int64           `json:"revision"`
	Output   json.RawMessage `json:"output,omitempty"`
}

type PassLimiterResponseDto struct {
	FlowNode  FlowNodeDto `json:"flowNode"`
	Successor string      `json:"successor"`
}

// ChangeDto is one thing that happened.
type ChangeDto struct {
	Seq      int64     `json:"seq"`
	At       time.Time `json:"at"`
	Scope    string    `json:"scope"`
	Kind     string    `json:"kind"`
	Board    string    `json:"board,omitempty"`
	FlowNode string    `json:"flowNode,omitempty"`
	Agent    string    `json:"agent,omitempty"`
	Runner   string    `json:"runner,omitempty"`
	// Workflow is set for a change to a workflow.
	Workflow string `json:"workflow,omitempty"`
	Actor    string `json:"actor,omitempty"`
	Revision int64  `json:"revision,omitempty"`
}

// AgentDto is one managed agent: the named definition of what plays a flow node.
type AgentDto struct {
	DraftError string                 `json:"draftError,omitempty"`
	Repository string                 `json:"repository,omitempty"`
	Effort     string                 `json:"effort,omitempty"`
	Archived   bool                   `json:"archived"`
	Published  *entities.AgentVersion `json:"published,omitempty"`
	ID         string                 `json:"id"`
	// Name is what the flow node editor shows in its select and what the panel lists.
	Name string `json:"name"`
	// Harness selects which tool executes the agent's turns.
	Harness   string `json:"harness"`
	ProfileID string `json:"profileId,omitempty"`
	// Model is the requested model. Empty uses the harness default.
	Model string `json:"model,omitempty"`
	// Description helps choose the agent for a task; it is never sent to its turns.
	Description string `json:"description,omitempty"`
	// Instructions are the standing orders the agent's turns are given, beside the prompt.
	Instructions string    `json:"instructions,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Revision     int64     `json:"revision"`
}

func agentDto(agent entities.Agent) AgentDto {
	return AgentDto{
		Archived: agent.Archived, Published: agent.Published, Repository: agent.Repository, Effort: agent.Effort, DraftError: agent.DraftError,
		ID: agent.ID, Name: agent.Name, Harness: string(agent.Harness),
		ProfileID: agent.ProfileID, Model: agent.Model, Instructions: agent.Instructions,
		Description: agent.Description,
		CreatedAt:   agent.CreatedAt, UpdatedAt: agent.UpdatedAt, Revision: agent.Revision,
	}
}

// NewAgentRequestDto files an agent. The id is minted by the service: nothing draws an agent
// before it exists, so unlike a flow node's it is never the client's to choose.
type NewAgentRequestDto struct {
	Effort       string `json:"effort,omitempty"`
	Name         string `json:"name"`
	Harness      string `json:"harness"`
	ProfileID    string `json:"profileId,omitempty"`
	Model        string `json:"model,omitempty"`
	Description  string `json:"description,omitempty"`
	Instructions string `json:"instructions,omitempty"`
}

// AgentPatchDto changes the fields it names and no others.
type AgentPatchDto struct {
	Effort       *string `json:"effort,omitempty"`
	Archived     *bool   `json:"archived,omitempty"`
	Name         *string `json:"name,omitempty"`
	Harness      *string `json:"harness,omitempty"`
	ProfileID    *string `json:"profileId,omitempty"`
	Model        *string `json:"model,omitempty"`
	Description  *string `json:"description,omitempty"`
	Instructions *string `json:"instructions,omitempty"`
}

// RunnerDto is one runner: a machine that plays flow nodes.
type RunnerDto struct {
	ID string `json:"id"`
	// Name is what the task editor shows in its select and what the panel lists.
	Name string `json:"name"`
	// LastSeen is when the runner last said it was alive, or absent for one that never has.
	LastSeen  *time.Time `json:"lastSeen,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Revision  int64      `json:"revision"`
}

func runnerDto(runner entities.Runner) RunnerDto {
	return RunnerDto{
		ID: runner.ID, Name: runner.Name, LastSeen: runner.LastSeen,
		CreatedAt: runner.CreatedAt, UpdatedAt: runner.UpdatedAt, Revision: runner.Revision,
	}
}

// NewRunnerRequestDto files a runner. The id is minted by the service: nothing draws a runner
// before it exists, so unlike a flow node's it is never the client's to choose.
type NewRunnerRequestDto struct {
	Name string `json:"name"`
}

// RunnerPatchDto changes the fields it names and no others.
type RunnerPatchDto struct {
	Name *string `json:"name,omitempty"`
}

// ChangesDto is what the watch endpoint answers: what happened, and where the client now stands.
type ChangesDto struct {
	Changes []ChangeDto `json:"changes"`
	// Cursor is what to send as `since` next time. It is the latest the log holds and not the last
	// change in the page, so a client whose page was truncated knows to ask again at once.
	Cursor int64 `json:"cursor"`
	// More says the page was truncated.
	More bool `json:"more"`
}

// SettleRunResponseDto reports what a restart freed.
type SettleRunResponseDto struct {
	Settled int `json:"settled"`
}

// SchemaDto is the schema's history: every migration this database has run, in order. It is served
// because "which version is that instance on?" is a question asked of a running service, not of a
// binary somebody has to find first.
type SchemaDto struct {
	Version    int            `json:"version"`
	Migrations []MigrationDto `json:"migrations"`
}

// MigrationDto is one line of the ledger.
type MigrationDto struct {
	Version    int       `json:"version"`
	Name       string    `json:"name"`
	Checksum   string    `json:"checksum"`
	AppliedAt  time.Time `json:"appliedAt"`
	DurationMs int       `json:"durationMs"`
}

// RecordUsageRequestDto records the cost of a turn or play for an AI task.
//
// The id is the reporter's to mint: a spool replay re-sends the same row, and the second
// insert lands on nothing. Empty is minted here, which a replay then cannot name again.
type RecordUsageRequestDto struct {
	ID               string          `json:"id,omitempty"`
	Run              string          `json:"run,omitempty"`
	Model            string          `json:"model,omitempty"`
	ReportedAt       *time.Time      `json:"reportedAt,omitempty"`
	InputTokens      int64           `json:"inputTokens,omitempty"`
	OutputTokens     int64           `json:"outputTokens,omitempty"`
	CacheReadTokens  int64           `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64           `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64           `json:"reasoningTokens,omitempty"`
	CostUsdMicros    *int64          `json:"costUsdMicros,omitempty"`
	Extra            json.RawMessage `json:"extra,omitempty"`
}

// TaskUsageDto is one filed report, as the store holds it.
type TaskUsageDto struct {
	ID               string          `json:"id"`
	Run              string          `json:"run,omitempty"`
	Model            string          `json:"model,omitempty"`
	ReportedAt       time.Time       `json:"reportedAt"`
	InputTokens      int64           `json:"inputTokens"`
	OutputTokens     int64           `json:"outputTokens"`
	CacheReadTokens  int64           `json:"cacheReadTokens"`
	CacheWriteTokens int64           `json:"cacheWriteTokens"`
	ReasoningTokens  int64           `json:"reasoningTokens"`
	CostUsdMicros    *int64          `json:"costUsdMicros,omitempty"`
	Extra            json.RawMessage `json:"extra,omitempty"`
}

func taskUsageDto(usage entities.TaskUsage) TaskUsageDto {
	return TaskUsageDto{
		ID: usage.ID, Run: usage.RunID, Model: usage.Model, ReportedAt: usage.ReportedAt,
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
		CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
		ReasoningTokens: usage.ReasoningTokens, CostUsdMicros: usage.CostUsdMicros,
		Extra: usage.Extra,
	}
}

// UsageTotalsDto is what one flow node spent, whole: the sums of its reports. The cost is absent
// where no report priced itself — unknown, never zero.
type UsageTotalsDto struct {
	Reports          int64  `json:"reports"`
	InputTokens      int64  `json:"inputTokens"`
	OutputTokens     int64  `json:"outputTokens"`
	CacheReadTokens  int64  `json:"cacheReadTokens"`
	CacheWriteTokens int64  `json:"cacheWriteTokens"`
	ReasoningTokens  int64  `json:"reasoningTokens"`
	CostUsdMicros    *int64 `json:"costUsdMicros,omitempty"`
}

func usageTotalsDto(totals entities.TaskUsageTotals) UsageTotalsDto {
	return UsageTotalsDto{
		Reports:     totals.Reports,
		InputTokens: totals.InputTokens, OutputTokens: totals.OutputTokens,
		CacheReadTokens: totals.CacheReadTokens, CacheWriteTokens: totals.CacheWriteTokens,
		ReasoningTokens: totals.ReasoningTokens, CostUsdMicros: totals.CostUsdMicros,
	}
}

type SchemaValueDto struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Value     json.RawMessage `json:"value"`
	BoardSlug string          `json:"boardSlug"`
	BoardName string          `json:"boardName"`
}
