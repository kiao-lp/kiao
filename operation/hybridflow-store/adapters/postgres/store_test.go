package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
	"kiao/hybridflow-store/core/services"
)

// ── The adapter against a real PostgreSQL ─────────────────────────────────────
//
// The rules of the core are tested against a map (core/services); these are the ones that are only
// true if the *database* makes them true — the conditional claim, the deferred chain constraint,
// the change feed the triggers write. None of them can be checked against a fake,
// because in a fake they are Go code doing what it was told.
//
// The suite skips when no database is configured, so `go test ./...` passes on a machine with no
// PostgreSQL. Point it at a throwaway one to run it:
//
// 	docker run -d --name kiao-wf-test -e POSTGRES_PASSWORD=test -p 45432:5432 postgres:16.16-alpine
// 	KIAO_HYBRIDFLOW_STORE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:45432/postgres \
// 	  go test ./adapters/postgres/
//
// Each test gets a **schema of its own** in that database, created and dropped around it, so the
// suite is parallel-safe and leaves nothing behind.

const testURLEnv = "KIAO_HYBRIDFLOW_STORE_TEST_DATABASE_URL"

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return testPoolAtVersion(t, 0)
}

func testPoolAtVersion(t *testing.T, version int) *pgxpool.Pool {
	t.Helper()
	url := strings.TrimSpace(os.Getenv(testURLEnv))
	if url == "" {
		t.Skipf("%s is not set: skipping the tests that need a database", testURLEnv)
	}
	schema := fmt.Sprintf("t_%s_%d", strings.ToLower(strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())), time.Now().UnixNano()%100000)
	if len(schema) > 60 {
		schema = schema[:60]
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("could not connect to %s: %v", testURLEnv, err)
	}
	if _, err := admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		admin.Close()
		t.Fatalf("could not create the test schema: %v", err)
	}
	admin.Close()

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	// Everything this pool does happens in the test's own schema, so the migrations and every query
	// land there without a line of the adapter knowing about it.
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		cleaner, err := pgxpool.New(context.Background(), url)
		if err != nil {
			return
		}
		defer cleaner.Close()
		_, _ = cleaner.Exec(context.Background(), `DROP SCHEMA `+schema+` CASCADE`)
	})
	if version == 0 {
		if _, err := Migrate(ctx, pool); err != nil {
			t.Fatalf("the schema pass failed: %v", err)
		}
		return pool
	}
	scripts, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, ledgerDDL); err != nil {
		t.Fatal(err)
	}
	for _, script := range scripts {
		if script.version > version {
			break
		}
		if err := applyOne(ctx, conn, script, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now().UTC() }

type uuidIDs struct{ store *BoardStore }

// newID mints a uuid through the database, which is one fewer dependency than a uuid library for a
// service that is never without a connection.
func (i uuidIDs) NewID() string {
	var id string
	if err := i.store.pool.QueryRow(context.Background(), `SELECT gen_random_uuid()::text`).Scan(&id); err != nil {
		panic(err)
	}
	return id
}

func wire(t *testing.T) (*services.Boards, *services.FlowNodes, *BoardStore, *ChangeStore) {
	t.Helper()
	pool := testPool(t)
	boardStore := NewBoardStore(pool)
	agentStore := memory.New()
	runnerStore := NewRunnerStore(pool)
	changeStore := NewChangeStore(pool)
	ids := uuidIDs{store: boardStore}
	// The agent the tests' flow nodes name, filed with a fixed id straight into the store — each test
	// gets a schema of its own, so no two of them share the row.
	now := time.Now().UTC()
	if err := agentStore.CreateAgent(context.Background(), &entities.Agent{
		ID: testAgentID, Name: "Reviewer", Harness: entities.HarnessClaude, Model: "opus",
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	return services.NewBoards(boardStore, realClock{}, ids),
		services.NewFlowNodes(boardStore, agentStore, runnerStore, boardStore, realClock{}, ids),
		boardStore, changeStore
}

// testAgentID is the agent wire() files for the tests that play a flow node: aiSettings names it, and
// the service refuses a flow node naming anything else.
const testAgentID = "00000000-0000-4000-8000-000000000001"

func aiSettings() entities.TaskSettings {
	return entities.TaskSettings{
		Agent: testAgentID, Effort: "high",
		Permission: "bypassPermissions", Folder: "/",
	}
}

func TestSchemaPassIsIdempotent(t *testing.T) {
	pool := testPool(t)
	applied, err := Migrate(context.Background(), pool)
	if err != nil {
		t.Fatalf("a second pass over an up-to-date database failed: %v", err)
	}
	if len(applied) == 0 {
		t.Fatal("the ledger is empty after a pass")
	}
	if applied[0].Version != 1 || applied[0].Name != "initial-schema" {
		t.Errorf("the first migration is V%03d__%s", applied[0].Version, applied[0].Name)
	}
}

// An applied migration is frozen: a build whose script has changed does not start.
func TestAnAppliedMigrationIsFrozen(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `UPDATE schema_migration SET checksum = 'not what the build carries' WHERE version = 1`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Migrate(ctx, pool)
	if err == nil {
		t.Fatal("the pass ran against a changed migration")
	}
	if !strings.Contains(err.Error(), "frozen") {
		t.Errorf("error = %v, want it to say the migration is frozen", err)
	}
}

func TestBoardRoundTrip(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	found, err := boards.Find(ctx, "major")
	if err != nil {
		t.Fatal(err)
	}
	if found.ID != board.ID || found.Slug != "major" {
		t.Errorf("found %+v", found)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Write the plan", Tags: []string{"bug", "ui"}, Body: "Go on.",
		Settings: aiSettings(),
		Spot:     &entities.Spot{X: 40, Y: 80},
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	again, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.Title != "Write the plan" || again.Type != entities.FlowNodeAI {
		t.Errorf("flow node = %+v", again)
	}
	if strings.Join(again.Tags, ",") != "bug,ui" {
		t.Errorf("tags = %v, want [bug ui] in that order", again.Tags)
	}
	want := aiSettings()
	if again.Task == nil {
		t.Fatal("an AI flow node came back with no task")
	}
	if got := again.Settings(); got.Agent != want.Agent || got.Model != want.Model ||
		got.Effort != want.Effort || got.Permission != want.Permission || got.Folder != want.Folder {
		t.Errorf("settings = %+v, want %+v", got, want)
	}
	if again.Task.Body != "Go on." {
		t.Errorf("body = %q, want the description on the task", again.Task.Body)
	}
	if again.Spot == nil || again.Spot.X != 40 || again.Spot.Y != 80 {
		t.Errorf("spot = %+v", again.Spot)
	}
}

// **A flow node is played by one run** — the promise the whole claim design exists for, checked
// where it actually has to hold: twenty goroutines, one row, one winner.
func TestOnlyOneRunTakesAFlowNodeForReal(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Contested"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "One flow node", Settings: aiSettings(), Body: "Go."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		won      int
		unwanted []error
	)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := flowNodes.StartPlay(ctx, made[0].ID, fmt.Sprintf("run-%02d", n), "runner")
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				won++
			case errors.Is(err, entities.ErrFlowNodeHeld), errors.Is(err, entities.ErrInvalid),
				errors.Is(err, entities.ErrFlowNodeEmptyPrompt), errors.Is(err, entities.ErrConflict):
			default:
				unwanted = append(unwanted, err)
			}
		}(i)
	}
	wg.Wait()
	if won != 1 {
		t.Errorf("%d runs took the flow node, want exactly 1", won)
	}
	if len(unwanted) > 0 {
		t.Errorf("unexpected failures: %v", unwanted)
	}
}

