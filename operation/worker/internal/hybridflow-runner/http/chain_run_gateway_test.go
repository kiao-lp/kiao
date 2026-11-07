package runnerhttp

import (
	"kiao/worker/internal/core/access"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"strings"
	"testing"
)

// A Gateway fed by two Schedulers: each branch is a card that plays itself the instant it is
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
		var forked *runstate.AgentChainRunDto
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
		{"id":"fork","title":"Fork","type":"gateway","onSuccess":{"flowNodes":["left","right"]}},
		{"id":"left","title":"Left","type":"scheduler","at":"2020-01-01T03:00"},
		{"id":"right","title":"Right","type":"scheduler","at":"2020-01-01T03:00"}
	]}`)

	rt.play("fork")
	rt.waitIdle()

	board := rt.board()
	for _, id := range []string{"fork", "left", "right"} {
		if board.FlowNode(id).Status != pkgBoards.FlowNodeStatusDone {
			t.Errorf("%s = %q, want done", id, board.FlowNode(id).Status)
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

// Branches played again after the Gateway went through find it already fired: there is nothing to
// fire a second time, and no branch starts from it again.
func TestGatewayFiredAlreadyEndsTheReplayedBranch(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"branch-1","title":"First branch","type":"scheduler","at":"2020-01-01T03:00",
		 "onSuccess":{"flowNode":"join"}},
		{"id":"join","title":"Both done?","type":"gateway","status":"done",
		 "onSuccess":{"flowNodes":["after"]}},
		{"id":"after","title":"After","type":"scheduler","at":"2020-01-01T03:00"}
	]}`)

	rt.play("branch-1")
	rt.waitIdle()

	board := rt.board()
	if board.FlowNode("join").Status != pkgBoards.FlowNodeStatusDone {
		t.Errorf("join = %q, want done", board.FlowNode("join").Status)
	}
	if board.FlowNode("after").Status == pkgBoards.FlowNodeStatusDone {
		t.Error("the replayed branch fired the Gateway a second time")
	}
	if runs := rt.runner.Snapshots(); len(runs) != 1 {
		t.Errorf("%d runs, want the replay alone and nothing forked", len(runs))
	}
}

// A branch looping back onto a card its play has already fired ends instead of forking for ever:
// the fork carries the trail behind it, and a card on it starts no branch.
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
		t.Errorf("%d runs, want the one play and no fork onto a card behind it", len(runs))
	}
}

func runNames(runs []*runstate.AgentChainRunDto) string {
	var names []string
	for _, run := range runs {
		names = append(names, run.Name)
	}
	return strings.Join(names, ", ")
}
