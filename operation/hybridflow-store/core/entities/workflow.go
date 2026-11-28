package entities

import (
	"encoding/json"
	"regexp"
	"time"
)

// A workflow groups flow nodes. Membership lives
// on each flow node, with at most one group of the matching kind. Bounds derive from
// members: dragging moves them; deleting a group leaves its members in place.
type Workflow struct {
	ID             string
	BoardID        string
	Name           string
	Values         string
	WorkflowFolder string
	Files          []string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	// Revision increments on every write and supports conditional updates.
	Revision int64
}

// WorkflowUpdate merges named values into the workflow used by a play.
type WorkflowUpdate struct {
	ID     string
	Values map[string]json.RawMessage
}

var workflowField = regexp.MustCompile("^[^\\s\\p{Z}.{}`]+$")

func (u WorkflowUpdate) Validate() error {
	if !ValidID(u.ID) || len(u.Values) == 0 {
		return Invalidf("workflow updates need a workflow id and at least one field")
	}
	for field, value := range u.Values {
		if err := validateWritableWorkflowField(field); err != nil {
			return err
		}
		if !workflowField.MatchString(field) || !json.Valid(value) {
			return Invalidf("invalid workflow field or value for %q", field)
		}
	}
	return nil
}

type WorkflowPatch struct {
	Name           *string
	WorkflowFolder *string
	Files          []string
	SetValues      map[string]json.RawMessage
	RemoveValues   []string
}

func (p WorkflowPatch) ChangesValues() bool {
	return len(p.SetValues) > 0 || len(p.RemoveValues) > 0
}

func (p WorkflowPatch) Validate() error {
	if p.Name == nil && p.WorkflowFolder == nil && p.Files == nil && !p.ChangesValues() {
		return Invalidf("the patch changes nothing")
	}
	if err := ValidateWorkflowValues(p.SetValues); err != nil {
		return err
	}
	for _, field := range p.RemoveValues {
		if err := validateWritableWorkflowField(field); err != nil {
			return err
		}
	}
	return nil
}

func ValidateWorkflowValues(values map[string]json.RawMessage) error {
	for field, value := range values {
		if err := validateWritableWorkflowField(field); err != nil {
			return err
		}
		if !json.Valid(value) {
			return Invalidf("invalid workflow value for %q", field)
		}
	}
	return nil
}

func validateWritableWorkflowField(field string) error {
	if field == "id" || field == "name" {
		return Invalidf("workflow field %q is read-only", field)
	}
	return nil
}
