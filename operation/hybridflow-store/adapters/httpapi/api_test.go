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
		Boards:          services.NewBoards(store, clock, ids),
		FlowNodes:       services.NewFlowNodes(store, store, store, store, store, clock, ids),
		FlowNodeClasses: services.NewFlowNodeClasses(store, store, store, store, store, clock, ids),
		Workflows:       services.NewWorkflows(store, store, store, clock, ids),
		Agents:          services.NewAgents(store, clock, ids),
		Runners:         services.NewRunners(store, clock, ids),
		Usage:           services.NewUsage(store, store, clock, ids),
		Changes:         store,
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
		`{"name":"Reviewer","platform":"claude","model":"opus"}`))

	w = call(t, handler, "POST", "/boards/major/flow-nodes", fmt.Sprintf(
		`{"flowNodes":[{"title":"Write it","body":"Go on.",
		  "settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`,
		agent.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create card = %d %q", w.Code, w.Body.String())
	}

	w = call(t, handler, "GET", "/boards/major", "")
	board := decodeBody[httpapi.BoardDetailDto](t, w)
	if len(board.FlowNodes) != 1 {
		t.Fatalf("the board holds %d cards", len(board.FlowNodes))
	}
	card := board.FlowNodes[0]
	if card.Type != "ai" || card.Settings == nil || card.Settings.Agent != agent.ID {
		t.Errorf("card = %+v", card)
	}
	if card.Status != "ready" {
		t.Errorf("status = %q, want ready", card.Status)
	}
	if board.Cursor == 0 {
		t.Error("the board came back with no change cursor to watch from")
	}
}

// A patch changes the fields it names and no others — checked on the wire, because that is where a
// client's intent is expressed.
func TestAPatchTouchesOnlyWhatItNames(t *testing.T) {
	handler, _ := serve(t)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "POST", "/boards", `{"name":"Shared"}`))
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/shared/flow-nodes",
		`{"flowNodes":[{"title":"Both hands","body":"Go."}]}`))
	card := made["flowNodes"][0]
	_ = board

	w := call(t, handler, "PATCH", "/boards/shared/flow-nodes/"+card.ID, `{"title":"Renamed"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	renamed := decodeBody[httpapi.FlowNodeDto](t, w)
	if renamed.Title != "Renamed" || renamed.Body != "Go." {
		t.Errorf("card = %+v, want the body untouched", renamed)
	}
}

func TestIfMatchIsWhatMakesAWriteConditional(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Guarded"}`)
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/guarded/flow-nodes",
		`{"flowNodes":[{"title":"Once"}]}`))
	card := made["flowNodes"][0]
	stale := fmt.Sprint(card.Revision)

	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+card.ID, `{"title":"Twice"}`,
		"If-Match", stale); w.Code != http.StatusOK {
		t.Fatalf("the first conditional write = %d %q", w.Code, w.Body.String())
	}
	w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+card.ID, `{"title":"Thrice"}`,
		"If-Match", stale)
	if w.Code != http.StatusConflict {
		t.Errorf("the second write from the same revision = %d, want 409", w.Code)
	}
	// No If-Match is a write that does not care, which is what a run's status write means.
	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+card.ID, `{"status":"done"}`); w.Code != http.StatusOK {
		t.Errorf("the unconditional write = %d %q", w.Code, w.Body.String())
	}
	// A malformed If-Match is refused rather than ignored: a client that meant to be conditional
	// and was not would overwrite somebody silently.
	if w := call(t, handler, "PATCH", "/boards/guarded/flow-nodes/"+card.ID, `{"title":"Four"}`,
		"If-Match", "nonsense"); w.Code != http.StatusBadRequest {
		t.Errorf("a malformed If-Match = %d, want 400", w.Code)
	}
}

