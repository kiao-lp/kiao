package entities

import (
	"strings"
	"time"
)

// FlowNodeClass is never played. Versions hold its body, criteria and default agent.
// Folder, effort and chat belong to instances; status belongs to versions.
// Instances start without effort and cannot play until one is chosen.
type FlowNodeClass struct {
	ID      string
	BoardID string
	Title   string
	// Instantiable controls menu visibility, not instantiation as a successor.
	Instantiable bool
	Type         FlowNodeType
	Tags         []string
	// ScheduledAt is a Scheduler preset read by ReadSchedule; empty for other types.
	// Instances may override it.
	ScheduledAt string
	Duration    string
	Spot        *Spot
	// Next names a class on the same board, never a version or a flow node; empty ends the chain.
	Next string
	// Permission applies only to AI instances.
	Permission string
	// Runner is an AI instance's runner ID; empty uses the runner where Play is pressed.
	Runner string
	// Transition controls an AI instance's chat on success.
	Transition Transition
	// Note belongs to the class, applies to every type and is never copied to instances.
	Note string
	// WorkflowClassID is empty when ungrouped.
	WorkflowClassID string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	// Revision advances on class writes; versions have independent revisions.
	Revision int64
}

func (c *FlowNodeClass) ClassSettings() (permission, runner string, transition Transition) {
	if c.Type != FlowNodeAI {
		return "", "", Transition{Mode: TransitionModeDefault}
	}
	return c.Permission, c.Runner, c.Transition
}

type ClassVersionStatus string

const (
	// ClassVersionDraft is editable; instantiation uses the latest published version.
	ClassVersionDraft ClassVersionStatus = "draft"
	// ClassVersionPublished is immutable.
	ClassVersionPublished ClassVersionStatus = "published"
)

const ClassVersionStatusDefault = ClassVersionDraft

// ReadClassVersionStatus treats unknown values as draft.
func ReadClassVersionStatus(said string) ClassVersionStatus {
	s := ClassVersionStatus(strings.TrimSpace(said))
	if s == ClassVersionPublished {
		return s
	}
	return ClassVersionStatusDefault
}

func (s ClassVersionStatus) Published() bool { return s == ClassVersionPublished }

type FlowNodeClassVersion struct {
	ID      string
	ClassID string
	// Number starts at 1 and increases by one per version.
	Number   int
	Body     string
	Criteria []SuccessCriterion
	// IsTemplate makes Body a template filled during instantiation.
	// All chain templates are filled before any flow node is created.
	IsTemplate bool
	// Agent is the default managed agent ID for AI instances; empty means none.
	Agent     string
	Status    ClassVersionStatus
	CreatedAt time.Time
	UpdatedAt time.Time
	Revision  int64
}

// ClassRef is resolved on read so instances reflect the current class title.
type ClassRef struct {
	ClassID       string
	ClassTitle    string
	VersionID     string
	VersionNumber int
}

// FlowNodeClassPatch changes class fields, never version fields.
// Nil leaves a field unchanged; ClearSpot removes placement.
type FlowNodeClassPatch struct {
	Title        *string
	Instantiable *bool
	Type         *FlowNodeType
	// Tags replaces the whole ordered set.
	Tags        *[]string
	ScheduledAt *string
	Duration    *string
	// Next set to an empty string breaks the chain.
	Next      *string
	Spot      *Spot
	ClearSpot bool
	// Permission, Runner and Transition are ignored for non-AI classes.
	Permission *string
	Runner     *string
	// Transition replaces both halves of onSuccess together.
	Transition *Transition
	// Note survives type changes.
	Note *string
	// WorkflowClassID set to an empty string ungroups the card without moving it.
	WorkflowClassID *string
}

func (p FlowNodeClassPatch) TouchesAI() bool {
	return p.Permission != nil || p.Runner != nil || p.Transition != nil
}

func (p FlowNodeClassPatch) WithoutAI() FlowNodeClassPatch {
	p.Permission, p.Runner, p.Transition = nil, nil, nil
	return p
}

func (p FlowNodeClassPatch) Empty() bool {
	return p.Title == nil && p.Instantiable == nil && p.Type == nil && p.Tags == nil &&
		p.ScheduledAt == nil && p.Duration == nil && p.Next == nil && p.Spot == nil && !p.ClearSpot &&
		!p.TouchesAI() && p.Note == nil && p.WorkflowClassID == nil
}

// FlowNodeClassVersionPatch only applies to drafts; publication is irreversible.
// Nil leaves a field unchanged.
type FlowNodeClassVersionPatch struct {
	Body *string
	// Criteria replaces the whole list.
	Criteria   *[]SuccessCriterion
	IsTemplate *bool
	// Agent defaults AI instances to a managed agent; ignored for non-AI classes.
	Agent  *string
	Status *ClassVersionStatus
}

func (p FlowNodeClassVersionPatch) Empty() bool {
	return p.Body == nil && p.Criteria == nil && p.IsTemplate == nil && p.Agent == nil && p.Status == nil
}
