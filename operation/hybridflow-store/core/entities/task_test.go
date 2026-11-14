package entities

import "testing"

// A task is valid with a title, a description or a success criterion: any one of the three is
// something to send, and none of them is a turn spent on nothing.
func TestATaskIsValidWithAnyOneOfTheThree(t *testing.T) {
	settings := TaskSettings{Agent: "id-1", Effort: "high", Permission: "manual", Folder: "/"}
	titled := FlowNode{Title: "Write the plan", Type: FlowNodeAI, Task: &Task{Settings: settings}}
	described := FlowNode{Title: "", Type: FlowNodeAI, Task: &Task{Body: "Go on.", Settings: settings}}
	measured := FlowNode{Title: "", Type: FlowNodeAI,
		Task: &Task{Criteria: []SuccessCriterion{{ID: "c1", Text: "It holds"}}, Settings: settings}}
	empty := FlowNode{Title: "  ", Type: FlowNodeAI, Task: &Task{Body: " \n ", Settings: settings}}
	for name, flowNode := range map[string]FlowNode{
		"titled": titled, "described": described, "measured": measured,
	} {
		if !flowNode.Task.HasContent(flowNode.Title) {
			t.Errorf("%s: a task saying one of the three has no content", name)
		}
		if err := flowNode.Runnable(); err != nil {
			t.Errorf("%s: a task saying one of the three is not runnable: %v", name, err)
		}
	}
	if empty.Task.HasContent(empty.Title) {
		t.Error("a task saying none of the three has content")
	}
	if err := empty.Runnable(); err != ErrFlowNodeEmptyPrompt {
		t.Errorf("an empty task is refused with %v, want ErrFlowNodeEmptyPrompt", err)
	}
}

// The title stands in for a missing description, and never beside one: it is the card's name,
// and sending it made that one short line do two jobs.
func TestTheTitleIsSentOnlyForAMissingDescription(t *testing.T) {
	titled := Task{}.Prompt("Write the plan")
	if titled != "Write the plan" {
		t.Errorf("titled prompt = %q, want the title", titled)
	}
	described := Task{Body: "Go on."}.Prompt("Write the plan")
	if described != "Go on." {
		t.Errorf("described prompt = %q, want the description alone", described)
	}
	if got := (Task{}).Prompt("  "); got != "" {
		t.Errorf("empty prompt = %q, want nothing", got)
	}
}

// The criteria are always sent where present: beside the description, beside the title standing
// in for one, or on their own.
func TestTheCriteriaAreAlwaysSent(t *testing.T) {
	criteria := []SuccessCriterion{{ID: "c1", Text: "It holds"}, {ID: "c2", Text: "It reads well"}}
	if got := (Task{Body: "Go on.", Criteria: criteria}).Prompt("Write the plan"); got !=
		"Go on.\n\nSuccess criteria:\n- It holds\n- It reads well" {
		t.Errorf("described prompt = %q", got)
	}
	if got := (Task{Criteria: criteria}).Prompt("Write the plan"); got !=
		"Write the plan\n\nSuccess criteria:\n- It holds\n- It reads well" {
		t.Errorf("titled prompt = %q", got)
	}
	if got := (Task{Criteria: criteria}).Prompt(""); got !=
		"Success criteria:\n- It holds\n- It reads well" {
		t.Errorf("bare prompt = %q", got)
	}
}

// The criteria a caller says, as the task keeps them: trimmed, the empty ones dropped, in order.
func TestReadSuccessCriteria(t *testing.T) {
	kept := ReadSuccessCriteria([]SuccessCriterion{
		{ID: " c1 ", Text: " It holds "}, {ID: "c2", Text: "   "}, {ID: "c3", Text: ""},
	})
	if len(kept) != 1 || kept[0] != (SuccessCriterion{ID: "c1", Text: "It holds"}) {
		t.Errorf("criteria = %+v, want the one measured line trimmed", kept)
	}
}

// The complexity is one of the Fibonacci suite or none: anything else is no complexity at all,
// a task being as likely written by hand as by the editor.
func TestReadComplexity(t *testing.T) {
	for _, value := range Complexities() {
		read := ReadComplexity(&value)
		if read == nil || *read != value {
			t.Errorf("complexity %d reads as %v", value, read)
		}
	}
	if ReadComplexity(nil) != nil {
		t.Error("no complexity reads as one")
	}
	for _, value := range []int{0, 4, 7, 100} {
		read := value
		if ReadComplexity(&read) != nil {
			t.Errorf("complexity %d reads as one", value)
		}
	}
}
