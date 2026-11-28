package runnerhttp

import (
	"encoding/json"
	"strings"
	"testing"

	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
)

const outputSchemaID = "11111111-1111-1111-1111-111111111111"

func outputRunner(t *testing.T) *runnerTest {
	t.Helper()
	rt := newRunnerTest(t, chainBoard("end"))
	rt.boards.mu.Lock()
	first := rt.boards.boards[rt.handle].FlowNode("flow-node-1")
	first.OutputType = outputSchemaID
	rt.boards.boards[rt.handle].FlowNode("flow-node-2").Body = "Received: {{input.message}}."
	rt.boards.boards["schemas"] = &pkgBoards.BoardContent{FlowNodes: []pkgBoards.FlowNode{
		{ID: outputSchemaID, Type: "value", ValueType: "json-schema", Value: json.RawMessage(`{"type":"object","properties":{"message":{"type":"string"}},"required":["message"]}`)},
	}}
	rt.boards.mu.Unlock()
	return rt
}

func TestChainExportsOutputToSuccessorWithoutChatHandover(t *testing.T) {
	rt := outputRunner(t)
	rt.answers("Done.\n```output\n{\"message\":\"hello\"}\n```", "Received it.")
	rt.play("flow-node-1")
	rt.waitIdle()
	board := rt.board()
	if string(board.FlowNode("flow-node-1").Output) != `{"message":"hello"}` {
		t.Fatal("output not saved")
	}
	if board.FlowNode("flow-node-2").Status != pkgBoards.FlowNodeStatusDone {
		t.Fatal("successor did not finish")
	}
	prompts := rt.prompts()
	if len(prompts) != 2 || !strings.Contains(prompts[0], "```output") || !strings.Contains(prompts[0], `"required":["message"]`) || prompts[1] != "Received: hello." {
		t.Fatalf("prompts = %q", prompts)
	}
}

func TestWorkflowValuesAcrossTasksAndIndependentPlays(t *testing.T) {
	rt := outputRunner(t)
	const workflowID = "editorial"
	rt.boards.mu.Lock()
	board := rt.boards.boards[rt.handle]
	board.Workflows = []pkgBoards.Workflow{{ID: workflowID, Name: "Editorial"}, {ID: "other", Name: "Other"}}
	first, second := board.FlowNode("flow-node-1"), board.FlowNode("flow-node-2")
	first.Workflow, second.Workflow = workflowID, workflowID
	first.Body = "```currentWokflow.message\nauthored\n```\n```currentWokflow.étape\nreview\n```\n" +
		"Read {{currentWokflow.message}} in {{currentWorkflow.name}} ({{currentWokflow.id}})."
	second.Body = "Received {{input.message}}, {{currentWokflow.message}}, and {{currentWorkflow.detail.ids.0}} for {{currentWokflow.étape}}. Send to {{role.editors}}."
	disconnected := *second
	disconnected.ID, disconnected.Body = "disconnected", "Stored message: {{currentWokflow.message}}"
	other := disconnected
	other.ID, other.Workflow = "isolated", "other"
	board.FlowNodes = append(board.FlowNodes, disconnected, other, pkgBoards.FlowNode{
		ID: "editors", Type: "role", RoleID: "editors", People: []string{`"Alex Rivera" <alex@example.com>`, "Sam Lee"},
	})
	rt.boards.mu.Unlock()

	rt.answers("```output\n{\"message\":\"ordinary\"}\n```\n```currentWorkflow.message\nhow are you?\n```\n"+
		"```currentWokflow.detail\n{\"ids\":[9007199254740993]}\n```", "Received it.")
	rt.play("flow-node-1")
	rt.waitIdle()
	rt.play("disconnected")
	rt.waitIdle()
	rt.play("isolated")
	rt.waitIdle()

	prompts := rt.prompts()
	if len(prompts) != 3 {
		t.Fatalf("prompts = %q", prompts)
	}
	if !strings.HasPrefix(prompts[0], "Read authored in Editorial (editorial).") ||
		strings.Contains(prompts[0], `"étape":"review"`) {
		t.Fatalf("producer prompt = %q", prompts[0])
	}
	if !strings.HasPrefix(prompts[1], `Received ordinary, how are you?, and 9007199254740993 for review. Send to "Alex Rivera" <alex@example.com>, Sam Lee.`) ||
		!strings.HasPrefix(prompts[2], "Stored message: how are you?") || strings.Contains(prompts[2], "9007199254740993") {
		t.Fatalf("consumer prompts = %q", prompts[1:])
	}
	board = rt.board()
	if board.FlowNode("isolated").Status != pkgBoards.FlowNodeStatusError || len(board.Workflow("other").Values) != 0 {
		t.Fatal("the other workflow could read the shared values")
	}
}