func TestClaimInterruptedAIKeepsItsConversation(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Resume"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID,
		[]services.NewFlowNodeRequest{{Title: "Continue", Settings: aiSettings()}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	id := made[0].ID
	if _, err := flowNodes.StartPlay(ctx, id, "run-1", "alex"); err != nil {
		t.Fatal(err)
	}
	chat := "existing-conversation"
	if _, err := flowNodes.Patch(ctx, id, entities.FlowNodePatch{ConversationID: &chat}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.EndPlay(ctx, id, "run-1", "alex", entities.PlayResult{Status: entities.StatusInterrupted}); err != nil {
		t.Fatal(err)
	}
	resumed, err := flowNodes.StartPlay(ctx, id, "run-1", "alex")
	if err != nil || resumed.Status != entities.StatusRunning || resumed.RunID != "run-1" || resumed.ConversationID() != chat {
		t.Fatalf("resumed = %+v, %v", resumed, err)
	}
	if _, err := flowNodes.StartPlay(ctx, id, "run-2", "alex"); !errors.Is(err, entities.ErrFlowNodeHeld) {
		t.Fatalf("competing claim = %v, want the flow node held by the resumed run", err)
	}
}

// Two writers, two fields, both kept — and the revision check refusing only the writer that meant
// the field somebody else had already changed.
func TestTwoWritersOnOneFlowNode(t *testing.T) {
	boards, flowNodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Shared"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{Title: "Both hands", Settings: aiSettings(), Body: "Go."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	stale := made[0].Revision
	title := "Renamed by the person"
	if _, err := store.PatchFlowNode(ctx, made[0].ID, entities.FlowNodePatch{Title: &title}, &stale, "alex"); err != nil {
		t.Fatal(err)
	}
	// The run's write names another field and no revision: it lands over the rename.
	status := entities.StatusDone
	after, err := store.PatchFlowNode(ctx, made[0].ID, entities.FlowNodePatch{Status: &status}, nil, "run-1")
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != title || after.Status != status {
		t.Errorf("flow node = %q at %q, want both writes kept", after.Title, after.Status)
	}
	// A second write from the stale revision is refused.
	other := "Renamed again"
	_, err = store.PatchFlowNode(ctx, made[0].ID, entities.FlowNodePatch{Title: &other}, &stale, "someone")
	if !errors.Is(err, entities.ErrConflict) {
		t.Errorf("the stale write = %v, want ErrConflict", err)
	}
}

// ── the change feed ───────────────────────────────────────────────────────────

func TestEveryWriteAppendsAChangeNamingItsActor(t *testing.T) {
	boards, flowNodes, _, changes := wire(t)
	ctx := context.Background()
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Watched"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{Title: "Watch me", Settings: aiSettings(), Body: "Go."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	feed, latest, err := changes.Since(ctx, from, board.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if latest <= from {
		t.Errorf("the cursor did not move: %d", latest)
	}
	var scopes, actors []string
	for _, change := range feed {
		scopes = append(scopes, string(change.Scope)+"/"+change.Kind)
		actors = append(actors, change.Actor)
		if change.BoardID != board.ID {
			t.Errorf("a change for board %q reached a watcher of %q", change.BoardID, board.ID)
		}
	}
	if len(feed) < 3 {
		t.Errorf("the feed holds %v, want the board, the flow node and its play", scopes)
	}
	if !contains(actors, "alex") || !contains(actors, "run-1") {
		t.Errorf("the feed names %v, want both the person and the run", actors)
	}
}

// A client watching one board is not woken by another board's turns.
func TestTheFeedIsNarrowedToOneBoard(t *testing.T) {
	boards, flowNodes, _, changes := wire(t)
	ctx := context.Background()
	mine, err := boards.Create(ctx, services.NewBoardRequest{Name: "Mine"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := boards.Create(ctx, services.NewBoardRequest{Name: "Theirs"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Create(ctx, theirs.ID, []services.NewFlowNodeRequest{{Title: "Not mine"}}, "alex"); err != nil {
		t.Fatal(err)
	}
	feed, _, err := changes.Since(ctx, from, mine.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed) != 0 {
		t.Errorf("a watcher of Mine was told about %d changes to Theirs", len(feed))
	}
}

// Await is a wait and not a poll: a change landing after the wait starts releases it.
func TestAwaitIsWokenByAWrite(t *testing.T) {
	boards, flowNodes, _, changes := wire(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	listenCtx, stop := context.WithCancel(ctx)
	defer stop()
	go changes.Listen(listenCtx)

	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Awaited"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Give the listener a moment to have issued its LISTEN, so the wait below is the real path
	// rather than the one-second fallback.
	time.Sleep(300 * time.Millisecond)

	woken := make(chan bool, 1)
	go func() { woken <- changes.Await(ctx, from) }()
	time.Sleep(100 * time.Millisecond)
	if _, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{Title: "Wake up"}}, "alex"); err != nil {
		t.Fatal(err)
	}
	select {
	case ok := <-woken:
		if !ok {
			t.Error("the wait ended without a change")
		}
	case <-time.After(5 * time.Second):
		t.Error("the wait was never woken")
	}
}

// Reading the cursor must not wake another client's held request. Otherwise two idle clients
// keep each other querying PostgreSQL until their HTTP timeouts expire.
func TestReadingAnUnchangedCursorLeavesAClientWaiting(t *testing.T) {
	_, _, _, changes := wire(t)
	changes.setListening(true)
	from, err := changes.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	read := make(chan error, 1)
	go func() {
		time.Sleep(30 * time.Millisecond)
		_, err := changes.Latest(context.Background())
		read <- err
	}()
	woken := changes.Await(ctx, from)
	if err := <-read; err != nil {
		t.Fatal(err)
	}
	if woken {
		t.Fatal("an unchanged cursor woke an idle client")
	}
}

func TestPruningTheWholeFeedDoesNotRewindItsCursor(t *testing.T) {
	boards, _, store, changes := wire(t)
	ctx := context.Background()
	if _, err := boards.Create(ctx, services.NewBoardRequest{Name: "Idle"}, "alex"); err != nil {
		t.Fatal(err)
	}
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE change_event SET at = now() - interval '10 days'`); err != nil {
		t.Fatal(err)
	}
	if _, err := PruneChanges(ctx, store.pool, 72*time.Hour); err != nil {
		t.Fatal(err)
	}
	feed, cursor, err := changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed) != 0 || cursor != from {
		t.Fatalf("pruned feed has %d changes and cursor %d, want no changes at %d", len(feed), cursor, from)
	}
	changes.setListening(true)
	wait, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	if changes.Await(wait, cursor) {
		t.Fatal("pruning the feed woke an idle client")
	}
}

func TestPruneChangesDropsOnlyTheOldOnes(t *testing.T) {
	boards, _, store, changes := wire(t)
	ctx := context.Background()
	if _, err := boards.Create(ctx, services.NewBoardRequest{Name: "Old"}, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE change_event SET at = now() - interval '10 days'`); err != nil {
		t.Fatal(err)
	}
	if _, err := boards.Create(ctx, services.NewBoardRequest{Name: "New"}, "alex"); err != nil {
		t.Fatal(err)
	}
	dropped, err := PruneChanges(ctx, store.pool, 72*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if dropped == 0 {
		t.Error("nothing was pruned")
	}
	feed, _, err := changes.Since(ctx, 0, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range feed {
		if change.At.Before(time.Now().Add(-72 * time.Hour)) {
			t.Errorf("a change from %v survived the prune", change.At)
		}
	}
}

func contains(all []string, one string) bool {
	for _, entry := range all {
		if entry == one {
			return true
		}
	}
	return false
}

var _ ports.ChangeLog = (*ChangeStore)(nil)

// A pasted chain arrives as one batch, with the first flow node naming the second. It goes in whichever
// order the rows come in — which is what the deferred chain constraint is for.
func TestAPastedChainGoesInAsOneBatch(t *testing.T) {
	boards, flowNodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Pasted"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// Built by hand rather than through the service, because what is being tested is the adapter
	// accepting a batch whose first row names its second.
	ids := uuidIDs{store: store}
	first, second := ids.NewID(), ids.NewID()
	now := time.Now().UTC()
	batch := []*entities.FlowNode{
		{ID: first, BoardID: board.ID, Title: "First", Type: entities.FlowNodeHuman,
			Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
			Next: second, Task: &entities.Task{Transition: entities.Transition{Mode: entities.TransitionEnd}}},
		{ID: second, BoardID: board.ID, Title: "Second", Type: entities.FlowNodeHuman,
			Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
			Task: &entities.Task{Transition: entities.Transition{Mode: entities.TransitionEnd}}},
	}
	if err := store.CreateFlowNodes(ctx, batch, "alex"); err != nil {
		t.Fatalf("the batch was refused: %v", err)
	}
	next, err := flowNodes.Next(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.Title != "Second" {
		t.Errorf("next = %v, want Second", next)
	}
}

// The claim is idempotent in the run, checked in SQL: the condition that lets a run come back to
// its own flow node is in the WHERE clause, and no fake can vouch for it.
func TestAClaimIsIdempotentInItsRun(t *testing.T) {
	boards, flowNodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Retried"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Rate limited", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.ClaimFlowNode(ctx, made[0].ID, "run-1", entities.StatusRunning, "run-1")
	if err != nil {
		t.Fatal(err)
	}
	held := entities.StatusWaitingRefresh
	if _, err := store.PatchFlowNode(ctx, made[0].ID, entities.FlowNodePatch{Status: &held}, nil, "run-1"); err != nil {
		t.Fatal(err)
	}
	again, err := store.ClaimFlowNode(ctx, made[0].ID, "run-1", entities.StatusRunning, "run-1")
	if err != nil {
		t.Fatalf("the run could not re-claim its own flow node: %v", err)
	}
	if !again.ClaimedAt.Equal(first.ClaimedAt) {
		t.Errorf("claimed_at moved from %v to %v; the flow node should still say when the play took it",
			first.ClaimedAt, again.ClaimedAt)
	}
	if _, err := store.ClaimFlowNode(ctx, made[0].ID, "run-2", entities.StatusRunning, "run-2"); !errors.Is(err, entities.ErrFlowNodeHeld) {
		t.Errorf("a second run's claim = %v, want ErrFlowNodeHeld", err)
	}
}

// A flow node's chat is a reference to a conversation worker owns, not a row here: binding a
// flow node to a chat id nothing has registered must land, because that is every play — the runner
// writes the conversation it just made onto the flow node it claimed, and no call registers it first.
func TestAFlowNodeBindsToAChatNothingRegistered(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Played"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Played", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "runner"); err != nil {
		t.Fatal(err)
	}
	chat := "conv-1786543210123-ab12"
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{ConversationID: &chat}, nil, "runner"); err != nil {
		t.Fatalf("binding the flow node to its unregistered chat: %v", err)
	}
	bound, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if bound.ConversationID() != chat {
		t.Errorf("flow node chat = %q, want %q", bound.ConversationID(), chat)
	}
}

// What a flow node says about its chat is two answers and two columns, and a flow node may hold either
// without the other: shortened and handed on, shortened and ended, handed on as it is.
func TestWhatAFlowNodeSaysAboutItsChatRoundTrips(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Chained"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go on."},
		{Title: "Second", Settings: aiSettings(), Body: "And then."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	carried := entities.Transition{Mode: entities.TransitionContinue, Compact: true}
	if _, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Next: &made[1].ID, Transition: &carried}, nil, "alex"); err != nil {
		t.Fatalf("writing what the flow node says about its chat: %v", err)
	}
	read, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Next != made[1].ID || read.Task == nil || read.Task.Transition != carried {
		t.Errorf("chain = %q / %+v, want %q / %+v", read.Next, read.Task, made[1].ID, carried)
	}
	// The box on its own: the chat is shortened and handed to nobody, which the one word the mode
	// used to carry could not say.
	ended := entities.Transition{Mode: entities.TransitionEnd, Compact: true}
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Transition: &ended}, nil, "alex"); err != nil {
		t.Fatalf("writing the compaction with the conversation ended: %v", err)
	}
	alone, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if alone.Task == nil || alone.Task.Transition != ended {
		t.Errorf("transition = %+v, want %+v", alone.Task, ended)
	}
}

