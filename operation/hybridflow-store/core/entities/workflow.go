package entities

import (
	"time"
)

// Workflows group flow nodes; workflow classes group node classes. Membership lives
// on each card, with at most one group of the matching kind. Bounds derive from
// members: dragging moves them; deleting a group leaves its members in place.
type Workflow struct {
	ID        string
	BoardID   string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	// Revision increments on every write and supports conditional updates.
	Revision int64
}

type WorkflowClass struct {
	ID        string
	BoardID   string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	Revision  int64
}

type WorkflowPatch struct {
	Name *string
}

func (p WorkflowPatch) Empty() bool { return p.Name == nil }

type WorkflowClassPatch struct {
	Name *string
}

func (p WorkflowClassPatch) Empty() bool { return p.Name == nil }