func TestWorkflowPromptIncludesWholeObjectOnlyOnRequest(t *testing.T) {
	rt := newRunnerTest(t, chainBoard("end"))
	rt.boards.mu.Lock()
	board := rt.boards.boards[rt.handle]
	board.Workflows = []pkgBoards.Workflow{{
		ID: "release", Name: "Release workflow",
		Values: map[string]json.RawMessage{"revision": json.RawMessage(`"abc123"`)},
	}}
	first, second := board.FlowNode("flow-node-1"), board.FlowNode("flow-node-2")
	first.Workflow, second.Workflow = "release", "release"
	second.Body = "Snapshot: {{currentWorkflow}}."
	rt.boards.mu.Unlock()

	rt.play("flow-node-1")
	rt.waitIdle()

	prompts := rt.prompts()
	if len(prompts) != 2 {
		t.Fatalf("prompts = %q", prompts)
	}
	if strings.Contains(prompts[0], "Release workflow") || strings.Contains(prompts[0], "abc123") ||
		!strings.Contains(prompts[0], "```currentWokflow.message") {
		t.Errorf("prompt without workflow references = %q", prompts[0])
	}
	const snapshot = `{"id":"release","name":"Release workflow","revision":"abc123"}`
	if !strings.HasPrefix(prompts[1], "Snapshot: "+snapshot+".") || strings.Count(prompts[1], snapshot) != 1 {
		t.Errorf("prompt with an explicit workflow reference = %q", prompts[1])
	}
}

func TestWorkflowValuesReadOnlyAndFinalMessage(t *testing.T) {
	for _, test := range []struct {
		name, final, status string
	}{
		{"progress is discarded", "Done.", pkgBoards.FlowNodeStatusDone},
		{"reserved field is refused", "```currentWokflow.name\nRenamed\n```", pkgBoards.FlowNodeStatusError},
		{"incomplete block is refused", "```currentWokflow.message\npartial", pkgBoards.FlowNodeStatusError},
	} {
		t.Run(test.name, func(t *testing.T) {
			rt := newRunnerTest(t, chainBoard("end"))
			rt.boards.mu.Lock()
			board := rt.boards.boards[rt.handle]
			board.Workflows = []pkgBoards.Workflow{{ID: "workflow", Name: "Workflow"}}
			node := board.FlowNode("flow-node-1")
			node.Workflow, node.OnSuccess.FlowNode = "workflow", ""
			rt.boards.mu.Unlock()
			rt.answers(rt.blockEvents("```currentWokflow.draft\nuncommitted\n```", test.final))
			rt.play(node.ID)
			rt.waitIdle()
			board = rt.board()
			if board.FlowNode(node.ID).Status != test.status || len(board.Workflow("workflow").Values) != 0 {
				t.Fatalf("task status = %q, workflow = %+v", board.FlowNode(node.ID).Status, board.Workflows)
			}
		})
	}
}

func TestInvalidOutputStopsTheChain(t *testing.T) {
	for _, message := range []string{"No export.", "```output\n{\n```", "```output\n{\"message\":false}\n```"} {
		t.Run(message, func(t *testing.T) {
			rt := outputRunner(t)
			rt.boards.mu.Lock()
			board := rt.boards.boards[rt.handle]
			board.Workflows = []pkgBoards.Workflow{{ID: "release", Name: "Release"}}
			board.FlowNode("flow-node-1").Workflow = "release"
			rt.boards.mu.Unlock()
			rt.answers(message + "\n```currentWokflow.message\nuncommitted\n```")
			rt.play("flow-node-1")
			rt.waitIdle()
			board = rt.board()
			first := board.FlowNode("flow-node-1")
			if first.Status != pkgBoards.FlowNodeStatusError || len(first.Output) > 0 {
				t.Fatalf("first = %+v", first)
			}
			if len(board.Workflow("release").Values) > 0 {
				t.Fatal("a failed task updated its workflow")
			}
			if len(rt.prompts()) != 1 {
				t.Fatalf("successor ran: %q", rt.prompts())
			}
		})
	}
}

func TestOutputComesFromFinalMessageOnly(t *testing.T) {
	rt := outputRunner(t)
	rt.answers(rt.blockEvents("```output\n{\"message\":\"draft\"}\n```", "Finished without an export."))
	rt.play("flow-node-1")
	rt.waitIdle()
	if node := rt.board().FlowNode("flow-node-1"); node.Status != pkgBoards.FlowNodeStatusError || len(node.Output) > 0 {
		t.Fatalf("draft exported: %+v", node)
	}
}

func TestMissingInputDoesNotSpendATurn(t *testing.T) {
	rt := outputRunner(t)
	rt.play("flow-node-2")
	rt.waitIdle()
	if len(rt.prompts()) != 0 {
		t.Fatalf("sent unresolved input: %q", rt.prompts())
	}
	if rt.board().FlowNode("flow-node-2").Status != pkgBoards.FlowNodeStatusError {
		t.Fatal("missing input did not mark error")
	}
}

