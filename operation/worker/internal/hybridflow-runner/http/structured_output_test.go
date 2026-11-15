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

func TestInvalidOutputStopsTheChain(t *testing.T) {
	for _, message := range []string{"No export.", "```output\n{\n```", "```output\n{\"message\":false}\n```"} {
		t.Run(message, func(t *testing.T) {
			rt := outputRunner(t)
			rt.answers(message)
			rt.play("flow-node-1")
			rt.waitIdle()
			board := rt.board()
			first := board.FlowNode("flow-node-1")
			if first.Status != pkgBoards.FlowNodeStatusError || len(first.Output) > 0 {
				t.Fatalf("first = %+v", first)
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
		ID: "wait", Title: "Wait", Type: pkgBoards.FlowNodeTypeScheduler, Duration: "1ms",
		OnSuccess: pkgBoards.FlowNodeSuccess{FlowNode: "flow-node-2"},
	})
	rt.boards.mu.Unlock()
	rt.answers("```output\n{\"message\":\"hello\"}\n```", "Received it.")
	rt.play("flow-node-1")
	rt.waitIdle()
	if got := string(rt.board().FlowNode("wait").Output); got != `{"message":"hello"}` {
		t.Fatalf("scheduler output = %s", got)
	}
	if prompts := rt.prompts(); len(prompts) != 2 || prompts[1] != "Received: hello." {
		t.Fatalf("prompts = %q", prompts)
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
