package runnerhttp

import (
	"io"
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// boardStub is a hybridflow-store that records what it was asked and answers what it was told:
// the upstream the boards proxy is tested against.
type boardStub struct {
	t *testing.T

	method        string
	path          string
	query         string
	authorization string
	actor         string
	ifMatch       string
	body          string

	status int
	answer string
}

func (s *boardStub) handler(w http.ResponseWriter, r *http.Request) {
	// EscapedPath, not Path: the server decodes %20 back to a space, and what the proxy put
	// on the wire is the escaped form.
	s.method, s.path, s.query = r.Method, r.URL.EscapedPath(), r.URL.RawQuery
	s.authorization = r.Header.Get("Authorization")
	s.actor = r.Header.Get("X-Kiao-Actor")
	s.ifMatch = r.Header.Get("If-Match")
	data, err := io.ReadAll(r.Body)
	if err != nil {
		s.t.Errorf("cannot read the proxied body: %v", err)
	}
	s.body = string(data)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(s.status)
	_, _ = w.Write([]byte(s.answer))
}

// boardsTestService is a Service whose boards endpoints proxy to the stub: prod auth mode, so a
// call with no credential is refused by the middleware rather than permitted, and a turn-token
// registry holding one token for alex.
func boardsTestService(t *testing.T, stub *boardStub) (*Service, string) {
	t.Helper()
	registry := access.NewTurnTokenRegistry()
	token, err := registry.Issue(access.Identity{User: "alex"}, "conv/turn1")
	if err != nil {
		t.Fatalf("cannot mint a turn token: %v", err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(stub.handler))
	t.Cleanup(upstream.Close)
	svc := &Service{
		cfg:            &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "prod"}},
		turnTokens:     registry,
		boardsUpstream: pkgBoards.NewHybridflowStore(upstream.URL, "svc-token"),
	}
	return svc, token
}

func boardsRequest(t *testing.T, method, target, token, body string) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

// A turn token is the credential these endpoints exist for: the call is proxied with the service
// token, and the actor the store records is the token's owner.
func TestBoardsProxyCreatesABoardOnATurnToken(t *testing.T) {
	stub := &boardStub{t: t, status: http.StatusCreated,
		answer: `{"board":{"id":"b1","name":"Major","slug":"major"},"flowNodes":[],"cursor":1}`}
	svc, token := boardsTestService(t, stub)

	res := do(svc, boardsRequest(t, http.MethodPost, "/hybridflow-runner/boards", token, `{"name":"Major"}`))

	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", res.Code, res.Body.String())
	}
	if res.Body.String() != stub.answer {
		t.Errorf("body = %s, want the store's answer verbatim", res.Body.String())
	}
	if stub.method != http.MethodPost || stub.path != "/boards" {
		t.Errorf("upstream got %s %s, want POST /boards", stub.method, stub.path)
	}
	if stub.authorization != "Bearer svc-token" {
		t.Errorf("upstream Authorization = %q, want the service token", stub.authorization)
	}
	if stub.actor != "alex" {
		t.Errorf("upstream X-Kiao-Actor = %q, want the turn's owner", stub.actor)
	}
	if !strings.Contains(stub.body, `"Major"`) {
		t.Errorf("upstream body = %s, want the board name", stub.body)
	}
}

// Without a credential the middleware refuses before the proxy is even reached.
func TestBoardsProxyRefusesACallWithNoCredential(t *testing.T) {
	stub := &boardStub{t: t, status: http.StatusCreated, answer: `{}`}
	svc, _ := boardsTestService(t, stub)

	res := do(svc, boardsRequest(t, http.MethodPost, "/hybridflow-runner/boards", "", `{"name":"Major"}`))

	if res.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", res.Code)
	}
	if stub.method != "" {
		t.Errorf("the store was asked %s %s, want nothing proxied", stub.method, stub.path)
	}
}

// A client-supplied actor is ignored: what the store records is who the credential says the
// caller is, never what the caller claimed.
func TestBoardsProxyIgnoresAClientSuppliedActor(t *testing.T) {
	stub := &boardStub{t: t, status: http.StatusOK, answer: `{"flowNodes":[]}`}
	svc, token := boardsTestService(t, stub)

	req := boardsRequest(t, http.MethodGet, "/hybridflow-runner/boards/major", token, "")
	req.Header.Set("X-Kiao-Actor", "mallory")
	res := do(svc, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", res.Code, res.Body.String())
	}
	if stub.actor != "alex" {
		t.Errorf("upstream X-Kiao-Actor = %q, want the turn's owner and not the header it sent", stub.actor)
	}
}

