package runnerhttp

import (
	"kiao/worker/internal/core/access"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	"strings"
	"testing"
)

func TestChainRevalidatesBeforeRestartAndResume(t *testing.T) {
	for _, resume := range []bool{false, true} {
		t.Run(map[bool]string{false: "restart", true: "resume"}[resume], func(t *testing.T) {
			rt := newRunnerTest(t, `{"flowNodes":[{"id":"first","title":"First","type":"scheduler","duration":"1ms"}]}`)
			rt.play("first")
			rt.waitIdle()
			run := rt.last()
			rt.boards.mu.Lock()
			for _, id := range []string{"one", "two"} {
				rt.boards.boards[rt.handle].FlowNodes = append(rt.boards.boards[rt.handle].FlowNodes, pkgBoards.FlowNode{
					ID: id, Title: id, Type: pkgBoards.FlowNodeTypeScheduler, Duration: "1ms",
					OnSuccess: pkgBoards.FlowNodeSuccess{FlowNode: "first"},
				})
			}
			rt.boards.mu.Unlock()
			var err error
			if resume {
				rt.runner.Mu.Lock()
				rt.runner.Runs[0].State = playback.ChainRunStateSuspended
				rt.runner.Mu.Unlock()
				_, err = rt.runner.Resume(access.Identity{User: "tester"}, run.ID)
			} else {
				_, err = rt.runner.Restart(access.Identity{User: "tester"}, run.ID)
			}
			if err == nil || !strings.Contains(err.Error(), "one predecessor") {
				t.Fatalf("start = %v", err)
			}
			state := playback.ChainRunStateEnded
			if resume {
				state = playback.ChainRunStateSuspended
			}
			if rt.last().State != state {
				t.Fatalf("state after refusal = %s", rt.last().State)
			}
		})
	}
}

func TestChainRefusesInvalidConnectionsBeforeStarting(t *testing.T) {
	for _, kind := range []string{"ai", "human", "scheduler", "shutdown"} {
		t.Run(kind, func(t *testing.T) {
			rt := newRunnerTest(t, `{"flowNodes":[
                {"id":"first","title":"First","type":"scheduler","duration":"1s","onSuccess":{"flowNode":"target"}},
                {"id":"second","title":"Second","type":"gateway","onSuccess":{"flowNodes":["target"]}},
                {"id":"target","title":"Target","type":"`+kind+`"}
            ]}`)
			_, err := rt.runner.Play(access.Identity{User: "tester"}, rt.handle, "first", "Invalid join")
			if err == nil || !strings.Contains(err.Error(), "one predecessor") || !strings.Contains(err.Error(), "Target") {
				t.Fatalf("play = %v, want the invalid join named", err)
			}
			if len(rt.runner.Snapshots()) != 0 {
				t.Fatal("an invalid chain started a run")
			}
			if rt.board().FlowNode("first").Status != "" {
				t.Fatal("an invalid chain changed its first card")
			}
		})
	}
}

func TestChainChecksDownstreamShutdownSuccessors(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
        {"id":"first","title":"First","type":"scheduler","duration":"1s","onSuccess":{"flowNode":"off"}},
        {"id":"off","title":"Shutdown","type":"shutdown","onSuccess":{"flowNode":"after"}},
        {"id":"after","title":"After","type":"scheduler","duration":"1s"}
    ]}`)
	_, err := rt.runner.Play(access.Identity{User: "tester"}, rt.handle, "first", "Invalid shutdown")
	if err == nil || !strings.Contains(err.Error(), "cannot have a successor") {
		t.Fatalf("play = %v", err)
	}
	if len(rt.runner.Snapshots()) != 0 {
		t.Fatal("an invalid chain started a run")
	}
}

func TestChainRefusesMultipleTaskSuccessors(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
        {"id":"first","title":"First","type":"scheduler","duration":"1s",
         "onSuccess":{"flowNodes":["left","right"]}},
        {"id":"left","title":"Left","type":"scheduler","duration":"1s"},
        {"id":"right","title":"Right","type":"scheduler","duration":"1s"}
    ]}`)
	_, err := rt.runner.Play(access.Identity{User: "tester"}, rt.handle, "first", "Invalid split")
	if err == nil || !strings.Contains(err.Error(), "one successor") {
		t.Fatalf("play = %v", err)
	}
}