func TestASecondRunIsToldTheCardIsHeld(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Contested"}`)
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","platform":"claude","model":"opus"}`))
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/contested/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"One card","body":"Go.","settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`, agent.ID)))
	card := made["flowNodes"][0]

	w := call(t, handler, "POST", "/boards/contested/flow-nodes/"+card.ID+"/play", `{"run":"run-1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("play = %d %q", w.Code, w.Body.String())
	}
	played := decodeBody[httpapi.FlowNodeDto](t, w)
	if played.Status != "running" || played.Run != "run-1" {
		t.Errorf("card = %+v, want it held by run-1", played)
	}
	// The description stays where it is: a play sends it, and writes nothing about it onto the card.
	if played.Body != "Go." {
		t.Errorf("the box holds %q, want the description left alone", played.Body)
	}
	w = call(t, handler, "POST", "/boards/contested/flow-nodes/"+card.ID+"/play", `{"run":"run-2"}`)
	if w.Code != http.StatusConflict && w.Code != http.StatusBadRequest && w.Code != http.StatusUnprocessableEntity {
		t.Errorf("the second run = %d, want it refused", w.Code)
	}

	w = call(t, handler, "POST", "/boards/contested/flow-nodes/"+card.ID+"/played",
		`{"run":"run-1","status":"done"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("played = %d %q", w.Code, w.Body.String())
	}
	done := decodeBody[httpapi.FlowNodeDto](t, w)
	if done.Status != "done" || done.Run != "" {
		t.Errorf("card = %+v", done)
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
		t.Fatal("the feed is empty after a card was created")
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
		Boards:          services.NewBoards(store, clock, ids),
		FlowNodes:       services.NewFlowNodes(store, store, store, store, store, clock, ids),
		FlowNodeClasses: services.NewFlowNodeClasses(store, store, store, store, store, clock, ids),
		Workflows:       services.NewWorkflows(store, store, store, clock, ids),
		Agents:          services.NewAgents(store, clock, ids),
		Changes:         store,
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
		Boards:          services.NewBoards(store, clock, ids),
		FlowNodes:       services.NewFlowNodes(store, store, store, store, store, clock, ids),
		FlowNodeClasses: services.NewFlowNodeClasses(store, store, store, store, store, clock, ids),
		Workflows:       services.NewWorkflows(store, store, store, clock, ids),
		Agents:          services.NewAgents(store, clock, ids),
		Changes:         changes,
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
		`{"name":"Reviewer","platform":"claude","model":"opus","description":"Review code.","instructions":"Be concise."}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[httpapi.AgentDto](t, w)
	if made.ID == "" || made.Name != "Reviewer" || made.Platform != "claude" ||
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
		`{"name":"Reviewer","platform":"claude","description":"Review code.","instructions":"Be concise."}`))
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
		`{"name":"Reviewer","platform":"claude","model":"opus"}`))

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
	call(t, handler, "POST", "/agents", `{"name":"Reviewer","platform":"claude"}`)
	// Taken, however it is cased.
	if w := call(t, handler, "POST", "/agents",
		`{"name":"reviewer","platform":"codex"}`); w.Code != http.StatusConflict {
		t.Errorf("a taken name = %d, want 409", w.Code)
	}
	// No name, and no platform this build has heard of.
	if w := call(t, handler, "POST", "/agents",
		`{"name":"","platform":"claude"}`); w.Code != http.StatusBadRequest {
		t.Errorf("no name = %d, want 400", w.Code)
	}
	if w := call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","platform":"hal"}`); w.Code != http.StatusBadRequest {
		t.Errorf("an unknown platform = %d, want 400", w.Code)
	}
}

// A card naming an agent this store does not hold is refused at the write rather than at its
// first play.
func TestACardNamingNoAgentIsRefused(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Major"}`)
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Play it","body":"Go.","settings":{"agent":"ghost","effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)
	if w.Code != http.StatusNotFound {
		t.Errorf("create = %d %q, want the agent refused as not found", w.Code, w.Body.String())
	}
}

// The task's own two travel the wire: created with the card, read back with it, replaced whole
// by a patch, and taken off on purpose.
func TestCriteriaAndComplexityTravelTheWire(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Measured"}`)
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, call(t, handler, "POST", "/boards/measured/flow-nodes",
		`{"flowNodes":[{"title":"Do it","body":"Go.","criteria":[{"text":"It holds"}],"complexity":5}]}`))
	card := made["flowNodes"][0]
	if len(card.Criteria) != 1 || card.Criteria[0].Text != "It holds" || card.Criteria[0].ID == "" {
		t.Fatalf("card = %+v, want one criterion with a minted id", card)
	}
	if card.Complexity == nil || *card.Complexity != 5 {
		t.Fatalf("card = %+v, want complexity 5", card)
	}

	w := call(t, handler, "PATCH", "/boards/measured/flow-nodes/"+card.ID,
		fmt.Sprintf(`{"criteria":[{"id":%q,"text":"It holds, still"}],"clearComplexity":true}`, card.Criteria[0].ID))
	if w.Code != http.StatusOK {
		t.Fatalf("patch = %d %q", w.Code, w.Body.String())
	}
	patched := decodeBody[httpapi.FlowNodeDto](t, w)
	if len(patched.Criteria) != 1 || patched.Criteria[0].ID != card.Criteria[0].ID ||
		patched.Criteria[0].Text != "It holds, still" {
		t.Errorf("card = %+v, want the replacement keeping its id", patched)
	}
	if patched.Complexity != nil {
		t.Errorf("card = %+v, want no complexity after clearing", patched)
	}

	// Read back whole: what the board holds is what the card said.
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

