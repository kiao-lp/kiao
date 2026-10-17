package entities

// FlowNodePatch updates only named fields, preserving concurrent writes to other columns.
// The card revision guards conflicts, including task fields stored in a separate row.
// Nil leaves a field unchanged; ClearSpot and ClearComplexity explicitly clear values.
type FlowNodePatch struct {
	Title *string
	Type  *FlowNodeType
	// Tags replaces the whole ordered set.
	Tags        *[]string
	ScheduledAt *string
	Duration    *string
	Status      *FlowNodeStatus
	// Next set to an empty string breaks the chain.
	Next *string
	// Nexts replaces all Gateway branches; ignored for other types.
	Nexts     *[]string
	Spot      *Spot
	ClearSpot bool
	// Archived flips the boolean hide without deleting the card.
	Archived *bool

	// Task fields are ignored on non-task cards.
	Body *string
	// Criteria replaces the whole list.
	Criteria        *[]SuccessCriterion
	Complexity      *int
	ClearComplexity bool
	Settings        *TaskSettings
	// ConversationID set to an empty string unbinds the chat; only cleared manually.
	ConversationID *string
	// Transition replaces both halves of onSuccess together.
	Transition *Transition
	// ClassVersionID set to an empty string disconnects the class/version.
	ClassVersionID *string
	// WorkflowID set to an empty string ungroups the card without moving it.
	WorkflowID *string
}

func (p FlowNodePatch) TouchesTask() bool {
	return p.Body != nil || p.Criteria != nil || p.Complexity != nil || p.ClearComplexity ||
		p.Settings != nil || p.ConversationID != nil || p.Transition != nil
}

func (p FlowNodePatch) WithoutTask() FlowNodePatch {
	p.Body, p.Criteria, p.Complexity, p.ClearComplexity = nil, nil, nil, false
	p.Settings, p.ConversationID, p.Transition = nil, nil, nil
	return p
}

// Empty patches must be refused rather than bumping the revision.
func (p FlowNodePatch) Empty() bool {
	return p.Title == nil && p.Type == nil && p.Tags == nil && p.ScheduledAt == nil && p.Duration == nil &&
		p.Status == nil && p.Next == nil && p.Nexts == nil && p.Spot == nil && !p.ClearSpot &&
		p.Archived == nil &&
		!p.TouchesTask() && p.ClassVersionID == nil && p.WorkflowID == nil
}

type BoardPatch struct {
	Name *string
	// Boards are never deleted automatically: they retain the work history.
	Archive *bool
}

func (p BoardPatch) Empty() bool { return p.Name == nil && p.Archive == nil }
