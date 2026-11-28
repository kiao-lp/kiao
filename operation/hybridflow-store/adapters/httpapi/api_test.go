package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"kiao/hybridflow-store/adapters/auth"
	"kiao/hybridflow-store/adapters/httpapi"
	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
	"kiao/hybridflow-store/core/services"
)

// The surface, over a core held in memory.
//
// What these check is the adapter's own half of the contract: that a patch on the wire reaches the
// core as a patch of exactly the fields it named, that `If-Match` is what makes a write
// conditional, that a status code says the right thing, and that the routes are the routes. The
// rules themselves are core/services' tests, and the SQL is adapters/postgres'.

// serve builds the surface over a store held in maps (adapters/memory). `package httpapi_test`
// rather than `package httpapi`, so that reaching for another adapter is unambiguously a test doing
// it and not the adapter itself.
func serve(t *testing.T) (http.Handler, *memory.Store) {
	t.Helper()
	store := memory.New()
	clock := stubClock{}
	ids := &stubIDs{}
	api := httpapi.New(httpapi.Options{
		Boards:       services.NewBoards(store, clock, ids),
		BoardFolders: services.NewFolders(entities.BoardFolderScope, store, ids),
		FlowNodes:    services.NewFlowNodes(store, store, store, store, clock, ids),
		Workflows:    services.NewWorkflows(store, store, clock, ids),
		Agents:       services.NewAgents(store, clock, ids),
		Runners:      services.NewRunners(store, clock, ids),
		Usage:        services.NewUsage(store, store, clock, ids),
		Changes:      store,
	})
	// Debug mode: these tests are about the surface, and a Keycloak beside them would make them
	// about something else. It is the same mode a throwaway stack runs in.
	return api.Handler(auth.New(auth.Options{Mode: "debug"}), []string{"*"}), store
}

type stubClock struct{}

func (stubClock) Now() time.Time { return time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC) }

type stubIDs struct {
	mu sync.Mutex
	n  int
}

func (i *stubIDs) NewID() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.n++
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", i.n)
}

func call(t *testing.T, handler http.Handler, method, path, body string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, reader)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func decodeBody[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("could not read the answer %q: %v", w.Body.String(), err)
	}
	return out
}

func TestHealthzIsUnauthenticatedAndUntraced(t *testing.T) {
	handler, _ := serve(t)
	w := call(t, handler, "GET", "/healthz", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"ok"`) {
		t.Errorf("healthz = %d %q", w.Code, w.Body.String())
	}
}

func TestBoardFolderRoutes(t *testing.T) {
	handler, _ := serve(t)
	const collection = "/folders/boards"
	created := call(t, handler, "POST", collection, `{"name":" Planning "}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create folder = %d %s", created.Code, created.Body)
	}
	folder := decodeBody[httpapi.FolderDto](t, created)
	if folder.ID == "" || folder.Name != "Planning" {
		t.Fatalf("created folder = %+v", folder)
	}
	folderPath := collection + "/" + folder.ID
	renamed := call(t, handler, "PATCH", folderPath, `{"name":"Roadmap"}`)
	if renamed.Code != http.StatusOK {
		t.Fatalf("rename folder = %d %s", renamed.Code, renamed.Body)
	}
	list := decodeBody[struct{ Folders []httpapi.FolderDto }](t, call(t, handler, "GET", collection, ""))
	if len(list.Folders) != 1 || list.Folders[0] != (httpapi.FolderDto{ID: folder.ID, Name: "Roadmap"}) {
		t.Fatalf("folders = %+v", list.Folders)
	}

	nested := call(t, handler, "POST", "/boards", fmt.Sprintf(`{"name":"Nested","folderId":%q}`, folder.ID))
	if nested.Code != http.StatusCreated {
		t.Fatalf("create board in folder = %d %s", nested.Code, nested.Body)
	}
	if got := decodeBody[httpapi.BoardDetailDto](t, nested).Board; got.FolderID != folder.ID || got.Revision != 1 {
		t.Fatalf("board created in folder = %+v", got)
	}

	boardPath := "/boards/major"
	made := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "POST", "/boards", `{"name":"Major"}`))
	move := call(t, handler, "PATCH", boardPath, fmt.Sprintf(`{"folderId":%q}`, folder.ID),
		"If-Match", fmt.Sprint(made.Board.Revision))
	if move.Code != http.StatusOK {
		t.Fatalf("move board = %d %s", move.Code, move.Body)
	}
	moved := decodeBody[httpapi.BoardDto](t, move)
	if moved.ID != made.Board.ID || moved.Slug != made.Board.Slug || moved.FolderID != folder.ID {
		t.Fatalf("moved board = %+v", moved)
	}
	deleted := call(t, handler, "DELETE", folderPath, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete folder = %d %s", deleted.Code, deleted.Body)
	}
	reopened := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", boardPath, ""))
	if reopened.Board.ID != made.Board.ID || reopened.Board.FolderID != "" {
		t.Fatalf("board after folder deletion = %+v", reopened.Board)
	}
	if w := call(t, handler, "POST", "/boards", fmt.Sprintf(`{"name":"Missing","folderId":%q}`, folder.ID)); w.Code != http.StatusNotFound {
		t.Fatalf("create board in deleted folder = %d %s", w.Code, w.Body)
	}
	if w := call(t, handler, "GET", "/boards/missing", ""); w.Code != http.StatusNotFound {
		t.Fatalf("board from rejected create = %d %s", w.Code, w.Body)
	}
}