func TestSchedulerPassesStructuredOutput(t *testing.T) {
	rt := outputRunner(t)
	rt.boards.mu.Lock()
	board := rt.boards.boards[rt.handle]
	board.FlowNode("flow-node-1").OnSuccess.FlowNode = "wait"
	board.FlowNodes = append(board.FlowNodes, pkgBoards.FlowNode{
		ID: "wait", Title: "Wait", Type: pkgBoards.FlowNodeTypeScheduler, Duration: "{{input.delayMs}}ms",
		OnSuccess: pkgBoards.FlowNodeSuccess{FlowNode: "flow-node-2"},
	})
	rt.boards.mu.Unlock()
	const input = `{"message":"hello","delayMs":1}`
	rt.answers("```output\n"+input+"\n```", "Received it.")
	rt.play("flow-node-1")
	rt.waitIdle()
	if got := string(rt.board().FlowNode("wait").Output); got != input {
		t.Fatalf("scheduler output = %s", got)
	}
	if prompts := rt.prompts(); len(prompts) != 2 || prompts[1] != "Received: hello." {
		t.Fatalf("prompts = %q", prompts)
	}
}

func TestSchedulerResolvesAndValidatesDatetimeReferences(t *testing.T) {
	for _, tc := range []struct{ value, status, successorStatus string }{
		{"03:00", pkgBoards.FlowNodeStatusDone, pkgBoards.FlowNodeStatusTodo},
		{"03:00Z", pkgBoards.FlowNodeStatusError, ""},
	} {
		t.Run(tc.status, func(t *testing.T) {
			const expression = "{{role.date}}T{{currentWorkflow.schedule}}"
			rt := newRunnerTest(t, `{
				"flowNodes":[
					{"id":"date","type":"role","roleId":"date","people":["2020-01-01"]},
					{"id":"wait","type":"scheduler","workflow":"release","at":"`+expression+`",
					 "onSuccess":{"flowNode":"after"}},
					{"id":"after","type":"human","title":"Publish"}
				],
				"workflows":[{"id":"release","values":{"schedule":"`+tc.value+`"}}]
			}`)
			rt.play("wait")
			rt.waitIdle()
			board := rt.board()
			if wait := board.FlowNode("wait"); wait.Status != tc.status || wait.At != expression {
				t.Errorf("Scheduler = %+v", wait)
			}
			if after := board.FlowNode("after"); after.Status != tc.successorStatus {
				t.Errorf("successor status = %q, want %q", after.Status, tc.successorStatus)
			}
		})
	}
}

func TestWorkingDirectoryReferencesInAIChains(t *testing.T) {
	for _, tc := range []struct{ name, mode, folder, expression, status string }{
		{"continue in the same folder", "continue", "corpora", "{{role.workingFolder}}", pkgBoards.FlowNodeStatusDone},
		{"stop a handoff to a different folder", "continue", "units", "{{input.folder}}", ""},
		{"start an independent chat in a different folder", "end", "units", "{{input.folder}}", pkgBoards.FlowNodeStatusDone},
		{"refuse an empty resolved folder", "end", "", "{{input.folder}}", pkgBoards.FlowNodeStatusError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := outputRunner(t)
			mustMkdir(t, rt.root, "corpora")
			mustMkdir(t, rt.root, "units")
			rt.boards.mu.Lock()
			board := rt.boards.boards[rt.handle]
			board.Workflows = []pkgBoards.Workflow{{ID: "release", Values: map[string]json.RawMessage{"folder": json.RawMessage(`"/corpora"`)}}}
			first, second := board.FlowNode("flow-node-1"), board.FlowNode("flow-node-2")
			first.Workflow, first.Settings.Folder = "release", "{{currentWorkflow.folder}}"
			first.OnSuccess.Mode = tc.mode
			second.Settings.Folder = tc.expression
			board.FlowNodes = append(board.FlowNodes, pkgBoards.FlowNode{
				ID: "folder", Type: "role", RoleID: "workingFolder", People: []string{"corpora"},
			})
			rt.boards.mu.Unlock()
			rt.answers("```output\n{\"message\":\"hello\",\"folder\":\""+tc.folder+"\"}\n```", "Received it.")
			rt.play(first.ID)
			rt.waitIdle()
			board = rt.board()
			second = board.FlowNode(second.ID)
			if second.Status != tc.status || second.Settings.Folder != tc.expression {
				t.Fatalf("second task status = %q, folder = %q", second.Status, second.Settings.Folder)
			}
			if tc.status == pkgBoards.FlowNodeStatusDone {
				conversation, err := rt.convs.Get(second.Chat)
				if err != nil || conversation.Folder != tc.folder {
					t.Fatalf("conversation = %+v, %v", conversation, err)
				}
			} else if len(rt.prompts()) != 1 {
				t.Fatalf("started the second task without a usable folder: %q", rt.prompts())
			}
		})
	}
}

func TestMissingOutputSchemaDoesNotSpendATurn(t *testing.T) {
	rt := outputRunner(t)
	rt.boards.mu.Lock()
	delete(rt.boards.boards, "schemas")
	rt.boards.mu.Unlock()
	rt.play("flow-node-1")
	rt.waitIdle()
	if len(rt.prompts()) != 0 || rt.board().FlowNode("flow-node-1").Status != pkgBoards.FlowNodeStatusError {
		t.Fatal("missing schema did not refuse the turn")
	}
}
