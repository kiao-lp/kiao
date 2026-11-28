package runnerhttp

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/access"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"strings"
	"testing"
	"time"
)

func TestExclusiveGatewayContinuesOnEachArrival(t *testing.T) {
	rt := newRunnerTest(t, exclusiveJoinBoard)

	rt.play("left")
	rt.waitIdle()
	first := rt.board()
	if first.FlowNode("right").Status != "" {
		t.Fatal("the second predecessor played before its own activation")
	}
	for _, id := range []string{"join", "held"} {
		if node := first.FlowNode(id); node.Status != pkgBoards.FlowNodeStatusDone || string(node.Output) != `{"branch":"left"}` {
			t.Fatalf("%s did not finish with the first predecessor's output: %+v", id, node)
		}
	}

	rt.play("right")
	rt.waitIdle()
	board := rt.board()
	for _, id := range []string{"join", "held"} {
		if node := board.FlowNode(id); node.Status != pkgBoards.FlowNodeStatusDone || node.Completion <= first.FlowNode(id).Completion || len(node.Output) != 0 {
			t.Fatalf("%s did not finish again with the second predecessor's empty output: %+v", id, node)
		}
	}
}

func TestExclusiveGatewayKeepsAnArrivalWhileTheSuccessorIsHeld(t *testing.T) {
	rt := newRunnerTest(t, exclusiveJoinBoard)
	gate := &heldFinishBoards{
		BoardStore: rt.boards, reached: make(chan struct{}), release: make(chan struct{}),
	}
	rt.runner.Boards = gate
	defer func() {
		// The first write blocks, then subsequent ones pass through.
		select {
		case <-gate.release:
		default:
			close(gate.release)
		}
	}()
	rt.play("left")
	select {
	case <-gate.reached:
	case <-time.After(5 * time.Second):
		t.Fatal("the first arrival did not start the successor")
	}
	first := rt.last()
	rt.play("right")
	rt.waitFor("the second arrival to queue at the successor", func() bool {
		run := rt.last()
		return run.State == playback.ChainRunStateQueued && run.FlowNodeID == "held"
	})
	board := rt.board()
	if node := board.FlowNode("join"); node.Status != pkgBoards.FlowNodeStatusDone || len(node.Output) != 0 {
		t.Fatalf("the exclusive gateway did not finish on the second arrival: %+v", node)
	}
	if node := board.FlowNode("held"); node.Run != first.ID {
		t.Fatalf("the first arrival lost its successor claim: %+v", node)
	}
	close(gate.release)
	rt.waitIdle()
	for _, run := range rt.runner.Snapshots() {
		if !strings.Contains(run.Ending, "played its last flow node") {
			t.Errorf("arrival %s ended prematurely: %s", run.RootFlowNodeID, run.Ending)
		}
	}
	if node := rt.board().FlowNode("held"); node.Status != pkgBoards.FlowNodeStatusDone || len(node.Output) != 0 {
		t.Fatalf("the second arrival did not replay the successor with its own input: %+v", node)
	}
}