func TestABoardIsCreatedAndReadWhole(t *testing.T) {
	handler, _ := serve(t)
	w := call(t, handler, "POST", "/boards", `{"name":"Major"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[httpapi.BoardDetailDto](t, w)
	if created.Board.Slug != "major" {
		t.Fatalf("created %+v", created)
	}

	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","model":"opus"}`))

	w = call(t, handler, "POST", "/boards/major/flow-nodes", fmt.Sprintf(
		`{"flowNodes":[{"title":"Write it","body":"Go on.",
		  "settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`,
		agent.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create flow node = %d %q", w.Code, w.Body.String())
	}

	w = call(t, handler, "GET", "/boards/major", "")
	board := decodeBody[httpapi.BoardDetailDto](t, w)
	if len(board.FlowNodes) != 1 {
		t.Fatalf("the board holds %d flow nodes", len(board.FlowNodes))
	}
	flowNode := board.FlowNodes[0]
	if flowNode.Type != "ai" || flowNode.Settings == nil || flowNode.Settings.Agent != agent.ID {
		t.Errorf("flow node = %+v", flowNode)
	}
	if flowNode.Status != "ready" {
		t.Errorf("status = %q, want ready", flowNode.Status)
	}
	if board.Cursor == 0 {
		t.Error("the board came back with no change cursor to watch from")
	}
}

func TestFindBoardByFlowNodeID(t *testing.T) {
	handler, _ := serve(t)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "POST", "/boards", `{"name":"Major"}`)).Board
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"type":"human","title":"Review this"}]}`))

	w := call(t, handler, "GET", "/flow-nodes/"+made["flowNodes"][0].ID+"/board", "")
	if w.Code != http.StatusOK {
		t.Fatalf("lookup = %d %q", w.Code, w.Body.String())
	}
	if got := decodeBody[httpapi.BoardDto](t, w); got.ID != board.ID || got.Slug != board.Slug {
		t.Errorf("lookup = %+v, want board %s (%s)", got, board.Slug, board.ID)
	}
	if w := call(t, handler, "GET", "/flow-nodes/missing/board", ""); w.Code != http.StatusNotFound {
		t.Errorf("missing flow node lookup = %d %q", w.Code, w.Body.String())
	}
}

// A patch changes the fields it names and no others — checked on the wire, because that is where a
// client's intent is expressed.
func TestAPatchTouchesOnlyWhatItNames(t *testing.T) {
	handler, _ := serve(t)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "POST", "/boards", `{"name":"Shared"}`))
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/shared/flow-nodes",
		`{"flowNodes":[{"title":"Both hands","body":"Go."}]}`))
	flowNode := made["flowNodes"][0]
	_ = board

	w := call(t, handler, "PATCH", "/boards/shared/flow-nodes/"+flowNode.ID, `{"title":"Renamed"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	renamed := decodeBody[httpapi.FlowNodeDto](t, w)
	if renamed.Title != "Renamed" || renamed.Body != "Go." {
		t.Errorf("flow node = %+v, want the body untouched", renamed)
	}
}

func TestAFlowNodeKeepsTheDimensionsItWasGiven(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Sized"}`)
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/sized/flow-nodes",
		`{"flowNodes":[{"title":"Wide","spot":{"x":10,"y":20},"size":{"w":260,"h":140}}]}`))
	flowNode := made["flowNodes"][0]
	if flowNode.Size == nil || flowNode.Size.W != 260 || flowNode.Size.H != 140 {
		t.Fatalf("flow node = %+v, want its stored size", flowNode)
	}

	// A width dragged alone leaves the height natural, and the position is still the flow node's.
	w := call(t, handler, "PATCH", "/boards/sized/flow-nodes/"+flowNode.ID, `{"size":{"w":300}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	patched := decodeBody[httpapi.FlowNodeDto](t, w)
	if patched.Size == nil || patched.Size.W != 300 || patched.Size.H != 0 {
		t.Errorf("size = %+v, want the width alone", patched.Size)
	}
	if patched.Spot == nil || patched.Spot.X != 10 || patched.Spot.Y != 20 {
		t.Errorf("spot = %+v, want it untouched", patched.Spot)
	}
}

func TestIfMatchIsWhatMakesAWriteConditional(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Guarded"}`)
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/guarded/flow-nodes",
		`{"flowNodes":[{"title":"Once"}]}`))
	flowNode := made["flowNodes"][0]
	stale := fmt.Sprint(flowNode.Revision)

	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+flowNode.ID, `{"title":"Twice"}`,
		"If-Match", stale); w.Code != http.StatusOK {
		t.Fatalf("the first conditional write = %d %q", w.Code, w.Body.String())
	}
	w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+flowNode.ID, `{"title":"Thrice"}`,
		"If-Match", stale)
	if w.Code != http.StatusConflict {
		t.Errorf("the second write from the same revision = %d, want 409", w.Code)
	}
	// No If-Match is a write that does not care, which is what a run's status write means.
	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+flowNode.ID, `{"status":"done"}`); w.Code != http.StatusOK {
		t.Errorf("the unconditional write = %d %q", w.Code, w.Body.String())
	}
	// A malformed If-Match is refused rather than ignored: a client that meant to be conditional
	// and was not would overwrite somebody silently.
	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+flowNode.ID, `{"title":"Four"}`,
		"If-Match", "nonsense"); w.Code != http.StatusBadRequest {
		t.Errorf("a malformed If-Match = %d, want 400", w.Code)
	}
}

