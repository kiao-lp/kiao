package runnerhttp

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"kiao/worker/internal/hybridflow-runner/playback"
)

const bitbucketBoard = `{"flowNodes":[
	{"id":"before","type":"scheduler","at":"2020-01-01T03:00","onSuccess":{"flowNode":"watch"}},
	{"id":"watch","title":"Wait for merge","type":"bitbucket-pr-status","pullRequestId":"42",
	 "pullRequestStatus":"MERGED","onSuccess":{"flowNode":"after"}},
	{"id":"after","type":"human","title":"Publish"}
]}`

const bitbucketCommitBoard = `{"flowNodes":[
	{"id":"before","type":"scheduler","at":"2020-01-01T03:00","onSuccess":{"flowNode":"watch"}},
	{"id":"watch","title":"Wait for builds","type":"bitbucket-commit-status","commitId":"a1b2c3d",
	 "commitStatus":"SUCCESSFUL","onSuccess":{"flowNode":"after"}},
	{"id":"after","type":"human","title":"Publish"}
]}`

type bitbucketTransport func(*http.Request) (*http.Response, error)

func (f bitbucketTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func (rt *runnerTest) configureBitbucket(contents string, transport bitbucketTransport) {
	rt.t.Helper()
	if err := os.WriteFile(filepath.Join(rt.cfg.StatePath, runnerconfig.AtlassianConfigFile), []byte(contents), 0o600); err != nil {
		rt.t.Fatal(err)
	}
	rt.runner.BitbucketClient.Transport = transport
	rt.runner.BitbucketInterval = time.Millisecond
}

func TestBitbucketPRStatusChainsOnlyWhenTheTargetMatches(t *testing.T) {
	rt := newRunnerTest(t, bitbucketBoard)
	waiting, merged := make(chan struct{}), make(chan struct{})
	checks := 0
	rt.configureBitbucket(`{"bitbucket":{"workspace":"team","repository":"repo","token":"fixture"}}`, func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.String() != "https://api.bitbucket.org/2.0/repositories/team/repo/pullrequests/42?fields=state" ||
			req.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("incorrect Bitbucket request")
		}
		checks++
		status, body := http.StatusOK, `{"state":"OPEN"}`
		switch checks {
		case 2:
			status, body = http.StatusTooManyRequests, ""
		case 3:
			close(waiting)
			select {
			case <-merged:
			case <-req.Context().Done():
				return nil, req.Context().Err()
			}
			body = `{"state":"MERGED"}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	rt.play("before")
	select {
	case <-waiting:
	case <-time.After(3 * time.Second):
		t.Fatal("the event did not poll again")
	}
	rt.waitState(playback.ChainRunStatePolling)
	board := rt.board()
	if board.FlowNode("watch").Status != pkgBoards.FlowNodeStatusRunning || board.FlowNode("after").Status != "" {
		t.Fatal("the successor started before the Bitbucket status matched")
	}
	close(merged)
	rt.waitIdle()
	board = rt.board()
	if board.FlowNode("watch").Status != pkgBoards.FlowNodeStatusDone || board.FlowNode("after").Status != pkgBoards.FlowNodeStatusTodo {
		t.Fatal("the matched event did not complete and activate its successor")
	}
}

func TestBitbucketEventForwardsTheInputItStartedWith(t *testing.T) {
	rt := outputRunner(t)
	rt.boards.mu.Lock()
	board := rt.boards.boards[rt.handle]
	board.FlowNode("flow-node-1").OnSuccess.FlowNode = "watch"
	board.FlowNodes = append(board.FlowNodes, pkgBoards.FlowNode{
		ID: "watch", Type: pkgBoards.FlowNodeTypeBitbucketPRStatus,
		PullRequestID: "team/repo#{{input.pullRequestId}}", PullRequestStatus: "{{input.targetStatus}}",
		OnSuccess: pkgBoards.FlowNodeSuccess{FlowNode: "flow-node-2"},
	})
	rt.boards.mu.Unlock()
	const first = `{"message":"first","pullRequestId":42,"targetStatus":"merged"}`
	const second = `{"message":"second","pullRequestId":43,"targetStatus":"open"}`
	rt.answers("```output\n"+first+"\n```", "```output\n"+second+"\n```", "Received it.")

	waiting, match := make(chan struct{}), make(chan struct{}, 1)
	defer close(match)
	rt.configureBitbucket(`{"bitbucket":{"workspace":"team","repository":"repo","token":"fixture"}}`, func(req *http.Request) (*http.Response, error) {
		if got := req.URL.Path; got != "/2.0/repositories/team/repo/pullrequests/42" {
			t.Errorf("Bitbucket path = %q", got)
		}
		close(waiting)
		select {
		case <-match:
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"state":"MERGED"}`))}, nil
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	})
	rt.play("flow-node-1")
	select {
	case <-waiting:
	case <-time.After(3 * time.Second):
		t.Fatal("the event did not start waiting")
	}
	rt.play("flow-node-1")
	rt.waitFor("the replay of the producer to end", func() bool { return rt.last().State == playback.ChainRunStateEnded })
	if got := string(rt.board().FlowNode("flow-node-1").Output); got != second {
		t.Fatalf("replayed producer output = %s", got)
	}
	match <- struct{}{}
	rt.waitIdle()
	if got := string(rt.board().FlowNode("watch").Output); got != first {
		t.Errorf("event output = %s, want the original input", got)
	}
	if prompts := rt.prompts(); len(prompts) != 3 || prompts[2] != "Received: first." {
		t.Fatalf("prompts = %q", prompts)
	}
}

