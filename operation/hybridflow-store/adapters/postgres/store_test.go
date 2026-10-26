package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
// 	docker run -d --name kiao-wf-test -e POSTGRES_PASSWORD=test -p 45432:5432 postgres:16-alpine
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
	agentStore := NewAgentStore(pool)
	runnerStore := NewRunnerStore(pool)
	changeStore := NewChangeStore(pool)
	ids := uuidIDs{store: boardStore}
	// The agent the tests' cards name, filed with a fixed id straight into the store — each test
	// gets a schema of its own, so no two of them share the row.
	now := time.Now().UTC()
	if err := agentStore.CreateAgent(context.Background(), &entities.Agent{
		ID: testAgentID, Name: "Reviewer", Platform: entities.PlatformClaude, Model: "opus",
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}, "alex"); err != nil {
		t.Fatal(err)
	}
	return services.NewBoards(boardStore, realClock{}, ids),
		services.NewFlowNodes(boardStore, agentStore, runnerStore, boardStore, boardStore, realClock{}, ids),
		boardStore, changeStore
}

// testAgentID is the agent wire() files for the tests that play a card: aiSettings names it, and
// the service refuses a card naming anything else.
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
		t.Errorf("card = %+v", again)
	}
	if strings.Join(again.Tags, ",") != "bug,ui" {
		t.Errorf("tags = %v, want [bug ui] in that order", again.Tags)
	}
	want := aiSettings()
	if again.Task == nil {
		t.Fatal("an AI card came back with no task")
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
func TestOnlyOneRunTakesACardForReal(t *testing.T) {
	boards, flowNodes, _, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Contested"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "One card", Settings: aiSettings(), Body: "Go."},
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
		t.Errorf("%d runs took the card, want exactly 1", won)
	}
	if len(unwanted) > 0 {
		t.Errorf("unexpected failures: %v", unwanted)
	}
}

// Two writers, two fields, both kept — and the revision check refusing only the writer that meant
// the field somebody else had already changed.
func TestTwoWritersOnOneCard(t *testing.T) {
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
		t.Errorf("card = %q at %q, want both writes kept", after.Title, after.Status)
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
		t.Errorf("the feed holds %v, want the board, the card and its play", scopes)
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

// A pasted chain arrives as one batch, with the first card naming the second. It goes in whichever
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
// its own card is in the WHERE clause, and no fake can vouch for it.
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
		t.Fatalf("the run could not re-claim its own card: %v", err)
	}
	if !again.ClaimedAt.Equal(first.ClaimedAt) {
		t.Errorf("claimed_at moved from %v to %v; the card should still say when the play took it",
			first.ClaimedAt, again.ClaimedAt)
	}
	if _, err := store.ClaimFlowNode(ctx, made[0].ID, "run-2", entities.StatusRunning, "run-2"); !errors.Is(err, entities.ErrFlowNodeHeld) {
		t.Errorf("a second run's claim = %v, want ErrFlowNodeHeld", err)
	}
}

// A card's chat is a reference to a conversation worker owns, not a row here: binding a
// card to a chat id nothing has registered must land, because that is every play — the runner
// writes the conversation it just made onto the card it claimed, and no call registers it first.
func TestACardBindsToAChatNothingRegistered(t *testing.T) {
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
		t.Fatalf("binding the card to its unregistered chat: %v", err)
	}
	bound, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if bound.ConversationID() != chat {
		t.Errorf("card chat = %q, want %q", bound.ConversationID(), chat)
	}
}

// What a card says about its chat is two answers and two columns, and a card may hold either
// without the other: shortened and handed on, shortened and ended, handed on as it is.
func TestWhatACardSaysAboutItsChatRoundTrips(t *testing.T) {
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
		t.Fatalf("writing what the card says about its chat: %v", err)
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
// the columns it reads — and goes with the task when the card stops being one.
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
	// Retyped away from a task, both go with it; retyped back, the card starts unmeasured.
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
		t.Errorf("a card typed back carries %+v, want an unmeasured task", back.Task)
	}
}

// ── agents ────────────────────────────────────────────────────────────────────