func TestASecondRunIsToldTheFlowNodeIsHeld(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Contested"}`)
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","model":"opus"}`))
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/contested/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"One card","body":"Go.","settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`, agent.ID)))
	flowNode := made["flowNodes"][0]

	w := call(t, handler, "POST", "/boards/contested/flow-nodes/"+flowNode.ID+"/play", `{"run":"run-1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("play = %d %q", w.Code, w.Body.String())
	}
	played := decodeBody[httpapi.FlowNodeDto](t, w)
	if played.Status != "running" || played.Run != "run-1" {
		t.Errorf("flow node = %+v, want it held by run-1", played)
	}
	// The description stays where it is: a play sends it, and writes nothing about it onto the flow node.
	if played.Body != "Go." {
		t.Errorf("the box holds %q, want the description left alone", played.Body)
	}
	w = call(t, handler, "POST", "/boards/contested/flow-nodes/"+flowNode.ID+"/play", `{"run":"run-2"}`)
	if w.Code != http.StatusConflict && w.Code != http.StatusBadRequest && w.Code != http.StatusUnprocessableEntity {
		t.Errorf("the second run = %d, want it refused", w.Code)
	}

	w = call(t, handler, "POST", "/boards/contested/flow-nodes/"+flowNode.ID+"/played",
		`{"run":"run-1","status":"done"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("played = %d %q", w.Code, w.Body.String())
	}
	done := decodeBody[httpapi.FlowNodeDto](t, w)
	if done.Status != "done" || done.Run != "" {
		t.Errorf("flow node = %+v", done)
	}
	if done.Body != "Go." {
		t.Errorf("the box holds %q, want the description kept", done.Body)
	}
}

func TestAnUnknownFieldIsRefused(t *testing.T) {
	handler, _ := serve(t)
	w := call(t, handler, "POST", "/boards", `{"name":"Typo","names":["a"]}`)
	if w.Code != http.StatusBadRequest {
		t.Errorf("a mistyped field = %d, want 400 rather than three-quarters of what was asked", w.Code)
	}
}

func TestAMissingBoardIsA404AndNotA500(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "GET", "/boards/nowhere", ""); w.Code != http.StatusNotFound {
		t.Errorf("an unknown board = %d, want 404", w.Code)
	}
}

func TestTheChangeFeedIsReadFromACursor(t *testing.T) {
	handler, _ := serve(t)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "POST", "/boards", `{"name":"Watched"}`))
	from := board.Cursor
	call(t, handler, "POST", "/boards/watched/flow-nodes", `{"flowNodes":[{"title":"New card"}]}`)

	w := call(t, handler, "GET", fmt.Sprintf("/changes?since=%d&board=%s", from, board.Board.ID), "")
	if w.Code != http.StatusOK {
		t.Fatalf("changes = %d %q", w.Code, w.Body.String())
	}
	feed := decodeBody[httpapi.ChangesDto](t, w)
	if len(feed.Changes) == 0 {
		t.Fatal("the feed is empty after a flow node was created")
	}
	if feed.Changes[0].Scope != string(entities.ScopeFlowNode) || feed.Changes[0].Kind != entities.ChangeCreated {
		t.Errorf("the feed opens on %+v", feed.Changes[0])
	}
	if feed.Cursor <= from {
		t.Errorf("the cursor did not move: %d", feed.Cursor)
	}
}

func TestPreflightIsAnswered(t *testing.T) {
	handler, _ := serve(t)
	r := httptest.NewRequest("OPTIONS", "/boards", bytes.NewReader(nil))
	r.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Errorf("preflight = %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Errorf("allow-origin = %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
	if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "If-Match") {
		t.Error("If-Match is not allowed, so no browser could ever make a conditional write")
	}
}

// ── the service token ─────────────────────────────────────────────────────────
//
// A run's credential, and the one right it carries that a user's token does not: naming whose work
// this is. These are here rather than in the auth package because what is being checked is the
// surface — which caller gets in, and what the change log ends up saying about them.

func servedWith(t *testing.T, opts auth.Options) (http.Handler, *memory.Store) {
	t.Helper()
	store := memory.New()
	clock := stubClock{}
	ids := &stubIDs{}
	api := httpapi.New(httpapi.Options{
		Boards:    services.NewBoards(store, clock, ids),
		FlowNodes: services.NewFlowNodes(store, store, store, store, clock, ids),
		Workflows: services.NewWorkflows(store, store, clock, ids),
		Agents:    services.NewAgents(store, clock, ids),
		Changes:   store,
	})
	return api.Handler(auth.New(opts), []string{"*"}), store
}

func TestTheServiceTokenGetsInAndNamesItsActor(t *testing.T) {
	handler, _ := servedWith(t, auth.Options{Mode: "prod", ServiceToken: "the-shared-secret"})

	if w := call(t, handler, "GET", "/boards", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("no credential = %d, want 401", w.Code)
	}
	if w := call(t, handler, "GET", "/boards", "", "Authorization", "Bearer not-the-secret"); w.Code != http.StatusUnauthorized {
		t.Errorf("the wrong secret = %d, want 401", w.Code)
	}

	w := call(t, handler, "POST", "/boards", `{"name":"Played"}`,
		"Authorization", "Bearer the-shared-secret", auth.ActorHeader, "alex")
	if w.Code != http.StatusCreated {
		t.Fatalf("the service token = %d %q", w.Code, w.Body.String())
	}
	board := decodeBody[httpapi.BoardDetailDto](t, w)
	feed := decodeBody[httpapi.ChangesDto](t, call(t, handler, "GET",
		fmt.Sprintf("/changes?board=%s", board.Board.ID), "",
		"Authorization", "Bearer the-shared-secret"))
	if len(feed.Changes) == 0 {
		t.Fatal("the feed is empty")
	}
	// The point of the header: the board says whose run touched it, not that a service did.
	if feed.Changes[0].Actor != "alex" {
		t.Errorf("the change is attributed to %q, want the actor the caller named", feed.Changes[0].Actor)
	}
}