// Where no hybridflow-store is named the endpoints refuse with the variable that would name one.
func TestBoardsProxyRefusesWhereNoStoreIsNamed(t *testing.T) {
	svc := &Service{cfg: &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "debug"}}}

	for _, tc := range []struct{ method, target, body string }{
		{http.MethodGet, "/hybridflow-runner/boards", ""},
		{http.MethodPost, "/hybridflow-runner/boards", `{"name":"Major"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major", `{"name":"Majeur"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes", `{"flowNodes":[{"title":"Card"}]}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-nodes/card-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/flow-nodes/card-1", `{"title":"Renamed"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-nodes", `{"flowNodes":["card-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/chain", `{"flowNode":"card-2"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-nodes/card-1/usage", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/to-class", ""},
		{http.MethodGet, "/hybridflow-runner/flow-node-classes", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes", `{"title":"Class"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-node-classes/class-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/flow-node-classes/class-1", `{"title":"Renamed"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-node-classes", `{"flowNodeClasses":["class-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/chain", `{"flowNode":"class-2"}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions", `{"body":"v2"}`},
		{http.MethodPatch, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions/ver-1", `{"body":"v2"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions/ver-1", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/instantiate", `{}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflows", `{"name":"Sprint"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/workflows/wf-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/workflows/wf-1", `{"name":"Release"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/workflows", `{"workflows":["wf-1"]}`},
		{http.MethodGet, "/hybridflow-runner/workflow-classes", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflow-classes", `{"name":"Sprint"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/workflow-classes/wc-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/workflow-classes/wc-1", `{"name":"Release"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/workflow-classes", `{"workflowClasses":["wc-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflow-classes/wc-1/instantiate", `{}`},
		{http.MethodGet, "/hybridflow-runner/agents", ""},
		{http.MethodPost, "/hybridflow-runner/agents", `{"name":"Reviewer","platform":"claude"}`},
		{http.MethodGet, "/hybridflow-runner/agents/agent-1", ""},
		{http.MethodPatch, "/hybridflow-runner/agents/agent-1", `{"model":"sonnet"}`},
		{http.MethodDelete, "/hybridflow-runner/agents/agent-1", ""},
		{http.MethodGet, "/hybridflow-runner/runners", ""},
		{http.MethodPost, "/hybridflow-runner/runners", `{"name":"local"}`},
		{http.MethodGet, "/hybridflow-runner/runners/runner-1", ""},
		{http.MethodPatch, "/hybridflow-runner/runners/runner-1", `{"name":"remote"}`},
		{http.MethodDelete, "/hybridflow-runner/runners/runner-1", ""},
		{http.MethodGet, "/hybridflow-runner/changes?since=1&board=b1", ""},
		{http.MethodGet, "/hybridflow-runner/schema", ""},
	} {
		res := do(svc, boardsRequest(t, tc.method, tc.target, "", tc.body))
		if res.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s: status = %d, want 503", tc.method, tc.target, res.Code)
		}
		if !strings.Contains(res.Body.String(), "KIAO_WORKER_HYBRIDFLOW_URL") {
			t.Errorf("%s %s: body = %q, want the variable that would name a store", tc.method, tc.target, res.Body.String())
		}
	}
}

// Reads, writes and refusals cross the proxy unchanged: the handle is escaped, If-Match is
// forwarded, and the store's own refusal is the caller's to read.
func TestBoardsProxyForwardsReadsWritesAndRefusals(t *testing.T) {
	stub := &boardStub{t: t, status: http.StatusOK, answer: `{"id":"card-1","title":"Renamed"}`}
	svc, token := boardsTestService(t, stub)

	req := boardsRequest(t, http.MethodPatch, "/hybridflow-runner/boards/major/flow-nodes/card-1", token, `{"title":"Renamed"}`)
	req.Header.Set("If-Match", "7")
	res := do(svc, req)
	if res.Code != http.StatusOK {
		t.Fatalf("patch status = %d, want 200; body: %s", res.Code, res.Body.String())
	}
	if stub.path != "/boards/major/flow-nodes/card-1" {
		t.Errorf("upstream path = %s, want the card's", stub.path)
	}
	if stub.ifMatch != "7" {
		t.Errorf("upstream If-Match = %q, want the conditional write forwarded", stub.ifMatch)
	}
	if res.Body.String() != stub.answer {
		t.Errorf("body = %s, want the store's answer verbatim", res.Body.String())
	}

	// A handle that needs escaping is escaped, not refused.
	res = do(svc, boardsRequest(t, http.MethodGet, "/hybridflow-runner/boards/my%20board", token, ""))
	if res.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200; body: %s", res.Code, res.Body.String())
	}
	if stub.path != "/boards/my%20board" {
		t.Errorf("upstream path = %s, want the handle escaped", stub.path)
	}

	// The store's refusal crosses untouched: status, body and all.
	stub.status, stub.answer = http.StatusConflict, `{"error":"the revision has moved on"}`
	res = do(svc, boardsRequest(t, http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes", token,
		`{"flowNodes":[{"title":"Card"}]}`))
	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want the store's 409", res.Code)
	}
	if res.Body.String() != stub.answer {
		t.Errorf("body = %s, want the store's refusal verbatim", res.Body.String())
	}
}

// play, played and settle are the runner's alone: no route here reaches them — nor the usage
// report a turn files, nor the heartbeat a runner stamps.
func TestBoardsProxyExposesNoRunnerRoutes(t *testing.T) {
	stub := &boardStub{t: t, status: http.StatusOK, answer: `{}`}
	svc, token := boardsTestService(t, stub)

	for _, tc := range []struct{ method, target, body string }{
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/play", `{"run":"run-1"}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/played", `{"run":"run-1","status":"done"}`},
		{http.MethodPost, "/hybridflow-runner/runs/run-1/settle", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/usage", `{"inputTokens":1}`},
		{http.MethodPost, "/hybridflow-runner/runners/runner-1/heartbeat", ""},
	} {
		res := do(svc, boardsRequest(t, tc.method, tc.target, token, tc.body))
		// 405 where the path exists under another method (POST on the usage totals' GET):
		// the method is still unreached, and the store is still asked nothing.
		if res.Code != http.StatusNotFound && res.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: status = %d, want no such route", tc.method, tc.target, res.Code)
		}
	}
	if stub.method != "" {
		t.Errorf("the store was asked %s %s, want nothing proxied", stub.method, stub.path)
	}
}

// Every safe route forwards to the same path upstream: the table pins the mapping, so a handler
// wired to the wrong upstream path fails here rather than in a turn.
func TestBoardsProxyForwardsEverySafeRoute(t *testing.T) {
	for _, tc := range []struct {
		method, target, wantMethod, wantPath, body string
	}{
		{http.MethodGet, "/hybridflow-runner/boards", http.MethodGet, "/boards", ""},
		{http.MethodGet, "/hybridflow-runner/boards?archived=1", http.MethodGet, "/boards", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major", http.MethodPatch, "/boards/major", `{"name":"Majeur"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major", http.MethodDelete, "/boards/major", ""},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-nodes/card-1", http.MethodGet, "/boards/major/flow-nodes/card-1", ""},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-nodes", http.MethodDelete, "/boards/major/flow-nodes", `{"flowNodes":["card-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/chain", http.MethodPost, "/boards/major/flow-nodes/card-1/chain", `{"flowNode":"card-2"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-nodes/card-1/usage", http.MethodGet, "/boards/major/flow-nodes/card-1/usage", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-nodes/card-1/to-class", http.MethodPost, "/boards/major/flow-nodes/card-1/to-class", ""},
		{http.MethodGet, "/hybridflow-runner/flow-node-classes", http.MethodGet, "/flow-node-classes", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes", http.MethodPost, "/boards/major/flow-node-classes", `{"title":"Class"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/flow-node-classes/class-1", http.MethodGet, "/boards/major/flow-node-classes/class-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/flow-node-classes/class-1", http.MethodPatch, "/boards/major/flow-node-classes/class-1", `{"title":"Renamed"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-node-classes", http.MethodDelete, "/boards/major/flow-node-classes", `{"flowNodeClasses":["class-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/chain", http.MethodPost, "/boards/major/flow-node-classes/class-1/chain", `{"flowNode":"class-2"}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions", http.MethodPost, "/boards/major/flow-node-classes/class-1/versions", `{"body":"v2"}`},
		{http.MethodPatch, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions/ver-1", http.MethodPatch, "/boards/major/flow-node-classes/class-1/versions/ver-1", `{"body":"v2"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/flow-node-classes/class-1/versions/ver-1", http.MethodDelete, "/boards/major/flow-node-classes/class-1/versions/ver-1", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/flow-node-classes/class-1/instantiate", http.MethodPost, "/boards/major/flow-node-classes/class-1/instantiate", `{}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflows", http.MethodPost, "/boards/major/workflows", `{"name":"Sprint"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/workflows/wf-1", http.MethodGet, "/boards/major/workflows/wf-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/workflows/wf-1", http.MethodPatch, "/boards/major/workflows/wf-1", `{"name":"Release"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/workflows", http.MethodDelete, "/boards/major/workflows", `{"workflows":["wf-1"]}`},
		{http.MethodGet, "/hybridflow-runner/workflow-classes", http.MethodGet, "/workflow-classes", ""},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflow-classes", http.MethodPost, "/boards/major/workflow-classes", `{"name":"Sprint"}`},
		{http.MethodGet, "/hybridflow-runner/boards/major/workflow-classes/wc-1", http.MethodGet, "/boards/major/workflow-classes/wc-1", ""},
		{http.MethodPatch, "/hybridflow-runner/boards/major/workflow-classes/wc-1", http.MethodPatch, "/boards/major/workflow-classes/wc-1", `{"name":"Release"}`},
		{http.MethodDelete, "/hybridflow-runner/boards/major/workflow-classes", http.MethodDelete, "/boards/major/workflow-classes", `{"workflowClasses":["wc-1"]}`},
		{http.MethodPost, "/hybridflow-runner/boards/major/workflow-classes/wc-1/instantiate", http.MethodPost, "/boards/major/workflow-classes/wc-1/instantiate", `{}`},
		{http.MethodGet, "/hybridflow-runner/agents", http.MethodGet, "/agents", ""},
		{http.MethodPost, "/hybridflow-runner/agents", http.MethodPost, "/agents", `{"name":"Reviewer","platform":"claude"}`},
		{http.MethodGet, "/hybridflow-runner/agents/agent-1", http.MethodGet, "/agents/agent-1", ""},
		{http.MethodPatch, "/hybridflow-runner/agents/agent-1", http.MethodPatch, "/agents/agent-1", `{"model":"sonnet"}`},
		{http.MethodDelete, "/hybridflow-runner/agents/agent-1", http.MethodDelete, "/agents/agent-1", ""},
		{http.MethodGet, "/hybridflow-runner/runners", http.MethodGet, "/runners", ""},
		{http.MethodPost, "/hybridflow-runner/runners", http.MethodPost, "/runners", `{"name":"local"}`},
		{http.MethodGet, "/hybridflow-runner/runners/runner-1", http.MethodGet, "/runners/runner-1", ""},
		{http.MethodPatch, "/hybridflow-runner/runners/runner-1", http.MethodPatch, "/runners/runner-1", `{"name":"remote"}`},
		{http.MethodDelete, "/hybridflow-runner/runners/runner-1", http.MethodDelete, "/runners/runner-1", ""},
		{http.MethodGet, "/hybridflow-runner/changes?since=1&board=b1", http.MethodGet, "/changes", ""},
		{http.MethodGet, "/hybridflow-runner/schema", http.MethodGet, "/schema", ""},
	} {
		stub := &boardStub{t: t, status: http.StatusOK, answer: `{}`}
		svc, token := boardsTestService(t, stub)
		res := do(svc, boardsRequest(t, tc.method, tc.target, token, tc.body))
		if res.Code != http.StatusOK {
			t.Errorf("%s %s: status = %d, want 200; body: %s", tc.method, tc.target, res.Code, res.Body.String())
			continue
		}
		if stub.method != tc.wantMethod || stub.path != tc.wantPath {
			t.Errorf("%s %s: upstream got %s %s, want %s %s", tc.method, tc.target, stub.method, stub.path, tc.wantMethod, tc.wantPath)
		}
		if stub.authorization != "Bearer "+"svc-"+"token" {
			t.Errorf("%s %s: upstream Authorization = %q, want the service token", tc.method, tc.target, stub.authorization)
		}
		if stub.actor != "alex" {
			t.Errorf("%s %s: upstream X-Kiao-Actor = %q, want the turn's owner", tc.method, tc.target, stub.actor)
		}
	}
}