// A card naming a runner this store does not hold is refused at the write rather than at its
// first play — and one naming a runner there is carries the pin on the wire.
func TestACardNamingNoRunnerIsRefused(t *testing.T) {
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
		`{"name":"Reviewer","platform":"claude"}`))
	w = call(t, handler, "POST", "/boards/major/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"Play it","body":"Go.",`+
			`"settings":{"agent":%q,"effort":"high","permission":"manualLive","folder":"/","runner":%q}}]}`,
			agent.ID, runner.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, w)
	card := made["flowNodes"][0]
	if card.Settings == nil || card.Settings.Runner != runner.ID {
		t.Errorf("card = %+v, want the runner pin", card)
	}
}

// A class is filed on a board, versioned, chained, published and instantiated over the wire:
// the routes are the routes, and a board read whole carries its classes beside its cards.
func TestFlowNodeClassesOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	if w := call(t, handler, "POST", "/boards", `{"name":"Minor"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}

	w := call(t, handler, "POST", "/boards/major/flow-node-classes",
		`{"title":"Review","type":"ai","permission":"manualLive","body":"Read the diff.",
		  "criteria":[{"id":"","text":"No nits left"}],"published":true}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create class = %d %q", w.Code, w.Body.String())
	}
	class := decodeBody[httpapi.FlowNodeClassDto](t, w)
	if len(class.Versions) != 1 || class.Versions[0].Status != "published" {
		t.Fatalf("class = %+v, want one published version", class)
	}
	second := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes", `{"title":"Follow up","body":"Then this."}`))

	// A chain between classes, drawn over the wire.
	w = call(t, handler, "POST", "/boards/major/flow-node-classes/"+class.ID+"/chain",
		fmt.Sprintf(`{"flowNode":%q}`, second.ID))
	if w.Code != http.StatusOK {
		t.Fatalf("chain = %d %q", w.Code, w.Body.String())
	}

	// A chain onto a simple flow node is refused: the two kinds chain among themselves.
	cards := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes", `{"flowNodes":[{"title":"Card"}]}`))
	w = call(t, handler, "POST", "/boards/major/flow-node-classes/"+class.ID+"/chain",
		fmt.Sprintf(`{"flowNode":%q}`, cards.FlowNodes[0].ID))
	if w.Code != http.StatusNotFound {
		t.Errorf("chain onto a flow node = %d, want 404", w.Code)
	}

	// The second class published, then the chain instantiated onto the other board.
	published := decodeBody[httpapi.ClassVersionDto](t, call(t, handler, "PATCH",
		"/boards/major/flow-node-classes/"+second.ID+"/versions/"+second.Versions[0].ID,
		`{"status":"published"}`))
	if published.Status != "published" {
		t.Fatalf("publish = %+v", published)
	}
	w = call(t, handler, "POST", "/boards/minor/flow-node-classes/"+class.ID+"/instantiate",
		`{"spot":{"x":40,"y":80}}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("instantiate = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	if len(made.FlowNodes) != 2 {
		t.Fatalf("instantiated %d flow nodes, want 2", len(made.FlowNodes))
	}
	headNext := ""
	if made.FlowNodes[0].OnSuccess != nil {
		headNext = made.FlowNodes[0].OnSuccess.FlowNode
	}
	if headNext != made.FlowNodes[1].ID {
		t.Errorf("the links were not recreated between the instances: %+v", made.FlowNodes)
	}
	if made.FlowNodes[0].ClassVersion == nil || made.FlowNodes[0].ClassVersion.ClassTitle != "Review" {
		t.Errorf("head = %+v, want the class and version named", made.FlowNodes[0])
	}

	// The menu lists the classes of all boards.
	listed := decodeBody[struct {
		FlowNodeClasses []httpapi.ListedClassDto `json:"flowNodeClasses"`
	}](t, call(t, handler, "GET", "/flow-node-classes", ""))
	if len(listed.FlowNodeClasses) != 2 || listed.FlowNodeClasses[0].BoardSlug != "major" {
		t.Fatalf("listed = %+v, want both classes with their board", listed.FlowNodeClasses)
	}

	// And a board read whole carries its classes beside its cards.
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.FlowNodeClasses) != 2 || len(board.FlowNodes) != 1 {
		t.Errorf("board holds %d classes and %d cards", len(board.FlowNodeClasses), len(board.FlowNodes))
	}

	// A draft somebody changed their mind about is deleted; a published one is kept.
	draft := decodeBody[httpapi.ClassVersionDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes/"+class.ID+"/versions",
		fmt.Sprintf(`{"from":%q}`, class.Versions[0].ID)))
	if w := call(t, handler, "DELETE",
		"/boards/major/flow-node-classes/"+class.ID+"/versions/"+draft.ID, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete draft = %d %q", w.Code, w.Body.String())
	}
	if w := call(t, handler, "DELETE",
		"/boards/major/flow-node-classes/"+class.ID+"/versions/"+class.Versions[0].ID, ""); w.Code != http.StatusBadRequest {
		t.Errorf("delete published = %d, want 400", w.Code)
	}
}

// A version's template mode travels the wire both ways, and instantiating with bodies asks each
// named class's flow node the instantiated text instead of its version's body.
func TestClassVersionTemplateOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	class := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes",
		`{"title":"Review","body":"Read ${what:text}.","template":true}`))
	if !class.Versions[0].Template {
		t.Fatalf("class = %+v, want the template mode filed", class)
	}
	// The checkbox writes the one field, like every other patch on this surface.
	off := decodeBody[httpapi.ClassVersionDto](t, call(t, handler, "PATCH",
		"/boards/major/flow-node-classes/"+class.ID+"/versions/"+class.Versions[0].ID,
		`{"template":false}`))
	if off.Template {
		t.Fatalf("patch = %+v, want the template mode off", off)
	}
	on := decodeBody[httpapi.ClassVersionDto](t, call(t, handler, "PATCH",
		"/boards/major/flow-node-classes/"+class.ID+"/versions/"+class.Versions[0].ID,
		`{"template":true,"status":"published"}`))
	if !on.Template || on.Status != "published" {
		t.Fatalf("publish = %+v, want a published template", on)
	}
	// And the instantiated text is what the flow node is asked — the version's body stays the
	// template it was.
	w := call(t, handler, "POST", "/boards/major/flow-node-classes/"+class.ID+"/instantiate",
		fmt.Sprintf(`{"bodies":{%q:"Read the auth module."}}`, class.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("instantiate = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	if len(made.FlowNodes) != 1 || made.FlowNodes[0].Body != "Read the auth module." {
		t.Fatalf("instantiated = %+v, want the instantiated text", made.FlowNodes)
	}
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.FlowNodeClasses) != 1 || board.FlowNodeClasses[0].Versions[0].Body != "Read ${what:text}." {
		t.Errorf("board = %+v, want the version still holding its template", board.FlowNodeClasses)
	}
}

// The instantiable tick travels the wire both ways, and a workflow class is listed with its
// board and instantiated into a workflow of nodes onto another board.
func TestWorkflowClassInstantiateOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	if w := call(t, handler, "POST", "/boards", `{"name":"Minor"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	class := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes",
		`{"title":"Review","instantiable":true,"body":"Read the diff.","published":true}`))
	if !class.Instantiable {
		t.Fatalf("class = %+v, want the tick filed", class)
	}
	off := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "PATCH",
		"/boards/major/flow-node-classes/"+class.ID, `{"instantiable":false}`))
	if off.Instantiable {
		t.Fatalf("patch = %+v, want the tick off", off)
	}
	second := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes",
		`{"title":"Follow up","body":"Then this.","published":true}`))
	if second.Instantiable {
		t.Fatalf("class = %+v, want off by default", second)
	}
	rectangle := decodeBody[httpapi.WorkflowClassDto](t, call(t, handler, "POST",
		"/boards/major/workflow-classes",
		fmt.Sprintf(`{"name":"Shapes","classes":[%q,%q]}`, class.ID, second.ID)))
	listed := decodeBody[struct {
		WorkflowClasses []httpapi.ListedWorkflowClassDto `json:"workflowClasses"`
	}](t, call(t, handler, "GET", "/workflow-classes", ""))
	if len(listed.WorkflowClasses) != 1 || listed.WorkflowClasses[0].BoardSlug != "major" {
		t.Fatalf("listed = %+v, want the rectangle with its board", listed.WorkflowClasses)
	}
	w := call(t, handler, "POST", "/boards/minor/workflow-classes/"+rectangle.ID+"/instantiate",
		`{"spot":{"x":40,"y":80}}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("instantiate = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[struct {
		Workflow  httpapi.WorkflowDto   `json:"workflow"`
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	if made.Workflow.Name != "Shapes" || len(made.FlowNodes) != 2 {
		t.Fatalf("instantiated = %+v, want Shapes with two nodes", made)
	}
	for _, one := range made.FlowNodes {
		if one.Workflow != made.Workflow.ID {
			t.Errorf("%q names workflow %q, want %q", one.Title, one.Workflow, made.Workflow.ID)
		}
	}
	if made.FlowNodes[0].Spot == nil || made.FlowNodes[1].Spot != nil {
		t.Errorf("spots = %+v, want the head placed and the rest unplaced", made.FlowNodes)
	}
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/minor", ""))
	if len(board.Workflows) != 1 || len(board.FlowNodes) != 2 {
		t.Errorf("board holds %d workflows and %d cards", len(board.Workflows), len(board.FlowNodes))
	}
}

// A workflow is filed with its cards, renamed, and read back on the board beside them — and a
// card made inside it says so at creation. The workflow classes travel the same wire.
func TestWorkflowsOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	cards := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"One"},{"title":"Two"}]}`))
	if len(cards.FlowNodes) != 2 {
		t.Fatalf("cards = %+v, want two", cards.FlowNodes)
	}

	// Filed with its cards: each names the workflow afterwards.
	w := call(t, handler, "POST", "/boards/major/workflows",
		fmt.Sprintf(`{"name":"Sprint","flowNodes":[%q,%q]}`,
			cards.FlowNodes[0].ID, cards.FlowNodes[1].ID))
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
	for _, card := range board.FlowNodes {
		if card.Workflow != made.ID {
			t.Errorf("card %q names workflow %q, want %q", card.Title, card.Workflow, made.ID)
		}
	}

	// A card made inside the rectangle says so at creation.
	inside := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, call(t, handler, "POST", "/boards/major/flow-nodes",
		fmt.Sprintf(`{"flowNodes":[{"title":"Inside","workflow":%q}]}`, made.ID)))
	if len(inside.FlowNodes) != 1 || inside.FlowNodes[0].Workflow != made.ID {
		t.Fatalf("inside = %+v, want the card grouped", inside.FlowNodes)
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

	// A card of another board refuses the workflow.
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

	// Deleted: the rectangle goes and the cards stay, ungrouped.
	if w := call(t, handler, "DELETE", "/boards/major/workflows",
		fmt.Sprintf(`{"workflows":[%q]}`, made.ID)); w.Code != http.StatusNoContent {
		t.Fatalf("delete workflow = %d %q", w.Code, w.Body.String())
	}
	board = decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.Workflows) != 0 {
		t.Fatalf("board holds %d workflows, want none", len(board.Workflows))
	}
	if len(board.FlowNodes) != 3 {
		t.Fatalf("board holds %d cards, want the three still there", len(board.FlowNodes))
	}
	for _, card := range board.FlowNodes {
		if card.Workflow != "" {
			t.Errorf("card %q still names workflow %q", card.Title, card.Workflow)
		}
	}
}