func TestExclusiveGatewayRoutesWithTheSubmittedPredecessor(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"first","type":"human","status":"done","completion":1,"output":{"approved":true},"onSuccess":{"flowNode":"decision"}},
		{"id":"second","type":"human","status":"done","completion":2,"output":{"approved":false},"onSuccess":{"flowNode":"decision"}},
		{"id":"decision","type":"exclusive-gateway","onSuccess":{"flowNodes":["publish","review"]},"routes":[
			{"condition":"input.approved","flowNode":"publish"},{"condition":"true","flowNode":"review"}]},
		{"id":"publish","type":"scheduler","duration":"1ms"},
		{"id":"review","type":"scheduler","duration":"1ms"}
	]}`)
	_, err := rt.runner.PlayRequest(access.Identity{User: "tester"}, runstate.PlayChainRunRequestDto{
		Handle: rt.handle, FlowNodeID: "decision", PredecessorID: "first",
	})
	if err != nil {
		t.Fatal(err)
	}
	rt.waitIdle()
	board := rt.board()
	if node := board.FlowNode("publish"); node.Status != pkgBoards.FlowNodeStatusDone || string(node.Output) != `{"approved":true}` {
		t.Fatalf("the submitted predecessor did not select Publish: %+v", node)
	}
	if got := board.FlowNode("review").Status; got != "" {
		t.Fatalf("the other predecessor selected Review: %q", got)
	}
}

const exclusiveJoinBoard = `{"flowNodes":[
	{"id":"input","type":"human","status":"done","output":{"branch":"left"},"onSuccess":{"flowNode":"left"}},
	{"id":"left","type":"scheduler","duration":"1ms","onSuccess":{"flowNode":"join"}},
	{"id":"right","type":"scheduler","duration":"1ms","onSuccess":{"flowNode":"join"}},
	{"id":"join","title":"Join","type":"exclusive-gateway","onSuccess":{"flowNodes":["held"]}},
	{"id":"held","title":"After","type":"scheduler","duration":"1ms"}
]}`

func TestExclusiveGatewayUsesFirstMatchingRouteAndPassesItsInput(t *testing.T) {
	for _, tt := range []struct{ name, routes, want string }{
		{
			name: "specific first",
			routes: `[{"condition":"input.items.exists(item, item.id == 9007199254740993)","flowNode":"left"},
			          {"condition":"true","flowNode":"right"}]`,
			want: "left",
		},
		{
			name: "fallback first",
			routes: `[{"condition":"true","flowNode":"right"},
			          {"condition":"input.items.exists(item, item.id == 9007199254740993)","flowNode":"left"}]`,
			want: "right",
		},
		{
			name: "skip false and stop evaluating after match",
			routes: `[{"condition":"false","flowNode":"left"},
			          {"condition":"true","flowNode":"right"},
			          {"condition":"input.missing == 1","flowNode":"left"}]`,
			want: "right",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			const output = `{"items":[{"id":9007199254740993}]}`
			rt := newRunnerTest(t, exclusiveGatewayBoard(output, tt.routes))
			rt.play("wait")
			rt.waitIdle()

			board := rt.board()
			for _, id := range []string{"decision", tt.want} {
				node := board.FlowNode(id)
				if node.Status != pkgBoards.FlowNodeStatusDone || string(node.Output) != output {
					t.Errorf("%s: status %q, output %s", id, node.Status, node.Output)
				}
			}
			for _, id := range []string{"left", "right"} {
				if id != tt.want && board.FlowNode(id).Status != "" {
					t.Errorf("unselected branch %s has status %q", id, board.FlowNode(id).Status)
				}
			}
			if len(rt.runner.Snapshots()) != 1 {
				t.Error("the selected branch should continue the same run")
			}
		})
	}
}

func TestExclusiveGatewayFailsWithoutTakingABranch(t *testing.T) {
	for _, tt := range []struct{ name, output, condition string }{
		{"missing input", "", "true"},
		{"no match", "null", "input != null"},
		{"invalid CEL", `{}`, "input."},
		{"non boolean", `{"value":"yes"}`, "input.value"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			routes := fmt.Sprintf(`[{"condition":%q,"flowNode":"left"}]`, tt.condition)
			rt := newRunnerTest(t, exclusiveGatewayBoard(tt.output, routes))
			rt.play("wait")
			rt.waitIdle()

			board := rt.board()
			if node := board.FlowNode("decision"); node.Status != pkgBoards.FlowNodeStatusError || len(node.Output) > 0 {
				t.Errorf("decision: status %q, output %s", node.Status, node.Output)
			}
			if board.FlowNode("left").Status != "" || board.FlowNode("right").Status != "" {
				t.Error("an unselected branch played")
			}
		})
	}
}

func TestExclusiveGatewayUsesWorkflowValuesWithoutPredecessorOutput(t *testing.T) {
	rt := newRunnerTest(t, exclusiveGatewayBoard("", `[{"condition":"currentWokflow.approved && currentWorkflow.id == 'release'","flowNode":"left"}]`))
	rt.boards.mu.Lock()
	board := rt.boards.boards[rt.handle]
	board.FlowNode("decision").Workflow = "release"
	board.Workflows = []pkgBoards.Workflow{{
		ID: "release", Name: "Release", Values: map[string]json.RawMessage{"approved": json.RawMessage(`true`)},
	}}
	rt.boards.mu.Unlock()
	rt.play("wait")
	rt.waitIdle()
	board = rt.board()
	if board.FlowNode("decision").Status != pkgBoards.FlowNodeStatusDone || board.FlowNode("left").Status != pkgBoards.FlowNodeStatusDone {
		t.Fatalf("workflow route did not finish: %+v", rt.last())
	}
}

func TestExclusiveGatewayUsesRoleWithoutPredecessorOutput(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"reviewers","type":"role","roleId":"reviewers","people":["Alex Rivera","Sam Lee"]},
		{"id":"gate","type":"exclusive-gateway","onSuccess":{"flowNodes":["review","fallback"]},
		 "routes":[{"condition":"role.reviewers == 'Alex Rivera, Sam Lee'","flowNode":"review"},
		           {"condition":"true","flowNode":"fallback"}]},
		{"id":"review","type":"human"},
		{"id":"fallback","type":"human"}
	]}`)
	rt.play("gate")
	rt.waitIdle()
	board := rt.board()
	if board.FlowNode("review").Status != pkgBoards.FlowNodeStatusTodo || board.FlowNode("fallback").Status != "" {
		t.Fatalf("role route did not start review: %+v", rt.last())
	}
}

