package runnerhttp

import (
	"encoding/json"
	"kiao/worker/internal/core/access"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Hold a terminal notification after its state is visible, while the loop still owns the run.
type terminalNotificationGate struct {
	playback.TurnExecutor
	state   string
	reached chan struct{}
	release chan struct{}
	held    atomic.Bool
}

func (g *terminalNotificationGate) NotifyRegistry(frame map[string]any) {
	if runs, ok := frame["runs"].([]*runstate.HarnessChainRunDto); ok {
		for _, run := range runs {
			if run.State == g.state && g.held.CompareAndSwap(false, true) {
				close(g.reached)
				<-g.release
			}
		}
	}
	g.TurnExecutor.NotifyRegistry(frame)
}

func TestChainReactivationWaitsForPreviousExecution(t *testing.T) {
	for _, resume := range []bool{false, true} {
		for _, invalidate := range []bool{false, true} {
			name := map[bool]string{false: "restart", true: "resume"}[resume]
			if invalidate {
				name += "/changed-while-waiting"
			}
			t.Run(name, func(t *testing.T) {
				board := `{"flowNodes":[{"id":"first","title":"First","type":"scheduler","duration":"1ms"}]}`
				if resume {
					board = chainBoard(pkgBoards.TransitionEnd)
				}
				rt := newRunnerTest(t, board)
				state := playback.ChainRunStateEnded
				if resume {
					state = playback.ChainRunStateSuspended
				}
				gate := &terminalNotificationGate{TurnExecutor: rt.hub, state: state,
					reached: make(chan struct{}), release: make(chan struct{})}
				rt.runner.Hub = gate
				var release sync.Once
				unblock := func() { release.Do(func() { close(gate.release) }) }
				defer unblock()
				if resume {
					rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
						`{"type":"assistant","message":{"content":[{"type":"text","text":"Partial work."}]}}` + "\n")
					rt.play("flow-node-1")
					run := rt.waitTurn()
					rt.waitSaid(run.Chat)
					rt.hub.StopProcess(run.Chat, "tester")
				} else {
					rt.play("first")
				}
				select {
				case <-gate.reached:
				case <-time.After(5 * time.Second):
					t.Fatal("the previous execution did not publish its terminal state")
				}
				run := rt.last()
				rt.runner.Mu.Lock()
				previous := rt.runner.Runs[0].Done
				rt.runner.Mu.Unlock()
				if resume {
					rt.answers("Finished after resuming.", "Finished the successor.")
				} else {
					rt.editFlowNode("first", func(node *pkgBoards.FlowNode) { node.Duration = "1h" })
				}
				entered, result := make(chan struct{}), make(chan error, 1)
				go func() {
					close(entered)
					var err error
					if resume {
						_, err = rt.runner.Resume(access.Identity{User: "tester"}, run.ID)
					} else {
						_, err = rt.runner.Restart(access.Identity{User: "tester"}, run.ID)
					}
					result <- err
				}()
				<-entered
				select {
				case err := <-result:
					t.Fatalf("reactivation returned before the previous loop exited: %v", err)
				case <-time.After(50 * time.Millisecond):
				}
				if got := rt.last().State; got != state {
					t.Fatalf("state while the previous loop is held = %s, want %s", got, state)
				}
				if invalidate {
					if resume {
						if err := rt.runner.Stop(run.ID); err != nil {
							t.Fatal(err)
						}
					} else {
						if err := rt.runner.Forget(run.ID); err != nil {
							t.Fatal(err)
						}
					}
				}
				unblock()
				select {
				case err := <-result:
					if invalidate {
						if err == nil || !strings.Contains(err.Error(), "has changed") {
							t.Fatalf("reactivation = %v, want a changed-run conflict", err)
						}
						return
					}
					if err != nil {
						t.Fatalf("reactivation: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("reactivation did not finish after the previous loop exited")
				}
				select {
				case <-previous:
				default:
					t.Fatal("reactivation returned with the previous execution still active")
				}
				if !resume {
					rt.waitState(playback.ChainRunStateScheduled)
					if err := rt.runner.Stop(run.ID); err != nil {
						t.Fatal(err)
					}
				}
				rt.waitIdle()
				if resume && rt.board().FlowNode("flow-node-2").Status != pkgBoards.FlowNodeStatusDone {
					t.Fatal("the resumed run did not finish its successor")
				}
			})
		}
	}
}

type heldFinishBoards struct {
	pkgBoards.BoardStore
	reached chan struct{}
	release chan struct{}
}

func (b *heldFinishBoards) Finish(handle, node, run, status string, outputs ...json.RawMessage) (*pkgBoards.BoardContent, error) {
	if node == "held" {
		close(b.reached)
		<-b.release
	}
	return b.BoardStore.Finish(handle, node, run, status, outputs...)
}

func TestChainBoardWriteLeavesOtherRunsAndStopAvailable(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
        {"id":"held","title":"Held","type":"scheduler","duration":"1ms"},
        {"id":"free","title":"Free","type":"scheduler","duration":"1ms"}
    ]}`)
	gate := &heldFinishBoards{BoardStore: rt.boards, reached: make(chan struct{}), release: make(chan struct{})}
	rt.runner.Boards = gate
	var release sync.Once
	unblock := func() { release.Do(func() { close(gate.release) }) }
	defer unblock()
	rt.play("held")
	select {
	case <-gate.reached:
	case <-time.After(5 * time.Second):
		t.Fatal("the first run did not reach its board write")
	}
	held := rt.last()
	rt.play("free")
	rt.waitFor("the independent run to finish", func() bool { return rt.last().State == playback.ChainRunStateEnded })
	stopped := make(chan error, 1)
	go func() { stopped <- rt.runner.Stop(held.ID) }()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Stop blocked on a board write")
	}
	unblock()
	rt.waitIdle()
	board := rt.board()
	for _, id := range []string{"held", "free"} {
		if node := board.FlowNode(id); node.Status != pkgBoards.FlowNodeStatusDone || node.Run != "" {
			t.Fatalf("%s after completion = %+v", id, node)
		}
	}
}