// What a task is measured against round-trips through SQL — the columns the service writes are
// the columns it reads — and goes with the task when the flow node stops being one.
func TestWhatATaskIsMeasuredAgainstRoundTrips(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Measured"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	three := 3
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Do it", Settings: aiSettings(), Body: "Go on.",
			Criteria:   []entities.SuccessCriterion{{Text: "It holds"}},
			Complexity: &three},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	read, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Task == nil || len(read.Task.Criteria) != 1 || read.Task.Criteria[0].Text != "It holds" ||
		read.Task.Criteria[0].ID == "" {
		t.Fatalf("criteria = %+v, want the measured line with a minted id", read.Task)
	}
	if read.Task.Complexity == nil || *read.Task.Complexity != 3 {
		t.Fatalf("complexity = %v, want 3", read.Task.Complexity)
	}
	// Replaced whole, and the estimation taken off on purpose.
	replacement := []entities.SuccessCriterion{{ID: read.Task.Criteria[0].ID, Text: "It holds, still"}}
	after, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{
		Criteria: &replacement, ClearComplexity: true,
	}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Task.Criteria) != 1 || after.Task.Criteria[0].Text != "It holds, still" {
		t.Errorf("criteria = %+v, want the replacement", after.Task.Criteria)
	}
	if after.Task.Complexity != nil {
		t.Errorf("complexity = %v, want none after clearing", after.Task.Complexity)
	}
	// Retyped away from a task, both go with it; retyped back, the flow node starts unmeasured.
	shutdown := entities.FlowNodeShutdown
	off, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &shutdown}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if off.Task != nil {
		t.Fatalf("a Shutdown carries %+v, want no task", off.Task)
	}
	human := entities.FlowNodeHuman
	back, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if back.Task == nil || len(back.Task.Criteria) != 0 || back.Task.Complexity != nil {
		t.Errorf("a flow node typed back carries %+v, want an unmeasured task", back.Task)
	}
}