// An agent round-trips through SQL — the columns the service writes are the columns it reads —
// and a name held twice is refused by the store rather than by whoever asked second.
func TestAgentRoundTrip(t *testing.T) {
	pool := testPool(t)
	store := NewAgentStore(pool)
	ctx := context.Background()
	now := time.Now().UTC()
	agent := &entities.Agent{
		ID: "00000000-0000-4000-8000-000000000011", Name: "Reviewer",
		Platform: entities.PlatformClaude, Model: "opus", Instructions: "Be concise.",
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
		Platform: entities.PlatformCodex, CreatedAt: now, UpdatedAt: now, Revision: 1,
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
	pool := testPool(t)
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
		ID: id, Name: "Reviewer", Platform: entities.PlatformClaude,
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

// A class round-trips through the database: the class with its tags and chain, its versions in
// succession, and the flow node's link to its version resolved at the read.
func TestFlowNodeClassRoundTrip(t *testing.T) {
	boards, flowNodes, boardStore, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	classes := services.NewFlowNodeClasses(boardStore, boardStore, NewAgentStore(boardStore.pool), NewRunnerStore(boardStore.pool), boardStore, realClock{}, uuidIDs{store: boardStore})
	made, err := classes.Create(ctx, board.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Tags: []string{"bug"}, Permission: "manualLive",
		Body: "Read the diff.", Criteria: []entities.SuccessCriterion{{Text: "No nits"}},
		Agent: testAgentID, Note: "When the diff is ready.", Instantiable: true,
		Spot: &entities.Spot{X: 10, Y: 20}, Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, board.ID, services.NewClassRequest{Title: "Follow up"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, made.Class.ID, second.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	found, err := classes.Find(ctx, made.Class.ID)
	if err != nil {
		t.Fatal(err)
	}
	if found.Class.Next != second.Class.ID || strings.Join(found.Class.Tags, ",") != "bug" {
		t.Errorf("class = %+v, want the chain and the tags", found.Class)
	}
	if found.Class.Spot == nil || found.Class.Spot.X != 10 {
		t.Errorf("spot = %+v, want (10, 20)", found.Class.Spot)
	}
	if len(found.Versions) != 1 || !found.Versions[0].Status.Published() || len(found.Versions[0].Criteria) != 1 {
		t.Fatalf("versions = %+v, want one published with one criterion", found.Versions)
	}
	if found.Versions[0].Criteria[0].ID == "" {
		t.Error("the criterion came back with no id")
	}
	if found.Versions[0].Agent != testAgentID {
		t.Errorf("agent = %q, want the default filed", found.Versions[0].Agent)
	}
	if found.Class.Note != "When the diff is ready." {
		t.Errorf("note = %q, want the class's own words", found.Class.Note)
	}
	if !found.Class.Instantiable {
		t.Errorf("instantiable = false, want the tick kept")
	}
	tick := true
	ticked, err := classes.Patch(ctx, second.Class.ID,
		entities.FlowNodeClassPatch{Instantiable: &tick}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !ticked.Instantiable {
		t.Errorf("instantiable = false, want the patch's tick kept")
	}
	edited := "Read it twice."
	renoted, err := classes.Patch(ctx, made.Class.ID, entities.FlowNodeClassPatch{Note: &edited}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if renoted.Note != "Read it twice." {
		t.Errorf("note = %q, want the edited words", renoted.Note)
	}

	// A second version, then an instantiation from the latest published one.
	draft, err := classes.CreateVersion(ctx, made.Class.ID, services.NewVersionRequest{Body: "draft words."}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	published := entities.ClassVersionPublished
	if _, err := classes.PatchVersion(ctx, second.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Status: &published}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	instances, err := classes.Instantiate(ctx, made.Class.ID, board.ID, nil, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 2 || instances[0].Next != instances[1].ID {
		t.Fatalf("instances = %+v, want the chain recreated", instances)
	}
	if instances[0].Task == nil || instances[0].Task.Body != "Read the diff." {
		t.Errorf("head = %+v, want the published words, not the draft's", instances[0])
	}
	if instances[0].Task == nil || instances[0].Task.Settings.Agent != testAgentID {
		t.Errorf("head = %+v, want the version's default agent assigned", instances[0])
	}
	if instances[0].ClassRef == nil || instances[0].ClassRef.ClassTitle != "Review" || instances[0].ClassRef.VersionNumber != 1 {
		t.Errorf("ref = %+v, want the class and version resolved", instances[0].ClassRef)
	}

	// And the card reads the same link back on its own read.
	again, err := flowNodes.Find(ctx, instances[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.ClassVersionID != made.Versions[0].ID {
		t.Errorf("card version = %q, want %q", again.ClassVersionID, made.Versions[0].ID)
	}

	// The draft somebody changed their mind about goes; the published one stays.
	if err := classes.DeleteVersion(ctx, draft.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	left, err := classes.Versions(ctx, made.Class.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 || left[0].ID != made.Versions[0].ID {
		t.Errorf("versions = %+v, want only the published one left", left)
	}
	if err := classes.DeleteVersion(ctx, made.Versions[0].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("delete = %v, want a published version refused", err)
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
	workflows := services.NewWorkflows(boardStore, boardStore, boardStore, realClock{}, uuidIDs{store: boardStore})
	cards, err := flowNodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{
		{Title: "One"}, {Title: "Two"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := workflows.Create(ctx, board.ID, services.NewWorkflowRequest{
		Name: "Sprint", FlowNodes: []string{cards[0].ID, cards[1].ID},
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
	for _, card := range cards {
		again, err := flowNodes.Find(ctx, card.ID)
		if err != nil {
			t.Fatal(err)
		}
		if again.WorkflowID != made.ID {
			t.Errorf("card %q names workflow %q, want %q", card.Title, again.WorkflowID, made.ID)
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
	if err := workflows.Delete(ctx, []string{made.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	for _, card := range cards {
		again, err := flowNodes.Find(ctx, card.ID)
		if err != nil {
			t.Fatalf("card %q should still be there: %v", card.Title, err)
		}
		if again.WorkflowID != "" {
			t.Errorf("card %q still names workflow %q", card.Title, again.WorkflowID)
		}
	}

	// The menu lists every workflow class of every board through the one new read.
	rectangle, err := workflows.CreateClass(ctx, board.ID,
		services.NewWorkflowClassRequest{Name: "Shapes"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	all, err := boardStore.ListAllWorkflowClasses(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].ID != rectangle.ID {
		t.Errorf("all = %+v, want the one rectangle", all)
	}
}

// A Gateway's branches are rows of their own — one per branch, in the order the card lists them —
// read back with the card. Deleting a branch takes it out of every list naming it, the way the
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

// Exercise SQL paths for duration presets, instances and mode switches against a real schema.
func TestSchedulerDurationRoundTrip(t *testing.T) {
	boards, nodes, store, _ := wire(t)
	ctx := context.Background()
	board, err := boards.Create(ctx, services.NewBoardRequest{Name: "Timers"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	classes := services.NewFlowNodeClasses(store, store, NewAgentStore(store.pool), NewRunnerStore(store.pool), store, realClock{}, uuidIDs{store: store})
	preset, err := classes.Create(ctx, board.ID, services.NewClassRequest{
		Title: "Pause", Type: "scheduler", Duration: "15m", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if preset.Class.Duration != "15m" {
		t.Fatalf("class duration = %q", preset.Class.Duration)
	}
	instances, err := classes.Instantiate(ctx, preset.Class.ID, board.ID, nil, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	node, err := nodes.Find(ctx, instances[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if node.Duration != "15m" || node.ScheduledAt != "" {
		t.Fatalf("instance = %+v", node)
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
	class, err := classes.Patch(ctx, preset.Class.ID, entities.FlowNodeClassPatch{ScheduledAt: &at}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if class.Duration != "" || class.ScheduledAt != at {
		t.Fatalf("class datetime switch = %+v", class)
	}
	class, err = classes.Patch(ctx, class.ID, entities.FlowNodeClassPatch{Duration: &duration}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if class.Duration != duration || class.ScheduledAt != "" {
		t.Fatalf("class duration switch = %+v", class)
	}
}
