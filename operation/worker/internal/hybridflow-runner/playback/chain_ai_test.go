package playback

import (
	"encoding/json"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	harnessfaults "kiao/worker/internal/hybridflow-runner/harnesses/faults"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"strings"
	"testing"
)

type completionBoards struct {
	pkgBoards.BoardStore
	node        pkgBoards.FlowNode
	writes      int
	handle, run string
}

func (b *completionBoards) Finish(handle, node, run string, result pkgBoards.PlayResult) (*pkgBoards.BoardContent, error) {
	b.writes++
	b.handle, b.run = handle, run
	b.node.Status, b.node.Run = result.Status, ""
	b.node.Output = result.Output
	return &pkgBoards.BoardContent{FlowNodes: []pkgBoards.FlowNode{b.node}}, nil
}

func TestAICompletionPreservesInterruptionRetryAndStructuredOutput(t *testing.T) {
	contract, err := pkgBoards.CompileOutput(json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, reply    string
		stopped        bool
		refusal        *harnessfaults.TurnRefusal
		round          round
		status, output string
		writes         int
	}{
		{name: "valid export", reply: "```output\n{\"answer\":\"ready\"}\n```", round: RoundOn,
			status: pkgBoards.FlowNodeStatusDone, output: `{"answer":"ready"}`, writes: 1},
		{name: "invalid export", reply: "No structured answer.", round: roundStop,
			status: pkgBoards.FlowNodeStatusError, writes: 1},
		{name: "interrupted limit reply", reply: "API Error: 429 Too many requests", stopped: true, round: roundSuspend,
			status: pkgBoards.FlowNodeStatusInterrupted, writes: 1},
		{name: "temporary failure", reply: "API Error: 529 Overloaded.", round: roundAgain,
			status: pkgBoards.FlowNodeStatusRunning},
		{name: "spawn refusal", refusal: &harnessfaults.TurnRefusal{Code: turnevents.ErrCodeSpawnFailed, Message: "spawn failed"},
			round: roundStop, status: pkgBoards.FlowNodeStatusError, writes: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			node := pkgBoards.FlowNode{ID: "card", Title: "Card", Run: "run", Status: pkgBoards.FlowNodeStatusRunning}
			store := &completionBoards{node: node}
			runner := &ChainRunner{Boards: store}
			run := &ChainRun{Id: "run", Handle: "board", FlowNodeID: node.ID, Chat: "chat", State: ChainRunStatePlaying}
			zero := 0
			result := inspectAITurn(harnessfaults.TurnReply{Text: tc.reply, Tail: tc.reply, ExitCode: &zero}, tc.refusal, tc.stopped, "Claude")
			out, fault := runner.finishAITurn(run, node, PlayOneOutcome{Chat: "chat", Title: node.Title, Harness: "codex"}, contract, result)
			if tc.refusal != nil && (!strings.Contains(run.ending, "codex did not take") || strings.Contains(run.ending, "Claude")) {
				t.Fatalf("wrong harness in refusal: %s", run.ending)
			}
			if out.Round != tc.round || out.Chat != "chat" {
				t.Fatalf("outcome = %+v, want round %d in the same chat", out, tc.round)
			}
			if (fault != nil && fault.Retry) != (tc.round == roundAgain) {
				t.Fatalf("retry fault = %+v for round %d", fault, tc.round)
			}
			if store.writes != tc.writes || store.node.Status != tc.status || string(store.node.Output) != tc.output {
				t.Fatalf("writes = %d, flow node = %+v; want %d writes, %s, export %s", store.writes, store.node, tc.writes, tc.status, tc.output)
			}
			if tc.writes > 0 && (store.handle != "board" || store.run != "run") {
				t.Fatal("completion lost the board handle or run claim")
			}
		})
	}
}
