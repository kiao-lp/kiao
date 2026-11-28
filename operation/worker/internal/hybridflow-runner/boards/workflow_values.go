package boards

import (
	"encoding/json"
	"fmt"
	"maps"
	"regexp"
	"strings"
)

type Workflow struct {
	ID             string                     `json:"id"`
	Name           string                     `json:"name"`
	Values         map[string]json.RawMessage `json:"values,omitempty"`
	WorkflowFolder string                     `json:"workflowFolder,omitempty"`
	Files          []string                   `json:"files,omitempty"`
}

type WorkflowUpdate struct {
	ID     string                     `json:"id"`
	Values map[string]json.RawMessage `json:"values"`
}

func (b *BoardContent) Workflow(id string) *Workflow {
	if id == "" {
		return nil
	}
	for i := range b.Workflows {
		if b.Workflows[i].ID == id {
			return &b.Workflows[i]
		}
	}
	return nil
}

func (w *Workflow) ValidateFiles() error {
	if w != nil && (w.WorkflowFolder != "") != (len(w.Files) > 0) {
		return fmt.Errorf("workflow %q requires both a folder and at least one file or folder", w.Name)
	}
	return nil
}

func (w *Workflow) MergeValues(values map[string]json.RawMessage) {
	if w.Values == nil {
		w.Values = make(map[string]json.RawMessage, len(values))
	}
	maps.Copy(w.Values, values)
}

func (w *Workflow) Context() map[string]json.RawMessage {
	if w == nil {
		return nil
	}
	values := make(map[string]json.RawMessage, len(w.Values)+2)
	maps.Copy(values, w.Values)
	values["id"], values["name"] = jsonOf(w.ID), jsonOf(w.Name)
	return values
}

const workflowNamespace = `(?:currentWokflow|currentWorkflow)`

var workflowLabel = regexp.MustCompile(`^` + workflowNamespace + `\.`)
var workflowAssignment = regexp.MustCompile("^" + workflowNamespace + "\\.([^\\s\\p{Z}.{}`]+)$")

// WorkflowAssignments extracts directives before interpolation so inserted text stays data.
func WorkflowAssignments(text string) (string, map[string]json.RawMessage, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var kept []string
	var values map[string]json.RawMessage
	start := 0
	for _, block := range codeFences(lines) {
		if !workflowLabel.MatchString(block.label) {
			continue
		}
		assignment := workflowAssignment.FindStringSubmatch(block.label)
		if assignment == nil || block.end < 0 {
			return "", nil, fmt.Errorf("invalid or incomplete workflow block %q", block.label)
		}
		field := assignment[1]
		if field == "id" || field == "name" {
			return "", nil, fmt.Errorf("workflow field %q is read-only", field)
		}
		if values == nil {
			values = make(map[string]json.RawMessage)
		}
		value := strings.Join(lines[block.start+1:block.end], "\n")
		raw := json.RawMessage(strings.TrimSpace(value))
		if !json.Valid(raw) {
			raw = jsonOf(value)
		}
		values[field] = raw
		kept = append(kept, lines[start:block.start]...)
		start = block.end + 1
	}
	if len(values) == 0 {
		return text, nil, nil
	}
	return strings.Join(append(kept, lines[start:]...), "\n"), values, nil
}

func (w *Workflow) Prompt(prompt string) string {
	if w == nil {
		return prompt
	}
	return prompt + "\n\nWhen the task calls for a shared value update, include a complete fenced block in your final message. " +
		"Use one block per field with text or a JSON value inside. The id and name fields are read-only.\n\n" +
		"```currentWokflow.message\n<value>\n```"
}