func TestAServiceTokenCallerNamingNobodyIsTheService(t *testing.T) {
	handler, _ := servedWith(t, auth.Options{Mode: "prod", ServiceToken: "the-shared-secret"})
	w := call(t, handler, "POST", "/boards", `{"name":"Unattributed"}`,
		"Authorization", "Bearer the-shared-secret")
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	board := decodeBody[httpapi.BoardDetailDto](t, w)
	feed := decodeBody[httpapi.ChangesDto](t, call(t, handler, "GET",
		fmt.Sprintf("/changes?board=%s", board.Board.ID), "",
		"Authorization", "Bearer the-shared-secret"))
	if len(feed.Changes) == 0 || feed.Changes[0].Actor != auth.ServiceUser {
		t.Errorf("the change is attributed to %+v, want %q", feed.Changes, auth.ServiceUser)
	}
}

// The right to speak for somebody is the service token's alone. A caller on any other credential is
// who its credential says it is, whatever header it sends.
func TestOnlyTheServiceTokenMayNameAnActor(t *testing.T) {
	handler, _ := servedWith(t, auth.Options{Mode: "debug", ServiceToken: "the-shared-secret"})
	w := call(t, handler, "POST", "/boards", `{"name":"Impersonated"}`,
		auth.ActorHeader, "somebody-else")
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	board := decodeBody[httpapi.BoardDetailDto](t, w)
	feed := decodeBody[httpapi.ChangesDto](t, call(t, handler, "GET",
		fmt.Sprintf("/changes?board=%s", board.Board.ID), ""))
	if len(feed.Changes) == 0 {
		t.Fatal("the feed is empty")
	}
	if feed.Changes[0].Actor == "somebody-else" {
		t.Error("a caller without the service token wrote under a name it chose")
	}
}

// A deployment that configures no service token has no second way in at all.
func TestNoServiceTokenMeansNoSecondCredential(t *testing.T) {
	handler, _ := servedWith(t, auth.Options{Mode: "prod"})
	for _, bearer := range []string{"", "anything", "the-shared-secret"} {
		w := call(t, handler, "GET", "/boards", "", "Authorization", "Bearer "+bearer)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("bearer %q = %d, want 401", bearer, w.Code)
		}
	}
}

// ── a wait ending is an answer, not a failure ─────────────────────────────────
//
// A held request whose clock runs out inside a read — the race between a woken waiter and an
// expired context — used to come back a 500, which the log recorded as a failed request and the
// client answered with a retry delay. What it is is a wait that ended: nothing new, from the
// cursor the client holds.

func servedOverChanges(t *testing.T, changes ports.ChangeLog) http.Handler {
	t.Helper()
	store := memory.New()
	clock := stubClock{}
	ids := &stubIDs{}
	api := httpapi.New(httpapi.Options{
		Boards:    services.NewBoards(store, clock, ids),
		FlowNodes: services.NewFlowNodes(store, store, store, store, clock, ids),
		Workflows: services.NewWorkflows(store, store, clock, ids),
		Agents:    services.NewAgents(store, clock, ids),
		Changes:   changes,
	})
	return api.Handler(auth.New(auth.Options{Mode: "debug"}), []string{"*"})
}

// failingChanges is a log whose reads die the way a query caught by the wait's own clock does.
type failingChanges struct{ err error }

func (f failingChanges) Since(context.Context, int64, string, int) ([]entities.Change, int64, error) {
	return nil, 0, f.err
}

func (f failingChanges) Latest(context.Context) (int64, error) { return 0, f.err }

func (f failingChanges) Await(context.Context, int64) bool { return false }

// scriptedChanges replays one race: an empty first read, a wake, and a re-read that finds its
// context gone. The error is wrapped the way the driver's is, so the check cannot be cheating on
// the exact value.
type scriptedChanges struct {
	mu     sync.Mutex
	reads  int
	latest int64
}

func (s *scriptedChanges) Since(context.Context, int64, string, int) ([]entities.Change, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	if s.reads == 1 {
		return nil, s.latest, nil
	}
	return nil, 0, fmt.Errorf("the changes: %w", context.DeadlineExceeded)
}

func (s *scriptedChanges) Latest(context.Context) (int64, error) { return s.latest, nil }

func (s *scriptedChanges) Await(context.Context, int64) bool { return true }

func TestWaitEndingInTheReadAnswersEmpty(t *testing.T) {
	handler := servedOverChanges(t, failingChanges{err: context.DeadlineExceeded})
	w := call(t, handler, "GET", "/changes?since=355&wait=1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("changes = %d %q, want 200", w.Code, w.Body.String())
	}
	feed := decodeBody[httpapi.ChangesDto](t, w)
	if len(feed.Changes) != 0 || feed.Cursor != 355 || feed.More {
		t.Errorf("the answer is %+v, want no changes from the cursor it was asked from", feed)
	}
}

func TestWaitWokenAndExpiredAtOnceAnswersEmpty(t *testing.T) {
	handler := servedOverChanges(t, &scriptedChanges{latest: 355})
	w := call(t, handler, "GET", "/changes?since=354&wait=1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("changes = %d %q, want 200", w.Code, w.Body.String())
	}
	feed := decodeBody[httpapi.ChangesDto](t, w)
	if len(feed.Changes) != 0 || feed.Cursor != 355 || feed.More {
		t.Errorf("the answer is %+v, want no changes at what the last good read knew", feed)
	}
}