func TestLimiterFollowsTheStoreSelectionAndCarriesInput(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"producer","type":"human","status":"done","output":{"approved":true},"onSuccess":{"flowNode":"gate"}},
		{"id":"gate","type":"limiter","maxPasses":1,"remainingPasses":1,"revision":1,"onSuccess":{"flowNodes":["left","right"]}},
		{"id":"left","type":"human"},
		{"id":"right","type":"human"}
	]}`)
	rt.play("gate")
	rt.waitIdle()
	board := rt.board()
	if got := board.FlowNode("left").Status; got != pkgBoards.FlowNodeStatusTodo || board.FlowNode("right").Status != "" {
		t.Fatalf("the last available pass should take only the passes-left branch, got %q", got)
	}
	node := board.FlowNode("gate")
	if node.RemainingPasses != 0 || node.Status != pkgBoards.FlowNodeStatusDone || string(node.Output) != `{"approved":true}` {
		t.Fatalf("first completion = %+v", node)
	}
	if _, err := rt.boards.Ready(rt.handle, "left"); err != nil {
		t.Fatal(err)
	}
	rt.play("gate")
	rt.waitIdle()
	board = rt.board()
	if got := board.FlowNode("right").Status; got != pkgBoards.FlowNodeStatusTodo || board.FlowNode("left").Status != "" {
		t.Fatalf("the exhausted limiter should take only the no-passes-left branch, got %q", got)
	}
	if len(rt.runner.Snapshots()) != 2 {
		t.Fatal("the limiter should continue each run without forking")
	}
}

func exclusiveGatewayBoard(output, routes string) string {
	result := ""
	if output != "" {
		result = `,"output":` + output
	}
	return fmt.Sprintf(`{"flowNodes":[
		{"id":"producer","type":"human","status":"done","onSuccess":{"flowNode":"wait"}%s},
		{"id":"wait","type":"scheduler","at":"2020-01-01T03:00","onSuccess":{"flowNode":"decision"}},
		{"id":"decision","title":"Decision","type":"exclusive-gateway","onSuccess":{"flowNodes":["left","right"]},"routes":%s},
		{"id":"left","type":"scheduler","at":"2020-01-01T03:00"},
		{"id":"right","type":"scheduler","at":"2020-01-01T03:00"}
	]}`, result, routes)
}

// A Gateway fed by two Schedulers: each branch is a flow node that plays itself the instant it is
// taken, so the tests are about the join and the fork rather than about turns.
func gatewayBoard() string {
	return `{"flowNodes":[
		{"id":"branch-1","title":"First branch","type":"scheduler","at":"2020-01-01T03:00",
		 "onSuccess":{"flowNode":"join"}},
		{"id":"branch-2","title":"Second branch","type":"scheduler","at":"2020-01-01T03:00",
		 "onSuccess":{"flowNode":"join"}},
		{"id":"join","title":"Both done?","type":"gateway",
		 "onSuccess":{"flowNodes":["after"]}},
		{"id":"after","title":"After","type":"scheduler","at":"2020-01-01T03:00"}
	]}`
}

// The join: a branch arriving to find the others not yet done leaves the Gateway untouched and
// ends there. Firing it is the last branch's to do.
func TestGatewayWaitsForEveryBranchFeedingIntoIt(t *testing.T) {
	rt := newRunnerTest(t, gatewayBoard())

	rt.play("branch-1")
	rt.waitIdle()

	board := rt.board()
	if board.FlowNode("branch-1").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("branch-1 = %q, want done", board.FlowNode("branch-1").Status)
	}
	if got := board.FlowNode("join").Status; got != "" && got != pkgBoards.FlowNodeStatusReady {
		t.Errorf("join = %q, want it untouched — still ready", got)
	}
	if board.FlowNode("after").Status == pkgBoards.FlowNodeStatusDone {
		t.Error("the branch after the Gateway played before every branch feeding into it was done")
	}
}

// The last branch fires the Gateway: it is marked done, and the run that fired it ends while the
// branch it lists starts as a run of its own.
func TestGatewayFiresOnceEveryBranchIsDone(t *testing.T) {
	rt := newRunnerTest(t, gatewayBoard())

	rt.play("branch-1")
	rt.waitIdle()
	rt.play("branch-2")
	rt.waitIdle()

	board := rt.board()
	if board.FlowNode("join").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("join = %q, want done", board.FlowNode("join").Status)
	}
	if board.FlowNode("after").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("after = %q, want the forked branch played", board.FlowNode("after").Status)
	}
	if runs := rt.runner.Snapshots(); len(runs) != 3 {
		t.Errorf("%d runs, want the two branches and the one forked", len(runs))
	} else {
		var forked *runstate.HarnessChainRunDto
		for _, run := range runs {
			if strings.HasSuffix(run.Name, " / After") {
				forked = run
			}
		}
		if forked == nil {
			t.Error("no run branched from the firing; runs are " + runNames(runs))
		}
	}
}

// The fork: firing a Gateway with two branches starts both, each as a run of its own, and the run
// that fired it ends there.
func TestGatewayForkStartsEveryBranch(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"producer","type":"human","status":"done","output":{"approved":true},"onSuccess":{"flowNode":"fork"}},
		{"id":"untyped","type":"human","status":"done","onSuccess":{"flowNode":"fork"}},
		{"id":"fork","title":"Fork","type":"gateway","onSuccess":{"flowNodes":["left","right"]}},
		{"id":"left","title":"Left","type":"scheduler","at":"2020-01-01T03:00"},
		{"id":"right","title":"Right","type":"scheduler","at":"2020-01-01T03:00"}
	]}`)

	rt.play("fork")
	rt.waitIdle()

	board := rt.board()
	for _, id := range []string{"fork", "left", "right"} {
		node := board.FlowNode(id)
		if node.Status != pkgBoards.FlowNodeStatusDone || string(node.Output) != `[{"approved":true},null]` {
			t.Errorf("%s: status %q, output %s", id, node.Status, node.Output)
		}
	}
	if runs := rt.runner.Snapshots(); len(runs) != 3 {
		t.Errorf("%d runs, want the firing and the two forked", len(runs))
	}
}