// The workflow classes mirror the workflows: filed with their classes, renamed, read back on
// the board, and deleted into ungrouped classes.
func TestWorkflowClassesOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	first := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes", `{"title":"One"}`))
	second := decodeBody[httpapi.FlowNodeClassDto](t, call(t, handler, "POST",
		"/boards/major/flow-node-classes", `{"title":"Two"}`))

	w := call(t, handler, "POST", "/boards/major/workflow-classes",
		fmt.Sprintf(`{"name":"Shapes","classes":[%q,%q]}`, first.ID, second.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create workflow class = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[httpapi.WorkflowClassDto](t, w)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.WorkflowClasses) != 1 {
		t.Fatalf("board holds %d workflow classes, want one", len(board.WorkflowClasses))
	}
	for _, class := range board.FlowNodeClasses {
		if class.WorkflowClass != made.ID {
			t.Errorf("class %q names workflow class %q, want %q",
				class.Title, class.WorkflowClass, made.ID)
		}
	}

	renamed := decodeBody[httpapi.WorkflowClassDto](t, call(t, handler, "PATCH",
		"/boards/major/workflow-classes/"+made.ID, `{"name":"Forms"}`))
	if renamed.Name != "Forms" {
		t.Fatalf("rename = %+v, want Forms", renamed)
	}

	if w := call(t, handler, "DELETE", "/boards/major/workflow-classes",
		fmt.Sprintf(`{"workflowClasses":[%q]}`, made.ID)); w.Code != http.StatusNoContent {
		t.Fatalf("delete workflow class = %d %q", w.Code, w.Body.String())
	}
	board = decodeBody[httpapi.BoardDetailDto](t, call(t, handler, "GET", "/boards/major", ""))
	if len(board.WorkflowClasses) != 0 || len(board.FlowNodeClasses) != 2 {
		t.Fatalf("board holds %d workflow classes and %d classes",
			len(board.WorkflowClasses), len(board.FlowNodeClasses))
	}
}