func TestBitbucketCommitStatusWaitsForAllBuildsToSucceed(t *testing.T) {
	rt := newRunnerTest(t, `{
		"flowNodes":[
			{"id":"target","type":"role","roleId":"targetStatus","people":["successful"]},
			{"id":"before","type":"scheduler","at":"2020-01-01T03:00","onSuccess":{"flowNode":"watch"}},
			{"id":"watch","title":"Wait for builds","type":"bitbucket-commit-status","workflow":"release",
			 "commitId":"{{currentWorkflow.commitId}}","commitStatus":"{{ role.targetStatus }}","onSuccess":{"flowNode":"after"}},
			{"id":"after","type":"human","title":"Publish"}
		],
		"workflows":[{"id":"release","values":{"commitId":"a1b2c3d"}}]
	}`)
	waiting, successful := make(chan struct{}), make(chan struct{})
	const endpoint = "https://api.bitbucket.org/2.0/repositories/team/repo/commit/a1b2c3d/statuses"
	const nextPage = endpoint + "?page=2&fields=next,values.state"
	checks := 0
	rt.configureBitbucket(`{"bitbucket":{"workspace":"team","repository":"repo","token":"fixture"}}`, func(req *http.Request) (*http.Response, error) {
		checks++
		wantURL := endpoint + "?fields=next,values.state"
		if checks == 3 {
			wantURL = nextPage
		}
		if req.Method != http.MethodGet || req.URL.String() != wantURL || req.Header.Get("Authorization") != "Bearer fixture" {
			t.Errorf("incorrect Bitbucket commit status request: %s %s", req.Method, req.URL)
		}
		var body string
		switch checks {
		case 1:
			body = `{"values":[]}`
		case 2:
			body = `{"values":[{"state":"SUCCESSFUL"}],"next":"` + nextPage + `"}`
		case 3:
			body = `{"values":[{"state":"FAILED"}]}`
		default:
			close(waiting)
			select {
			case <-successful:
			case <-req.Context().Done():
				return nil, req.Context().Err()
			}
			body = `{"values":[{"state":"SUCCESSFUL"},{"state":"SUCCESSFUL"}]}`
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	rt.play("before")
	select {
	case <-waiting:
	case <-time.After(3 * time.Second):
		t.Fatal("the event did not poll after seeing a failed build")
	}
	rt.waitState(playback.ChainRunStatePolling)
	board := rt.board()
	if board.FlowNode("watch").Status != pkgBoards.FlowNodeStatusRunning || board.FlowNode("after").Status != "" {
		t.Fatal("the successor started before the commit status matched")
	}
	close(successful)
	rt.waitIdle()
	board = rt.board()
	if board.FlowNode("watch").Status != pkgBoards.FlowNodeStatusDone || board.FlowNode("after").Status != pkgBoards.FlowNodeStatusTodo {
		t.Fatal("the matched event did not complete and activate its successor")
	}
}

func TestBitbucketStatusRejectsMissingOrInvalidReferencesBeforePolling(t *testing.T) {
	for _, tc := range []struct{ name, id, status string }{
		{"missing input", "{{input.pullRequestId}}", "MERGED"},
		{"invalid ID", "{{currentWorkflow.invalidId}}", "MERGED"},
		{"invalid status", "42", "{{currentWorkflow.invalidStatus}}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := newRunnerTest(t, `{
				"flowNodes":[
					{"id":"watch","type":"bitbucket-pr-status","workflow":"release","pullRequestId":"`+tc.id+`",
					 "pullRequestStatus":"`+tc.status+`","onSuccess":{"flowNode":"after"}},
					{"id":"after","type":"human","title":"Publish"}
				],
				"workflows":[{"id":"release","values":{"invalidId":false,"invalidStatus":"APPROVED"}}]
			}`)
			rt.configureBitbucket(`{"bitbucket":{"workspace":"team","repository":"repo","token":"fixture"}}`, func(req *http.Request) (*http.Response, error) {
				t.Errorf("the event issued a request for invalid fields: %s", req.URL)
				return &http.Response{StatusCode: http.StatusBadRequest, Body: io.NopCloser(strings.NewReader(""))}, nil
			})
			rt.play("watch")
			rt.waitIdle()
			board := rt.board()
			if watch := board.FlowNode("watch"); watch.Status != pkgBoards.FlowNodeStatusError ||
				watch.PullRequestID != tc.id || watch.PullRequestStatus != tc.status {
				t.Errorf("event = %+v, want an error and the original expressions", watch)
			}
			if after := board.FlowNode("after"); after.Status != "" {
				t.Errorf("successor status = %q, want ready", after.Status)
			}
		})
	}
}

func TestBitbucketStatusStopCancelsTheRequest(t *testing.T) {
	for _, tc := range []struct{ name, board, path string }{
		{"pull request", strings.Replace(bitbucketBoard, `"42"`, `"team/repo#42"`, 1), "/pullrequests/42"},
		{"commit", strings.Replace(bitbucketCommitBoard, `"a1b2c3d"`, `"team/repo@a1b2c3d"`, 1), "/commit/a1b2c3d/statuses"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := newRunnerTest(t, tc.board)
			requested, canceled := make(chan struct{}), make(chan struct{})
			rt.configureBitbucket(`{"bitbucket":{"email":"user@example.com","token":"fixture"}}`, func(req *http.Request) (*http.Response, error) {
				email, token, ok := req.BasicAuth()
				if !ok || email != "user@example.com" || token != "fixture" || req.URL.Path != "/2.0/repositories/team/repo"+tc.path {
					t.Error("incorrect Bitbucket request for scoped ID")
				}
				close(requested)
				<-req.Context().Done()
				close(canceled)
				return nil, req.Context().Err()
			})
			rt.play("watch")
			select {
			case <-requested:
			case <-time.After(3 * time.Second):
				t.Fatal("the event did not request the Bitbucket state")
			}
			rt.stop()
			rt.waitIdle()
			select {
			case <-canceled:
			default:
				t.Fatal("the Bitbucket request was not canceled")
			}
			board := rt.board()
			if board.FlowNode("watch").Status != pkgBoards.FlowNodeStatusInterrupted || board.FlowNode("after").Status != "" {
				t.Fatal("stopping the event did not interrupt it and leave its successor ready")
			}
		})
	}
}