func TestWaitFailingForRealStillFails(t *testing.T) {
	handler := servedOverChanges(t, failingChanges{err: errors.New("the database is gone")})
	w := call(t, handler, "GET", "/changes?since=355&wait=1", "")
	if w.Code != http.StatusInternalServerError {
		t.Errorf("changes = %d %q, want 500", w.Code, w.Body.String())
	}
}

func TestChangesWithoutWaitAndAGoneClientSaysNothing(t *testing.T) {
	handler := servedOverChanges(t, failingChanges{err: context.Canceled})
	w := call(t, handler, "GET", "/changes?since=355", "")
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "" {
		t.Errorf("changes = %d %q, want a silent 200", w.Code, w.Body.String())
	}
}

// ── agents ────────────────────────────────────────────────────────────────────

func TestAnAgentIsFiledAndReadBack(t *testing.T) {
	handler, _ := serve(t)
	w := call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","model":"opus","description":"Review code.","instructions":"Be concise."}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[httpapi.AgentDto](t, w)
	if made.ID == "" || made.Name != "Reviewer" || made.Harness != "claude" ||
		made.Model != "opus" || made.Instructions != "Be concise." || made.Description != "Review code." || made.Revision != 1 {
		t.Fatalf("agent = %+v", made)
	}

	w = call(t, handler, "GET", "/agents/"+made.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("read = %d %q", w.Code, w.Body.String())
	}
	if read := decodeBody[httpapi.AgentDto](t, w); read != made {
		t.Errorf("read = %+v, want %+v", read, made)
	}

	listed := decodeBody[map[string][]httpapi.AgentDto](t,
		call(t, handler, "GET", "/agents", ""))
	if len(listed["agents"]) != 1 || listed["agents"][0] != made {
		t.Errorf("agents = %+v, want the one filed", listed)
	}
}

func TestAnAgentDescriptionIsPatchedAndClearedSeparately(t *testing.T) {
	handler, _ := serve(t)
	made := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","description":"Review code.","instructions":"Be concise."}`))
	for _, description := range []string{"Review Go code.", ""} {
		w := call(t, handler, "PATCH", "/agents/"+made.ID, fmt.Sprintf(`{"description":%q}`, description),
			"If-Match", fmt.Sprint(made.Revision))
		if w.Code != http.StatusOK {
			t.Fatalf("patch = %d %q", w.Code, w.Body.String())
		}
		patched := decodeBody[httpapi.AgentDto](t, w)
		if patched.Description != description || patched.Instructions != made.Instructions {
			t.Errorf("agent = %+v, want only the description changed", patched)
		}
		made = patched
	}
}

func TestAnAgentIsPatchedAndDeleted(t *testing.T) {
	handler, _ := serve(t)
	made := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","model":"opus"}`))

	w := call(t, handler, "PATCH", "/agents/"+made.ID, `{"model":"sonnet"}`,
		"If-Match", fmt.Sprint(made.Revision))
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	patched := decodeBody[httpapi.AgentDto](t, w)
	if patched.Model != "sonnet" || patched.Name != "Reviewer" {
		t.Errorf("agent = %+v, want only the model changed", patched)
	}
	// The same revision twice is a conflict: the row moved under the caller.
	if w := call(t, handler, "PATCH", "/agents/"+made.ID, `{"model":"haiku"}`,
		"If-Match", fmt.Sprint(made.Revision)); w.Code != http.StatusConflict {
		t.Errorf("a stale patch = %d, want 409", w.Code)
	}

	if w := call(t, handler, "DELETE", "/agents/"+made.ID, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete = %d %q", w.Code, w.Body.String())
	}
	if w := call(t, handler, "GET", "/agents/"+made.ID, ""); w.Code != http.StatusNotFound {
		t.Errorf("a deleted agent reads %d, want 404", w.Code)
	}
}

func TestAnAgentRefusesWhatItCannotHold(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/agents", `{"name":"Reviewer","harness":"claude"}`)
	// Taken, however it is cased.
	if w := call(t, handler, "POST", "/agents",
		`{"name":"reviewer","harness":"codex"}`); w.Code != http.StatusConflict {
		t.Errorf("a taken name = %d, want 409", w.Code)
	}
	// No name, and no harness this build has heard of.
	if w := call(t, handler, "POST", "/agents",
		`{"name":"","harness":"claude"}`); w.Code != http.StatusBadRequest {
		t.Errorf("no name = %d, want 400", w.Code)
	}
	if w := call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"hal"}`); w.Code != http.StatusBadRequest {
		t.Errorf("an unknown harness = %d, want 400", w.Code)
	}
}

// A flow node naming an agent this store does not hold is refused at the write rather than at its
// first play.
func TestAFlowNodeNamingNoAgentIsRefused(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Major"}`)
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Play it","body":"Go.","settings":{"agent":"ghost","effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	if w.Code != http.StatusNotFound {
		t.Errorf("create = %d %q, want the agent refused as not found", w.Code, w.Body.String())
	}
}