// A Gateway whose branches are not all done is refused at the click, naming what it waits for —
// the same rule the Play button follows.
func TestGatewayDirectPlayRefusesWhileBranchesWait(t *testing.T) {
	rt := newRunnerTest(t, gatewayBoard())

	_, err := rt.runner.Play(access.Identity{User: "tester"}, rt.handle, "join", "")
	if err == nil {
		t.Fatal("a Gateway still waiting fired, want it refused")
	}
	if !strings.Contains(err.Error(), "First branch") || !strings.Contains(err.Error(), "Second branch") {
		t.Errorf("refusal = %q, want every branch it waits for named", err.Error())
	}
}

func TestGatewayReplaysAfterEveryBranchCompletesAgain(t *testing.T) {
	rt := newRunnerTest(t, gatewayBoard())
	rt.play("branch-1")
	rt.waitIdle()
	rt.play("branch-2")
	rt.waitIdle()
	first := rt.board()

	// A replayed branch waits while the other result still belongs to the previous firing.
	rt.play("branch-1")
	rt.waitIdle()
	if join := rt.board().FlowNode("join"); join.Completion != first.FlowNode("join").Completion {
		t.Fatalf("join fired before the second branch replayed: %+v", join)
	}
	rt.play("branch-2")
	rt.waitIdle()
	board := rt.board()
	for _, id := range []string{"join", "after"} {
		if node := board.FlowNode(id); node.Status != pkgBoards.FlowNodeStatusDone || node.Completion <= first.FlowNode(id).Completion {
			t.Errorf("%s = %+v, want completed again", id, node)
		}
	}
	if runs := rt.runner.Snapshots(); len(runs) != 6 {
		t.Errorf("%d runs, want two pairs of inputs and one outgoing branch each", len(runs))
	}
}

