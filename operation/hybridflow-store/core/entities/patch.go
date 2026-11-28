package entities

// FlowNodePatch updates only named fields, preserving concurrent writes to other columns.
// The flow node revision guards conflicts, including task fields stored in a separate row.
// Nil leaves a field unchanged; ClearSpot and ClearComplexity explicitly clear values.
type FlowNodePatch struct {
	Title       *string
	Note        *string
	Value       *string
	ValueType   *string
	RoleID      *string
	RoleKind    *RoleKind
	People      *[]string
	Description *string
	ClearOutput bool
	OutputType  *string
	Output      *string
	Type        *FlowNodeType
	// Tags replaces the whole ordered set.
	Tags        *[]string
	ScheduledAt *string
	Duration    *string
	Status      *FlowNodeStatus

	PullRequestID     *string
	PullRequestStatus *string
	CommitID          *string
	CommitStatus      *string
	MaxPasses         *int
	RemainingPasses   *int
	ResetPasses       bool
	// Next set to an empty string breaks the chain.
	Next *string
	// Nexts replaces all Gateway branches; ignored for other types.
	Nexts *[]string
	// Routes replaces the ordered conditions on an exclusive gateway.
	Routes    *[]Route
	Spot      *Spot
	Size      *Size
	ClearSpot bool
	// Archived flips the boolean hide without deleting the flow node.
	Archived *bool

	// Task fields are ignored on non-task flow nodes.
	Body              *string
	MultiPartTemplate *bool
	// Criteria replaces the whole list.
	Criteria        *[]SuccessCriterion
	Complexity      *int
	ClearComplexity bool
	Settings        *TaskSettings
	// ConversationID set to an empty string unbinds the chat; only cleared manually.
	ConversationID *string
	// Transition replaces both halves of onSuccess together.
	Transition *Transition
	// WorkflowID set to an empty string ungroups the flow node without moving it.
	WorkflowID *string
}

func (p FlowNodePatch) TouchesTask() bool {
	return p.Body != nil || p.MultiPartTemplate != nil || p.Criteria != nil || p.Complexity != nil || p.ClearComplexity ||
		p.Settings != nil || p.ConversationID != nil || p.Transition != nil
}

func (p FlowNodePatch) WithoutTask() FlowNodePatch {
	p.Body, p.MultiPartTemplate, p.Criteria, p.Complexity, p.ClearComplexity = nil, nil, nil, nil, false
	p.Settings, p.ConversationID, p.Transition = nil, nil, nil
	return p
}

// Empty patches must be refused rather than bumping the revision.
func (p FlowNodePatch) TouchesDisplay() bool {
	return p.Note != nil || p.Value != nil || p.ValueType != nil
}

func (p FlowNodePatch) WithoutDisplay() FlowNodePatch {
	p.Note, p.Value, p.ValueType = nil, nil, nil
	return p
}

func (p FlowNodePatch) Empty() bool {
	return p.Title == nil && p.Note == nil && p.Value == nil && p.ValueType == nil && p.OutputType == nil && p.Output == nil && !p.ClearOutput && p.Type == nil && p.Tags == nil && p.ScheduledAt == nil && p.Duration == nil &&
		p.RoleID == nil && p.RoleKind == nil && p.People == nil && p.Description == nil &&
		p.PullRequestID == nil && p.PullRequestStatus == nil && p.CommitID == nil && p.CommitStatus == nil &&
		p.MaxPasses == nil && p.RemainingPasses == nil && !p.ResetPasses &&
		p.Status == nil && p.Next == nil && p.Nexts == nil && p.Routes == nil && p.Spot == nil && p.Size == nil && !p.ClearSpot &&
		p.Archived == nil &&
		!p.TouchesTask() && p.WorkflowID == nil
}

type BoardPatch struct {
	Name *string
	// Boards are never deleted automatically: they retain the work history.
	Archive *bool
	// An empty folder ID moves the board to the top level.
	FolderID *string
}

func (p BoardPatch) Empty() bool { return p.Name == nil && p.Archive == nil && p.FolderID == nil }