// The task's own two travel the wire: created with the flow node, read back with it, replaced whole
// by a patch, and taken off on purpose.
func TestCriteriaAndComplexityTravelTheWire(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Measured"}`)
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/measured/flow-nodes",
		`{"flowNodes":[{"title":"Do it","body":"Go.","criteria":[{"text":"It holds"}],"complexity":5}]}`))
	flowNode := made["flowNodes"][0]
	if len(flowNode.Criteria) != 1 || flowNode.Criteria[0].Text != "It holds" || flowNode.Criteria[0].ID == "" {
		t.Fatalf("flow node = %+v, want one criterion with a minted id", flowNode)
	}
	if flowNode.Complexity == nil || *flowNode.Complexity != 5 {
		t.Fatalf("flow node = %+v, want complexity 5", flowNode)
	}

	w := call(t, handler, "PATCH", "/boards/measured/flow-nodes/"+flowNode.ID,
		fmt.Sprintf(`{"criteria":[{"id":%q,"text":"It holds, still"}],"clearComplexity":true}`, flowNode.Criteria[0].ID))
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	patched := decodeBody[httpapi.FlowNodeDto](t, w)
	if len(patched.Criteria) != 1 || patched.Criteria[0].ID != flowNode.Criteria[0].ID ||
		patched.Criteria[0].Text != "It holds, still" {
		t.Errorf("flow node = %+v, want the replacement keeping its id", patched)
	}
	if patched.Complexity != nil {
		t.Errorf("flow node = %+v, want no complexity after clearing", patched)
	}

	// Read back whole: what the board holds is what the flow node said.
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/measured", ""))
	if len(board.FlowNodes) != 1 || len(board.FlowNodes[0].Criteria) != 1 {
		t.Errorf("the board holds %+v, want the criterion", board.FlowNodes)
	}
}

func TestARunnerIsFiledAndReadBack(t *testing.T) {
	handler, _ := serve(t)
	w := call(t, handler, "POST", "/runners", `{"name":"Server"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[httpapi.RunnerDto](t, w)
	if made.ID == "" || made.Name != "Server" || made.Revision != 1 {
		t.Fatalf("runner = %+v", made)
	}
	if made.LastSeen != nil {
		t.Fatalf("runner = %+v, want none seen until the first heartbeat", made)
	}

	w = call(t, handler, "GET", "/runners/"+made.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("read = %d %q", w.Code, w.Body.String())
	}
	if read := decodeBody[httpapi.RunnerDto](t, w); read != made {
		t.Errorf("read = %+v, want %+v", read, made)
	}

	listed := decodeBody[map[string][]httpapi.RunnerDto](t,
		call(t, handler, "GET", "/runners", ""))
	if len(listed["runners"]) != 1 || listed["runners"][0].ID != made.ID {
		t.Errorf("runners = %+v, want the one filed", listed)
	}
}

func TestARunnerIsPatchedAndDeleted(t *testing.T) {
	handler, _ := serve(t)
	made := decodeBody[httpapi.RunnerDto](t,
		call(t, handler, "POST", "/runners", `{"name":"Server"}`))

	w := call(t, handler, "PATCH", "/runners/"+made.ID, `{"name":"Desktop"}`,
		"If-Match", fmt.Sprint(made.Revision))
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	if patched := decodeBody[httpapi.RunnerDto](t, w); patched.Name != "Desktop" {
		t.Errorf("runner = %+v, want the rename", patched)
	}
	// The same revision twice is a conflict: the row moved under the caller.
	if w := call(t, handler, "PATCH", "/runners/"+made.ID, `{"name":"Elsewhere"}`,
		"If-Match", fmt.Sprint(made.Revision)); w.Code != http.StatusConflict {
		t.Errorf("a stale patch = %d, want 409", w.Code)
	}
	// Taken, however it is cased.
	call(t, handler, "POST", "/runners", `{"name":"Second"}`)
	if w := call(t, handler, "PATCH", "/runners/"+made.ID, `{"name":"second"}`); w.Code != http.StatusConflict {
		t.Errorf("a taken name = %d, want 409", w.Code)
	}

	if w := call(t, handler, "DELETE", "/runners/"+made.ID, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete = %d %q", w.Code, w.Body.String())
	}
	if w := call(t, handler, "GET", "/runners/"+made.ID, ""); w.Code != http.StatusNotFound {
		t.Errorf("a deleted runner reads %d, want 404", w.Code)
	}
}

// The heartbeat stamps last seen and answers the runner: what the runner's own process calls in
// with every few seconds.
func TestAHeartbeatStampsLastSeen(t *testing.T) {
	handler, _ := serve(t)
	made := decodeBody[httpapi.RunnerDto](t,
		call(t, handler, "POST", "/runners", `{"name":"Server"}`))

	w := call(t, handler, "POST", "/runners/"+made.ID+"/heartbeat", "")
	if w.Code != http.StatusOK {
		t.Fatalf("heartbeat = %d %q", w.Code, w.Body.String())
	}
	seen := decodeBody[httpapi.RunnerDto](t, w)
	if seen.LastSeen == nil || seen.LastSeen.IsZero() {
		t.Fatalf("runner = %+v, want last seen stamped", seen)
	}
	if seen.Revision != made.Revision {
		t.Errorf("revision = %d, want %d: the heartbeat moves nothing else", seen.Revision, made.Revision)
	}
	// A runner that has gone tells its process so.
	if w := call(t, handler, "POST", "/runners/ghost/heartbeat", ""); w.Code != http.StatusNotFound {
		t.Errorf("a gone runner's heartbeat = %d, want 404", w.Code)
	}
}

// A flow node naming a runner this store does not hold is refused at the write rather than at its
// first play — and one naming a runner there is carries the pin on the wire.
func TestAFlowNodeNamingNoRunnerIsRefused(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Major"}`)
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Play it","body":"Go.","settings":{"runner":"ghost"}}]}`)
	if w.Code != http.StatusNotFound {
		t.Errorf("create = %d %q, want the runner refused as not found", w.Code, w.Body.String())
	}

	runner := decodeBody[httpapi.RunnerDto](t,
		call(t, handler, "POST", "/runners", `{"name":"Server"}`))
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude"}`))
	w = call(t, handler, "POST", "/boards/major/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"Play it","body":"Go.",`+
			`"settings":{"agent":%q,"effort":"high","permission":"manualLive","folder":"/","runner":%q}}]}`,
			agent.ID, runner.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, w)
	flowNode := made["flowNodes"][0]
	if flowNode.Settings == nil || flowNode.Settings.Runner != runner.ID {
		t.Errorf("flow node = %+v, want the runner pin", flowNode)
	}
}