// usageCard files a board, an agent and one AI card on it, and answers the card's id: what a
// usage test plays against.
func usageCard(t *testing.T, handler http.Handler) string {
	t.Helper()
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","platform":"claude","model":"opus"}`))
	w := call(t, handler, "POST", "/boards/major/flow-nodes", fmt.Sprintf(
		`{"flowNodes":[{"title":"Write it","body":"Go on.",`+
			`"settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`,
		agent.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create card = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	return created.FlowNodes[0].ID
}

func TestAUsageReportIsFiledAndTotalled(t *testing.T) {
	handler, _ := serve(t)
	card := usageCard(t, handler)

	w := call(t, handler, "POST", "/boards/major/flow-nodes/"+card+"/usage",
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
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/"+card+"/usage",
		`{"id":"123e4567-e89b-42d3-a456-426614174000","run":"run-1",`+
			`"inputTokens":100,"outputTokens":50}`); w.Code != http.StatusCreated {
		t.Fatalf("replay = %d %q", w.Code, w.Body.String())
	}

	w = call(t, handler, "GET", "/boards/major/flow-nodes/"+card+"/usage", "")
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

func TestUsageOnACardThatIsNotThereIsA404(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/no-such-card/usage",
		`{"inputTokens":1}`); w.Code != http.StatusNotFound {
		t.Errorf("record = %d %q, want 404", w.Code, w.Body.String())
	}
	if w := call(t, handler, "GET", "/boards/major/flow-nodes/no-such-card/usage", ""); w.Code != http.StatusNotFound {
		t.Errorf("totals = %d %q, want 404", w.Code, w.Body.String())
	}
}

func TestUsageRefusesWhatIsNotAnAICard(t *testing.T) {
	handler, _ := serve(t)
	if w := call(t, handler, "POST", "/boards", `{"name":"Major"}`); w.Code != http.StatusCreated {
		t.Fatalf("create board = %d %q", w.Code, w.Body.String())
	}
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"title":"Do it"}]}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create card = %d %q", w.Code, w.Body.String())
	}
	created := decodeBody[struct {
		FlowNodes []httpapi.FlowNodeDto `json:"flowNodes"`
	}](t, w)
	if w := call(t, handler, "POST", "/boards/major/flow-nodes/"+created.FlowNodes[0].ID+"/usage",
		`{"inputTokens":1}`); w.Code != http.StatusBadRequest {
		t.Errorf("record on a human card = %d %q, want 400", w.Code, w.Body.String())
	}
}

// A Gateway's branches travel the wire beside the single card: created and patched as the
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
		t.Fatalf("created %d cards, want 3", len(created.FlowNodes))
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