func TestGatewayStartedAfterHumanSubmissionWaitsForNewResults(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"human","title":"Review","type":"human","status":"done","completion":4,"onSuccess":{"flowNode":"join"}},
		{"id":"auto","title":"Build","type":"scheduler","at":"2020-01-01T03:00","status":"done","completion":2,"onSuccess":{"flowNode":"join"}},
		{"id":"join","title":"Join","type":"gateway","status":"done","completion":3}
	]}`)
	if _, err := rt.runner.Play(access.Identity{User: "tester"}, rt.handle, "join", "", true); err == nil || !strings.Contains(err.Error(), "Build") {
		t.Fatalf("start after the first submission = %v, want the gateway to wait for Build", err)
	}
	if join := rt.board().FlowNode("join"); join.Completion != 3 {
		t.Fatalf("join fired on a previous result: %+v", join)
	}
	rt.play("auto")
	rt.waitIdle()
	if join := rt.board().FlowNode("join"); join.Status != pkgBoards.FlowNodeStatusDone || join.Completion <= 4 {
		t.Fatalf("join did not fire on two new results: %+v", join)
	}
}

// A branch looping back onto a flow node its play has already fired ends instead of forking for ever:
// the fork carries the trail behind it, and a flow node on it starts no branch.
func TestGatewayForkEndsWhereABranchLoopsBack(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"round","title":"Round","type":"scheduler","at":"2020-01-01T03:00",
		 "onSuccess":{"flowNode":"join"}},
		{"id":"join","title":"Again?","type":"gateway","onSuccess":{"flowNodes":["round"]}}
	]}`)

	rt.play("round")
	rt.waitIdle()

	board := rt.board()
	if board.FlowNode("round").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("round = %q, want done", board.FlowNode("round").Status)
	}
	if board.FlowNode("join").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("join = %q, want done", board.FlowNode("join").Status)
	}
	if runs := rt.runner.Snapshots(); len(runs) != 1 {
		t.Errorf("%d runs, want the one play and no fork onto a flow node behind it", len(runs))
	}
}

func TestGatewayBranchDoesNotReplayAFlowNodeFromItsParentRun(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"first","title":"First","type":"scheduler","duration":"1ms","onSuccess":{"flowNode":"fork"}},
		{"id":"fork","title":"Fork","type":"gateway","onSuccess":{"flowNodes":["branch"]}},
		{"id":"branch","title":"Branch","type":"scheduler","duration":"1ms","onSuccess":{"flowNode":"first"}}
	]}`)
	rt.play("first")
	rt.waitIdle()
	board := rt.board()
	first, fork, branch := board.FlowNode("first"), board.FlowNode("fork"), board.FlowNode("branch")
	if first.Completion == 0 || first.Completion >= fork.Completion || fork.Completion >= branch.Completion {
		t.Fatalf("completions = %d, %d, %d; want the parent steps followed by the branch", first.Completion, fork.Completion, branch.Completion)
	}
}

func runNames(runs []*runstate.HarnessChainRunDto) string {
	var names []string
	for _, run := range runs {
		names = append(names, run.Name)
	}
	return strings.Join(names, ", ")
}