// A workflow is filed with its flow nodes, renamed, and read back on the board beside them — and a
// flow node made inside it says so at creation.
func TestWorkflowsOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	flowNodes := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"One"},{"title":"Two"}]}`))
	if len(flowNodes.FlowNodes) != 2 {
		t.Fatalf("flow nodes = %+v, want two", flowNodes.FlowNodes)
	}

	// Filed with its flow nodes: each names the workflow afterwards.
	w := call(t, handler, "POST", "/boards/major/workflows",
		fmt.Sprintf(`{"name":"Sprint","flowNodes":[%q,%q]}`,
			flowNodes.FlowNodes[0].ID, flowNodes.FlowNodes[1].ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create workflow = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[httpapi.WorkflowDto](t, w)
	if made.Name != "Sprint" || made.Revision != 1 {
		t.Fatalf("workflow = %+v, want the name filed at revision 1", made)
	}
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.Workflows) != 1 {
		t.Fatalf("board holds %d workflows, want one", len(board.Workflows))
	}
	for _, flowNode := range board.FlowNodes {
		if flowNode.Workflow != made.ID {
			t.Errorf("flow node %q names workflow %q, want %q", flowNode.Title, flowNode.Workflow, made.ID)
		}
	}

	// A flow node made inside the rectangle says so at creation.
	inside := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"Inside","workflow":%q}]}`, made.ID)))
	if len(inside.FlowNodes) != 1 || inside.FlowNodes[0].Workflow != made.ID {
		t.Fatalf("inside = %+v, want the flow node grouped", inside.FlowNodes)
	}

	// Renamed through a conditional write; a stale revision is refused.
	renamed := decodeBody[httpapi.WorkflowDto](t, call(t, handler, "PATCH",
		"/boards/major/workflows/"+made.ID, `{"name":"Release"}`,
		"If-Match", "1"))
	if renamed.Name != "Release" || renamed.Revision != 2 {
		t.Fatalf("rename = %+v, want Release at revision 2", renamed)
	}
	if w := call(t, handler, "PATCH", "/boards/major/workflows/"+made.ID,
		`{"name":"Stale"}`, "If-Match", "1"); w.Code != http.StatusConflict {
		t.Errorf("stale rename = %d, want 409", w.Code)
	}
	workflowPath := "/boards/major/workflows/" + made.ID
	if w := call(t, handler, "PATCH", workflowPath,
		`{"setValues":{"review":{"passed":true},"decision":null}}`); w.Code != http.StatusOK {
		t.Fatalf("set workflow values = %d %s", w.Code, w.Body)
	}
	for _, invalid := range []string{`{"setValues":[]}`, `{"setValues":{"id":"new"}}`, `{"removeValues":["name"]}`} {
		if w := call(t, handler, "PATCH", workflowPath, invalid); w.Code != http.StatusBadRequest {
			t.Errorf("workflow patch %s = %d, want 400", invalid, w.Code)
		}
	}
	trimmed := call(t, handler, "PATCH", workflowPath, `{"removeValues":["review"]}`)
	if trimmed.Code != http.StatusOK {
		t.Fatalf("remove workflow value = %d %s", trimmed.Code, trimmed.Body)
	}
	updated := decodeBody[httpapi.WorkflowDto](t, trimmed)
	if string(updated.Values) != `{"decision":null}` || updated.Name != "Release" || updated.Revision != 4 {
		t.Fatalf("workflow after edits = %+v, values %s", updated, updated.Values)
	}

	// A flow node of another board refuses the workflow.
	if w := call(t, handler, "POST", "/boards", `{"name":"Minor"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	away := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/minor/flow-nodes",
		`{"flowNodes":[{"title":"Away"}]}`))
	if w := call(t, handler, "POST", "/boards/major/workflows",
		fmt.Sprintf(`{"name":"Nope","flowNodes":[%q]}`, away.FlowNodes[0].ID)); w.Code != http.StatusBadRequest {
		t.Errorf("cross-board member = %d, want 400", w.Code)
	}

	// Deleted: the rectangle goes and the flow nodes stay, ungrouped.
	if w := call(t, handler, "DELETE", "/boards/major/workflows",
		fmt.Sprintf(`{"workflows":[%q]}`, made.ID)); w.Code != http.StatusNoContent {
		t.Fatalf("delete workflow = %d %q", w.Code, w.Body.String())
	}
	board = decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.Workflows) != 0 {
		t.Fatalf("board holds %d workflows, want none", len(board.Workflows))
	}
	if len(board.FlowNodes) != 3 {
		t.Fatalf("board holds %d flow nodes, want the three still there", len(board.FlowNodes))
	}
	for _, flowNode := range board.FlowNodes {
		if flowNode.Workflow != "" {
			t.Errorf("flow node %q still names workflow %q", flowNode.Title, flowNode.Workflow)
		}
	}
}

// usageNode files a board, an agent and one AI flow node on it, and answers the flow node's id: what a
// usage test plays against.
func usageNode(t *testing.T, handler http.Handler) string {
	t.Helper()
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","harness":"claude","model":"opus"}`))
	w := call(t, handler, "POST", "/boards/major/flow-nodes", fmt.Sprintf(
		`{"flowNodes":[{"title":"Write it","body":"Go on.",`+
			`"settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`,
		agent.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create flow node = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	return created.FlowNodes[0].ID
}

func TestAUsageReportIsFiledAndTotalled(t *testing.T) {
	handler, _ := serve(t)
	flowNode := usageNode(t, handler)

	w := call(t, handler, "POST", "/boards/major/flow-nodes/"+flowNode+"/usage",
		`{"id":"123e4567-e89b-42d3-a456-426614174000","run":"run-1","model":"muse-spark",`+
			`"inputTokens":100,"outputTokens":50,"cacheReadTokens":10,"costUsdMicros":23400}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("record = %d %q", w.Code, w.Body.String())
	}
	filed := decodeBody[httpapi.TaskUsageDto](t, w)
	if filed.ID != "123e4567-e89b-42d3-a456-426614174000" || filed.Run != "run-1" {
		t.Errorf("filed = %+v", filed)
	}
	if filed.ReportedAt.IsZero() {
		t.Error("the filed report has no stamp")
	}

	// The same row again is the replay landing on nothing, not a double count.
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/"+flowNode+"/usage",
		`{"id":"123e4567-e89b-42d3-a456-426614174000","run":"run-1",`+
			`"inputTokens":100,"outputTokens":50}`); w.Code != http.StatusCreated {
		t.Fatalf("replay = %d %q", w.Code, w.Body.String())
	}

	w = call(t, handler, "GET", "/boards/major/flow-nodes/"+flowNode+"/usage", "")
	if w.Code != http.StatusOK {
		t.Fatalf("totals = %d %q", w.Code, w.Body.String())
	}
	totals := decodeBody[httpapi.UsageTotalsDto](t, w)
	if totals.Reports != 1 || totals.InputTokens != 100 || totals.OutputTokens != 50 ||
		totals.CacheReadTokens != 10 {
		t.Errorf("totals = %+v", totals)
	}
	if totals.CostUsdMicros == nil || *totals.CostUsdMicros != 23400 {
		t.Errorf("cost = %v, want 23400", totals.CostUsdMicros)
	}
}

func TestUsageOnAFlowNodeThatIsNotThereIsA404(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/no-such-node/usage",
		`{"inputTokens":1}`); w.Code != http.StatusNotFound {
		t.Errorf("record = %d %q, want 404", w.Code, w.Body.String())
	}
	if w := call(t, handler, "GET", "/boards/major/flow-nodes/no-such-node/usage", ""); w.Code != http.StatusNotFound {
		t.Errorf("totals = %d %q, want 404", w.Code, w.Body.String())
	}
}

func TestUsageRefusesWhatIsNotAnAIFlowNode(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Do it"}]}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create flow node = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/"+created.FlowNodes[0].ID+"/usage",
		`{"inputTokens":1}`); w.Code != http.StatusBadRequest {
		t.Errorf("record on a human flow node = %d %q, want 400", w.Code, w.Body.String())
	}
}

// A Gateway's branches travel the wire beside the single flow node: created and patched as the
// `flowNodes` list, added one at a time by the link call, and read back in order.
func TestAGatewaysBranchesTravelTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Branch one"},{"title":"Branch two"},{"title":"Join","type":"gateway"}]}`))
	if len(created.FlowNodes) != 3 {
		t.Fatalf("created %d flow nodes, want 3", len(created.FlowNodes))
	}
	first, second, join := created.FlowNodes[0].ID, created.FlowNodes[1].ID, created.FlowNodes[2].ID

	w := call(t, handler, "POST", "/boards/major/flow-nodes/"+join+"/chain",
		`{"flowNode":"`+first+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("chain = %d %q", w.Code, w.Body.String())
	}
	chained := decodeBody[httpapi.FlowNodeDto](t, w)
	if chained.OnSuccess == nil || len(chained.OnSuccess.FlowNodes) != 1 ||
		chained.OnSuccess.FlowNodes[0] != first {
		t.Fatalf("branches = %+v, want the one drawn", chained.OnSuccess)
	}
	w = call(t, handler, "PATCH", "/boards/major/flow-nodes/"+join,
		`{"onSuccess":{"flowNodes":["`+second+`","`+first+`"]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	patched := decodeBody[httpapi.FlowNodeDto](t, w)
	if len(patched.OnSuccess.FlowNodes) != 2 || patched.OnSuccess.FlowNodes[0] != second {
		t.Errorf("branches = %q, want the list said whole, in order", patched.OnSuccess.FlowNodes)
	}
	if patched.OnSuccess.FlowNode != "" {
		t.Errorf("a Gateway answers a single flowNode %q, want none", patched.OnSuccess.FlowNode)
	}
}

func TestPiAgentProfileThroughHTTP(t *testing.T) {
	handler, _ := serve(t)
	created := call(t, handler, http.MethodPost, "/agents", `{"name":"Pi reviewer","harness":"pi","profileId":"work","model":"openai/shared"}`)
	if created.Code != http.StatusCreated {
		t.Fatal(created.Body.String())
	}
	var agent map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &agent); err != nil {
		t.Fatal(err)
	}
	id := agent["id"].(string)
	if agent["profileId"] != "work" {
		t.Fatal("HTTP dropped profileId")
	}
	patched := call(t, handler, http.MethodPatch, "/agents/"+id, `{"profileId":"missing-on-runner"}`)
	if patched.Code != http.StatusOK || !strings.Contains(patched.Body.String(), `"profileId":"missing-on-runner"`) {
		t.Fatalf("profile patch: %d %s", patched.Code, patched.Body.String())
	}
}