// ── agents ────────────────────────────────────────────────────────────────────

// An agent round-trips through SQL — the columns the service writes are the columns it reads —
// and a name held twice is refused by the store rather than by whoever asked second.
func TestAgentRoundTrip(t *testing.T) {
	pool := testPoolAtVersion(t, 35)
	store := NewAgentStore(pool)
	ctx := context.Background()
	now := time.Now().UTC()
	agent := &entities.Agent{
		ID: "00000000-0000-4000-8000-000000000011", Name: "Reviewer",
		Harness: entities.HarnessClaude, Model: "opus", Instructions: "Be concise.",
		Description: "Review code.",
		CreatedAt:   now, UpdatedAt: now, Revision: 1,
	}
	if err := store.CreateAgent(ctx, agent, "alex"); err != nil {
		t.Fatal(err)
	}
	found, err := store.FindAgent(ctx, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if found.Description != "Review code." || found.Instructions != "Be concise." {
		t.Errorf("agent = %+v, want the description and instructions filed separately", found)
	}
	if err := store.CreateAgent(ctx, &entities.Agent{
		ID: "00000000-0000-4000-8000-000000000012", Name: "reviewer",
		Harness: entities.HarnessCodex, CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); !errors.Is(err, entities.ErrAgentNameTaken) {
		t.Errorf("a taken name = %v, want it refused", err)
	}
	model := "sonnet"
	patched, err := store.PatchAgent(ctx, agent.ID, entities.AgentPatch{Model: &model}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Model != "sonnet" || patched.Name != "Reviewer" || patched.Description != "Review code." || patched.Revision != 2 {
		t.Errorf("agent = %+v, want only the model changed at revision 2", patched)
	}
	stale := int64(1)
	if _, err := store.PatchAgent(ctx, agent.ID, entities.AgentPatch{Model: &model}, &stale, "alex"); !errors.Is(err, entities.ErrConflict) {
		t.Errorf("a stale patch = %v, want a conflict", err)
	}
	listed, err := store.ListAgents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != agent.ID || listed[0].Instructions != "Be concise." || listed[0].Description != "Review code." {
		t.Errorf("agents = %+v, want the one filed", listed)
	}
	for _, description := range []string{"Review Go code.", ""} {
		patched, err := store.PatchAgent(ctx, agent.ID, entities.AgentPatch{Description: &description}, nil, "alex")
		if err != nil {
			t.Fatal(err)
		}
		if patched.Description != description || patched.Instructions != "Be concise." {
			t.Errorf("agent = %+v, want only the description changed", patched)
		}
	}
	if err := store.DeleteAgent(ctx, agent.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindAgent(ctx, agent.ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("a deleted agent reads %v, want not found", err)
	}
}

// An agent's writes announce themselves on the feed under their own scope, carrying the agent
// rather than a board — and a client watching one board is never woken by one.
func TestAgentWritesAnnounceThemselves(t *testing.T) {
	pool := testPoolAtVersion(t, 35)
	store := NewAgentStore(pool)
	changes := NewChangeStore(pool)
	ctx := context.Background()
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	id := "00000000-0000-4000-8000-000000000013"
	if err := store.CreateAgent(ctx, &entities.Agent{
		ID: id, Name: "Reviewer", Harness: entities.HarnessClaude,
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	feed, _, err := changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed) != 1 || feed[0].Scope != entities.ScopeAgent || feed[0].AgentID != id ||
		feed[0].Actor != "alex" || feed[0].BoardID != "" {
		t.Errorf("feed = %+v, want one agent change naming its actor", feed)
	}
	watched, _, err := changes.Since(ctx, from, "00000000-0000-4000-8000-000000000099", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(watched) != 0 {
		t.Errorf("a board watcher was told about %d agent changes", len(watched))
	}
}

// ── runners ───────────────────────────────────────────────────────────────────

// The store opens with two runners — the server and the desktop — under ids the deployments
// name in their env files.
func TestRunnerSeedIsServerAndDesktop(t *testing.T) {
	pool := testPool(t)
	store := NewRunnerStore(pool)
	ctx := context.Background()
	listed, err := store.ListRunners(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 {
		t.Fatalf("runners = %+v, want the seeded two", listed)
	}
	if listed[0].Name != "Desktop" || listed[1].Name != "Server" {
		t.Errorf("runners = %+v, want both runners by name", listed)
	}
	for _, runner := range listed {
		if runner.LastSeen != nil {
			t.Errorf("%s was last seen %v, want never", runner.Name, runner.LastSeen)
		}
		if _, err := store.FindRunner(ctx, runner.ID); err != nil {
			t.Errorf("runner %s does not read back: %v", runner.Name, err)
		}
	}
}

// A runner round-trips through SQL, and a name held twice is refused by the store.
func TestRunnerRoundTrip(t *testing.T) {
	pool := testPool(t)
	store := NewRunnerStore(pool)
	ctx := context.Background()
	now := time.Now().UTC()
	runner := &entities.Runner{
		ID: "00000000-0000-4000-8000-000000000021", Name: "Spare",
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	if err := store.CreateRunner(ctx, runner, "alex"); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateRunner(ctx, &entities.Runner{
		ID: "00000000-0000-4000-8000-000000000022", Name: "spare",
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); !errors.Is(err, entities.ErrRunnerNameTaken) {
		t.Errorf("a taken name = %v, want it refused", err)
	}
	name := "Spare Box"
	patched, err := store.PatchRunner(ctx, runner.ID, entities.RunnerPatch{Name: &name}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Name != "Spare Box" || patched.Revision != 2 {
		t.Errorf("runner = %+v, want the rename at revision 2", patched)
	}
	stale := int64(1)
	if _, err := store.PatchRunner(ctx, runner.ID, entities.RunnerPatch{Name: &name}, &stale, "alex"); !errors.Is(err, entities.ErrConflict) {
		t.Errorf("a stale patch = %v, want a conflict", err)
	}
	if err := store.DeleteRunner(ctx, runner.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindRunner(ctx, runner.ID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("a deleted runner reads %v, want not found", err)
	}
}

// The heartbeat stamps last seen and nothing else: the revision stands still — renaming a runner
// never races the calls its own process keeps making — and the feed hears nothing of it, while a
// rename lands on the feed under the runner's own scope.
func TestHeartbeatMovesOnlyLastSeen(t *testing.T) {
	pool := testPool(t)
	store := NewRunnerStore(pool)
	changes := NewChangeStore(pool)
	ctx := context.Background()
	from, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Truncated past the database's own precision: timestamptz keeps microseconds, and the
	// comparison below is on the instant.
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := "00000000-0000-4000-8000-000000000023"
	if err := store.CreateRunner(ctx, &entities.Runner{
		ID: id, Name: "Spare", CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	seen, err := store.Heartbeat(ctx, id, now, "runner")
	if err != nil {
		t.Fatal(err)
	}
	if seen.LastSeen == nil || !seen.LastSeen.Equal(now) {
		t.Fatalf("runner = %+v, want last seen stamped", seen)
	}
	if seen.Revision != 1 {
		t.Errorf("revision = %d, want 1: the heartbeat moves nothing else", seen.Revision)
	}
	name := "Spare Box"
	if _, err := store.PatchRunner(ctx, id, entities.RunnerPatch{Name: &name}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	feed, _, err := changes.Since(ctx, from, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	// Created and renamed; the heartbeat between them wrote no row.
	if len(feed) != 2 || feed[0].Scope != entities.ScopeRunner || feed[0].RunnerID != id ||
		feed[1].Scope != entities.ScopeRunner || feed[1].RunnerID != id {
		t.Errorf("feed = %+v, want the create and the rename and no heartbeat", feed)
	}
}

// A workflow round-trips through the database: the name, the members naming it, and the delete
// ungrouping them — the schema's ON DELETE SET NULL — rather than taking them.
func TestWorkflowRoundTrip(t *testing.T) {
	boards, flowNodes, boardStore, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	workflows := services.NewWorkflows(boardStore, boardStore, realClock{}, uuidIDs{store: boardStore})
	nodes, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "One"}, {Title: "Two"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := workflows.Create(ctx, board.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{nodes[0].ID, nodes[1].ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	found, err := workflows.Find(ctx, made.ID)
	if err != nil {
		t.Fatal(err)
	}
	if found.Name != "Sprint" || found.BoardID != board.ID {
		t.Errorf("workflow = %+v, want the name filed on the board", found)
	}
	for _, flowNode := range nodes {
		again, err := flowNodes.Find(ctx, flowNode.ID)
		if err != nil {
			t.Fatal(err)
		}
		if again.WorkflowID != made.ID {
			t.Errorf("flow node %q names workflow %q, want %q", flowNode.Title, again.WorkflowID, made.ID)
		}
	}
	renamed, err := workflows.Patch(ctx, made.ID,
		entities.WorkflowPatch{Name: &[]string{"Release"}[0]}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Release" || renamed.Revision != 2 {
		t.Errorf("rename = %+v, want Release at revision 2", renamed)
	}
	folder, files := "/release", []string{"/sources/brief.md", "/sources/templates"}
	if _, err := workflows.Patch(ctx, made.ID,
		entities.WorkflowPatch{WorkflowFolder: &folder, Files: files}, &renamed.Revision, "alex"); err != nil {
		t.Fatal(err)
	}
	groups, err := workflows.Board(ctx, board.ID)
	if err != nil || len(groups) != 1 || groups[0].WorkflowFolder != folder || !slices.Equal(groups[0].Files, files) {
		t.Fatalf("workflow files on board = %+v, %v", groups, err)
	}
	empty := ""
	cleared, err := workflows.Patch(ctx, made.ID, entities.WorkflowPatch{WorkflowFolder: &empty, Files: []string{}},
		&groups[0].Revision, "alex")
	if err != nil || cleared.WorkflowFolder != "" || len(cleared.Files) != 0 {
		t.Fatalf("cleared workflow = %+v, %v", cleared, err)
	}
	if err := workflows.Delete(ctx, []string{made.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	for _, flowNode := range nodes {
		again, err := flowNodes.Find(ctx, flowNode.ID)
		if err != nil {
			t.Fatalf("flow node %q should still be there: %v", flowNode.Title, err)
		}
		if again.WorkflowID != "" {
			t.Errorf("flow node %q still names workflow %q", flowNode.Title, again.WorkflowID)
		}
	}
}

func TestWorkflowCreationRollsBackWithItsFlowNodes(t *testing.T) {
	boards, flowNodes, store, changes := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	const heldID = "00000000-0000-4000-8000-000000000101"
	const newID = "00000000-0000-4000-8000-000000000102"
	const workflowID = "00000000-0000-4000-8000-000000000103"
	if _, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{ID: heldID, Title: "Original"}}, "alex"); err != nil {
		t.Fatal(err)
	}
	cursor, err := changes.Latest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	workflow := &entities.Workflow{
		ID: workflowID, BoardID: board.ID, Name: "Copy", CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	member := &entities.FlowNode{
		ID: newID, BoardID: board.ID, WorkflowID: workflowID, Title: "Copy", Type: entities.FlowNodeHuman,
		Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	collision := *member
	collision.ID = heldID
	if err := store.CreateWorkflowWithFlowNodes(ctx, workflow, []*entities.FlowNode{member, &collision}, "alex"); !errors.Is(err, entities.ErrConflict) {
		t.Fatalf("create with colliding flow node = %v, want conflict", err)
	}
	if _, err := store.FindWorkflow(ctx, workflowID); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("rolled-back workflow read = %v, want not found", err)
	}
	nodes, err := store.ListFlowNodes(ctx, board.ID)
	if err != nil || len(nodes) != 1 || nodes[0].ID != heldID || nodes[0].WorkflowID != "" {
		t.Fatalf("remaining flow nodes = %+v, err = %v", nodes, err)
	}
	if events, _, err := changes.Since(ctx, cursor, board.ID, 10); err != nil || len(events) != 0 {
		t.Errorf("changes after rollback = %+v, err = %v", events, err)
	}
}

// A Gateway's branches are rows of their own — one per branch, in the order the flow node lists them —
// read back with the flow node. Deleting a branch takes it out of every list naming it, the way the
// single chain is broken by the schema rather than by a call site.
func TestAGatewaysBranchesAreRowsOfTheirOwn(t *testing.T) {
	boards, flowNodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Forked"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Branch one", Settings: aiSettings(), Body: "Go."},
		{Title: "Branch two", Settings: aiSettings(), Body: "Go."},
		{Title: "Join", Type: string(entities.FlowNodeGateway)},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	join, first, second := made[2].ID, made[0].ID, made[1].ID
	if _, err := flowNodes.Chain(ctx, join, first, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, join, second, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := store.FindFlowNode(ctx, join)
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Nexts) != 2 || held.Nexts[0] != first || held.Nexts[1] != second {
		t.Fatalf("branches = %q, want both drawn, in order", held.Nexts)
	}
	if err := flowNodes.Delete(ctx, []string{first}, "alex"); err != nil {
		t.Fatal(err)
	}
	again, err := store.FindFlowNode(ctx, join)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Nexts) != 1 || again.Nexts[0] != second {
		t.Errorf("branches = %q, want the deleted branch taken out of the list", again.Nexts)
	}
}

// A pasted Gateway arrives in one batch with the branches it names — which is what the branches'
// deferred constraints are for, as the single chain's is for a pasted chain.
func TestAPastedGatewayGoesInAsOneBatch(t *testing.T) {
	boards, _, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Pasted"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// Built by hand rather than through the service, because what is being tested is the adapter
	// accepting a batch whose Gateway names branches of the same batch.
	ids := uuidIDs{store: store}
	join, first, second := ids.NewID(), ids.NewID(), ids.NewID()
	now := time.Now().UTC()
	batch := []*entities.FlowNode{
		{ID: join, BoardID: board.ID, Title: "Join", Type: entities.FlowNodeGateway,
			Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
			Nexts: []string{first, second}},
		{ID: first, BoardID: board.ID, Title: "Branch one", Type: entities.FlowNodeHuman,
			Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
			Task: &entities.Task{Transition: entities.Transition{Mode: entities.TransitionEnd}}},
		{ID: second, BoardID: board.ID, Title: "Branch two", Type: entities.FlowNodeHuman,
			Status: entities.StatusReady, CreatedAt: now, UpdatedAt: now, Revision: 1,
			Task: &entities.Task{Transition: entities.Transition{Mode: entities.TransitionEnd}}},
	}
	if err := store.CreateFlowNodes(ctx, batch, "alex"); err != nil {
		t.Fatalf("the batch was refused: %v", err)
	}
	held, err := store.FindFlowNode(ctx, join)
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Nexts) != 2 || held.Nexts[0] != first || held.Nexts[1] != second {
		t.Errorf("branches = %q, want both, in order", held.Nexts)
	}
}

func TestBitbucketPRStatusRoundTrip(t *testing.T) {
	boards, nodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Pull requests"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	flowNodes, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Wait for merge", Type: "bitbucket-pr-status", PullRequestID: "team/repo#42",
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	id := flowNodes[0].ID
	if _, err := nodes.StartPlay(ctx, id, "run", "alex"); !errors.Is(err, entities.ErrFlowNodeNotRunnable) {
		t.Fatalf("playing an incomplete event returned %v", err)
	}
	invalid := "APPROVED"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{PullRequestStatus: &invalid}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("setting an invalid status returned %v", err)
	}
	target := " merged "
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{PullRequestStatus: &target}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	node, err := nodes.StartPlay(ctx, id, "run", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.Type != entities.FlowNodeBitbucketPRStatus || node.PullRequestID != "team/repo#42" ||
		node.PullRequestStatus != "MERGED" || node.Task != nil {
		t.Fatalf("claimed Bitbucket event = %+v", node)
	}
	if _, err := nodes.EndPlay(ctx, id, "run", "alex", entities.PlayResult{Status: entities.StatusDone}); err != nil {
		t.Fatal(err)
	}
	requestExpression, targetExpression := "team/repo#{{input.pullRequestId}}", "{{ input.targetStatus }}"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{PullRequestID: &requestExpression, PullRequestStatus: &targetExpression}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	node, err = nodes.StartPlay(ctx, id, "run", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.PullRequestID != requestExpression || node.PullRequestStatus != targetExpression {
		t.Fatalf("claimed pull request event lost its references: %+v", node)
	}
	if _, err := nodes.EndPlay(ctx, id, "run", "alex", entities.PlayResult{Status: entities.StatusDone}); err != nil {
		t.Fatal(err)
	}
	human := entities.FlowNodeHuman
	node, err = nodes.Patch(ctx, id, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.PullRequestID != "" || node.PullRequestStatus != "" {
		t.Fatalf("retyped flow node still carries Bitbucket fields: %+v", node)
	}
}

func TestBitbucketCommitStatusRoundTrip(t *testing.T) {
	boards, nodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Builds"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	flowNodes, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Wait for builds", Type: "bitbucket-commit-status", CommitStatus: " successful ",
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	id := flowNodes[0].ID
	if _, err := nodes.StartPlay(ctx, id, "run", "alex"); !errors.Is(err, entities.ErrFlowNodeNotRunnable) {
		t.Fatalf("playing an incomplete event returned %v", err)
	}
	invalid := "team/repo@main"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{CommitID: &invalid}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("setting an invalid commit ID returned %v", err)
	}
	invalidStatus := "MERGED"
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{CommitStatus: &invalidStatus}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Fatalf("setting an invalid commit status returned %v", err)
	}
	commitID := " team/repo@a1b2c3d "
	if _, err := nodes.Patch(ctx, id, entities.FlowNodePatch{CommitID: &commitID}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	node, err := nodes.StartPlay(ctx, id, "run", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.Type != entities.FlowNodeBitbucketCommitStatus || node.CommitID != "team/repo@a1b2c3d" ||
		node.CommitStatus != "SUCCESSFUL" || node.Task != nil {
		t.Fatalf("claimed Bitbucket commit event = %+v", node)
	}
	if _, err := nodes.EndPlay(ctx, id, "run", "alex", entities.PlayResult{Status: entities.StatusDone}); err != nil {
		t.Fatal(err)
	}
	human := entities.FlowNodeHuman
	node, err = nodes.Patch(ctx, id, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.CommitID != "" || node.CommitStatus != "" {
		t.Fatalf("retyped flow node still carries Bitbucket commit fields: %+v", node)
	}
	const commitExpression, targetExpression = "{{currentWorkflow.commitId}}", "{{role.commitStatus}}"
	flowNodes, err = nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Wait for published builds", Type: "bitbucket-commit-status",
		CommitID: commitExpression, CommitStatus: targetExpression,
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	node, err = nodes.StartPlay(ctx, flowNodes[0].ID, "run", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.CommitID != commitExpression || node.CommitStatus != targetExpression {
		t.Fatalf("claimed commit event lost its references: %+v", node)
	}
}

// Exercise Scheduler duration and mode changes against a real schema.
func TestSchedulerDurationRoundTrip(t *testing.T) {
	boards, nodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Timers"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	nodesCreated, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "Pause", Type: "scheduler", Duration: "15m"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	node := &nodesCreated[0]
	if node.Duration != "15m" || node.ScheduledAt != "" {
		t.Fatalf("scheduler = %+v", node)
	}
	at := "2026-10-16T22:00"
	node, err = nodes.Patch(ctx, node.ID, entities.FlowNodePatch{ScheduledAt: &at}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.Duration != "" || node.ScheduledAt != at {
		t.Fatalf("datetime switch = %+v", node)
	}
	duration := "30s"
	node, err = nodes.Patch(ctx, node.ID, entities.FlowNodePatch{Duration: &duration}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.Duration != duration || node.ScheduledAt != "" {
		t.Fatalf("duration switch = %+v", node)
	}
	expression := "{{role.scheduledAt}}"
	node, err = nodes.Patch(ctx, node.ID, entities.FlowNodePatch{ScheduledAt: &expression}, nil, "alex")
	if err != nil || node.ScheduledAt != expression || node.Duration != "" {
		t.Fatalf("scheduler datetime reference = %+v, %v", node, err)
	}
	node, err = nodes.Patch(ctx, node.ID, entities.FlowNodePatch{Duration: &expression}, nil, "alex")
	if err != nil || node.Duration != expression || node.ScheduledAt != "" {
		t.Fatalf("scheduler duration reference = %+v, %v", node, err)
	}
}

func agentRepository(t *testing.T) *memory.Store {
	t.Helper()
	repository := memory.New()
	a := &entities.Agent{ID: testAgentID, Name: "Reviewer", Harness: entities.HarnessClaude, Model: "opus", Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := repository.CreateAgent(context.Background(), a, "test"); err != nil {
		t.Fatal(err)
	}
	return repository
}
