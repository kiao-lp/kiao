package playback

import (
	"encoding/json"
	"fmt"
	httpkit "kiao/worker/internal/core/http"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"net/http"
	"sync"
	"testing"
	"time"
)

// Both arrivals read an unfired gateway. The winner holds its claim until the loser tries it.
type gatewayRaceBoards struct {
	pkgBoards.BoardStore
	mu                        sync.Mutex
	node                      pkgBoards.FlowNode
	reads, claims, finishes   int
	readBarrier, claimBarrier chan struct{}
}

func (b *gatewayRaceBoards) boardLocked() *pkgBoards.BoardContent {
	return &pkgBoards.BoardContent{FlowNodes: []pkgBoards.FlowNode{b.node}}
}

func (b *gatewayRaceBoards) Board(string) (*pkgBoards.BoardContent, error) {
	b.mu.Lock()
	board := b.boardLocked()
	b.reads++
	initial := b.reads <= 2
	if b.reads == 2 {
		close(b.readBarrier)
	}
	b.mu.Unlock()
	if initial {
		select {
		case <-b.readBarrier:
		case <-time.After(2 * time.Second):
			return nil, fmt.Errorf("the second gateway arrival never read the board")
		}
	}
	return board, nil
}

func (b *gatewayRaceBoards) Start(_, _, run string) (*pkgBoards.BoardContent, error) {
	b.mu.Lock()
	b.claims++
	if b.node.Run != "" {
		close(b.claimBarrier)
		b.mu.Unlock()
		return nil, &httpkit.HTTPError{Status: http.StatusConflict, Msg: "gateway already claimed"}
	}
	b.node.Run = run
	board := b.boardLocked()
	b.mu.Unlock()
	select {
	case <-b.claimBarrier:
		return board, nil
	case <-time.After(2 * time.Second):
		return nil, fmt.Errorf("the second gateway arrival never attempted its claim")
	}
}

func (b *gatewayRaceBoards) Finish(_, _, run, status string, _ ...json.RawMessage) (*pkgBoards.BoardContent, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.node.Run != run {
		return nil, fmt.Errorf("completion without the gateway claim")
	}
	b.finishes++
	b.node.Run, b.node.Status = "", status
	return b.boardLocked(), nil
}

func TestConcurrentGatewayArrivalsOnlyFireOnce(t *testing.T) {
	gateway := pkgBoards.FlowNode{ID: "join", Title: "Join", Type: pkgBoards.FlowNodeTypeGateway}
	boards := &gatewayRaceBoards{node: gateway, readBarrier: make(chan struct{}), claimBarrier: make(chan struct{})}
	runner := &ChainRunner{Boards: boards}
	for _, id := range []string{"left", "right"} {
		runner.Runs = append(runner.Runs, &ChainRun{Id: id, Handle: "board", FlowNodeID: id, State: ChainRunStatePlaying})
	}
	results := make(chan PlayOneOutcome, 2)
	for _, run := range runner.Runs {
		go func(run *ChainRun) {
			out, _ := runner.playGateway(run, gateway, PlayOneOutcome{Title: gateway.Title})
			results <- out
		}(run)
	}
	for range runner.Runs {
		select {
		case out := <-results:
			if out.Round != roundStop {
				t.Fatalf("gateway outcome = %+v, want the arriving run to end", out)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("a gateway arrival did not finish")
		}
	}
	boards.mu.Lock()
	defer boards.mu.Unlock()
	if boards.claims != 2 || boards.finishes != 1 || boards.node.Status != pkgBoards.FlowNodeStatusDone || boards.node.Run != "" {
		t.Fatalf("claims = %d, completions = %d, gateway = %+v", boards.claims, boards.finishes, boards.node)
	}
}
