package services_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

// testAgentID is the agent board() files for the tests that play a card: aiSettings names it,
// and the service refuses a card naming anything else.
const testAgentID = "id-1"

func aiSettings() entities.TaskSettings {
	return entities.TaskSettings{Agent: testAgentID, Effort: "high", Permission: "bypassPermissions", Folder: "/"}
}

func board(t *testing.T) (*services.Boards, *services.FlowNodes, *entities.Board) {
	t.Helper()
	boards, flowNodes, agents, _ := newCore()
	ctx := context.Background()
	// First, so the id is the one aiSettings names: boards are minted after it.
	if _, err := agents.Create(ctx, services.NewAgentRequest{Name: "Reviewer", Platform: "claude", Model: "opus"}, "alex"); err != nil {
		t.Fatal(err)
	}
	made, err := boards.Create(ctx, services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return boards, flowNodes, made
}

// A card that names an agent is an agent's, and one that names nothing is a person's — the reading
// a document saying no type got, kept for every client that sends none.
func TestCreateReadsTheTypeOffTheSettings(t *testing.T) {
	_, flowNodes, b := board(t)
	made, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{Title: "Play it", Settings: aiSettings()},
		{Title: "Do it"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].Type != entities.FlowNodeAI {
		t.Errorf("a card with an agent is %q, want ai", made[0].Type)
	}
	if made[1].Type != entities.FlowNodeHuman {
		t.Errorf("a card with nothing is %q, want human", made[1].Type)
	}
}

// A card naming an agent this store does not hold is refused at the write, where the message can
// name the card, rather than at its first play. That is what narrows the writes while the reads
// stay forgiving: a board written before managed agents still opens, and its settings cannot be
// written back until they name an agent.
func TestCreateRefusesACardNamingNoAgentOfThisStore(t *testing.T) {
	_, flowNodes, b := board(t)
	_, err := flowNodes.Create(context.Background(), b.ID, []services.NewFlowNodeRequest{
		{Title: "Play it", Settings: entities.TaskSettings{
			Agent: "ghost", Effort: "high", Permission: "bypassPermissions", Folder: "/",
		}},
	}, "alex")
	if !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("create = %v, want the agent refused as not found", err)
	}
}

// Several cards in one call is one gesture — a paste — and one change to the board, not six.
func TestCreateFilesABlockInOneCall(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "One"}, {Title: "Two"}, {Title: "Three"},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(made) != 3 {
		t.Fatalf("created %d cards, want 3", len(made))
	}
	all, err := flowNodes.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Errorf("the board holds %d cards, want 3", len(all))
	}
}

// The whole point of a patch: two writers, two fields, both kept.
func TestPatchesToTwoFieldsOfOneCardBothLand(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Write it", Settings: aiSettings(), Body: "Go on."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	title, status := "Write it up", entities.StatusDone
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Title: &title}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	// The run holds a revision from before the rename and writes a different field: it lands.
	after, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Status: &status}, nil, "run-1")
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != title || after.Status != status {
		t.Errorf("card = %q at %q, want both writes kept", after.Title, after.Status)
	}
}

func TestPatchRefusesAStaleRevisionOnTheSameField(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Write it"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	stale := made[0].Revision
	first, second := "Mine", "Yours"
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Title: &first}, &stale, "alex"); err != nil {
		t.Fatal(err)
	}
	_, err = flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Title: &second}, &stale, "someone")
	if !errors.Is(err, entities.ErrConflict) {
		t.Errorf("the second write from the same revision = %v, want ErrConflict", err)
	}
}

// Retyping a card to Shutdown takes its chain off in the same write: a Shutdown ends the board.
func TestChangingTheTypeRereadsTheChain(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go."},
		{Title: "Second", Settings: aiSettings(), Body: "Then."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex"); err != nil {
		t.Fatal(err)
	}
	shutdown := entities.FlowNodeShutdown
	after, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &shutdown}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if after.Next != "" {
		t.Errorf("a Shutdown still chains to %q", after.Next)
	}
}

// A **task** appears and disappears with the type. An AI card and a Human card are work somebody
// does and carry one; a Shutdown and a Scheduler describe no work and carry none — so retyping a
// card to one of those drops what only a task can hold, and retyping it back gives it a fresh,
// empty task rather than the one it had.
func TestOnlyACardThatIsWorkCarriesATask(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Write it", Settings: aiSettings(), Body: "Go."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].Task == nil || made[0].Task.Body != "Go." {
		t.Fatalf("an AI card came back as %+v, want a task carrying its description", made[0].Task)
	}
	// The two kinds of work are one task between them: retyping an AI card Human keeps the
	// description and the folder, which are the same work whoever does it.
	human := entities.FlowNodeHuman
	byHand, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if byHand.Task == nil || byHand.Task.Body != "Go." {
		t.Errorf("a Human card came back as %+v, want the same task", byHand.Task)
	}
	shutdown := entities.FlowNodeShutdown
	off, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &shutdown}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if off.Task != nil {
		t.Errorf("a Shutdown carries %+v, want no task at all", off.Task)
	}
	back, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if back.Task == nil || back.Task.Body != "" {
		t.Errorf("a card typed back to Human carries %+v, want a task with nothing written on it", back.Task)
	}
}

// A description written onto a card that is no task is dropped rather than refused, and a patch
// that asked for nothing else is refused rather than served as a revision bump.
func TestACardThatIsNoTaskIsNotWrittenWithATasksFields(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "And off", Type: "shutdown", Body: "Nothing sends this."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].Task != nil {
		t.Errorf("a Shutdown was created carrying %+v, want no task", made[0].Task)
	}
	body := "Still nothing sends it."
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Body: &body}, nil, "alex"); err == nil {
		t.Error("a description was written onto a Shutdown")
	}
	// Beside something the card *does* have, the description is simply left behind.
	title := "And off, then"
	renamed, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Title: &title, Body: &body}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Title != title || renamed.Task != nil {
		t.Errorf("the card came back as %q / %+v, want the rename kept and the description dropped",
			renamed.Title, renamed.Task)
	}
}

// Drawing a chain names the successor and leaves the transition mode where it was: the mode says
// what becomes of this card's own conversation, which is the panel's question and not the line's. A
// card chained while saying `end` used to come back saying `continue`, so the flowNode after it ran
// in a fork of a chat the user had asked to end.
func TestChainLeavesTheTransitionModeAlone(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go."},
		{Title: "Second", Settings: aiSettings(), Body: "Then."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// The default, which is what a card says by saying nothing: chaining it must not rewrite the
	// mode into the one that carries the chat on.
	chained, err := flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if chained.Next != made[1].ID {
		t.Fatalf("chained to %q, want %q", chained.Next, made[1].ID)
	}
	if chained.Task.Transition.Mode != entities.TransitionEnd {
		t.Errorf("mode after chaining = %q, want it left at %q",
			chained.Task.Transition.Mode, entities.TransitionEnd)
	}
	// The explicit choice, which is what the panel writes when End conversation is picked before
	// the chain is drawn: it reads as `end` too, and the line is not its to rewrite either.
	broken := ""
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Next: &broken}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, "", "alex"); err != nil {
		t.Fatal(err)
	}
	chained, err = flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if chained.Task.Transition.Mode != entities.TransitionEnd {
		t.Errorf("mode after chaining an explicit end = %q, want %q",
			chained.Task.Transition.Mode, entities.TransitionEnd)
	}
	// And the other way round: a card saying `continue` keeps saying it, chained or unchained.
	continued := entities.Transition{Mode: entities.TransitionContinue}
	if _, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Next: &made[1].ID, Transition: &continued}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	unchained, err := flowNodes.Chain(ctx, made[0].ID, "", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if unchained.Task.Transition.Mode != entities.TransitionContinue {
		t.Errorf("mode after taking the chain off = %q, want %q",
			unchained.Task.Transition.Mode, entities.TransitionContinue)
	}
}

func TestChainRefusesACardOfAnotherBoard(t *testing.T) {
	boards, flowNodes, b := board(t)
	ctx := context.Background()
	other, err := boards.Create(ctx, services.NewBoardRequest{Name: "Other"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	mine, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Mine"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := flowNodes.Create(ctx, other.ID, []services.NewFlowNodeRequest{{Title: "Theirs"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, mine[0].ID, theirs[0].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("chaining across boards = %v, want ErrInvalid", err)
	}
	if _, err := flowNodes.Chain(ctx, mine[0].ID, mine[0].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("chaining a card to itself = %v, want ErrInvalid", err)
	}
}

// ── a play ────────────────────────────────────────────────────────────────────

func TestStartPlayTakesTheCardForTheRun(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Write it", Settings: aiSettings(), Body: "Do the thing.\n\nCarefully."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	played, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1")
	if err != nil {
		t.Fatal(err)
	}
	// The description stays where it is: a play sends it, and writes nothing about it onto the card.
	if played.Task.Body != "Do the thing.\n\nCarefully." {
		t.Errorf("the box holds %q, want the description left alone", played.Task.Body)
	}
	if played.Status != entities.StatusRunning || played.RunID != "run-1" {
		t.Errorf("the card stands at %q held by %q", played.Status, played.RunID)
	}
}

func TestEndPlayMarksTheCardAndHandsItBack(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Write it", Settings: aiSettings(), Body: "Go."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	done, err := flowNodes.EndPlay(ctx, made[0].ID, "run-1", entities.StatusDone, "run-1")
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != entities.StatusDone || done.RunID != "" {
		t.Errorf("the card stands at %q held by %q", done.Status, done.RunID)
	}
	if done.Task.Body != "Go." {
		t.Errorf("the box holds %q, want the description kept — what the turn said is in the chat", done.Task.Body)
	}
	// Played again, as it stands: the description was never taken away, so nothing has to be
	// written back before the next play.
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Status: statusPtr(entities.StatusReady)}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	again, err := flowNodes.StartPlay(ctx, made[0].ID, "run-2", "run-2")
	if err != nil {
		t.Fatalf("the card could not be played again as it stands: %v", err)
	}
	if again.Task.Body != "Go." {
		t.Errorf("the box holds %q, want the description still there for the second play", again.Task.Body)
	}
}

// **A flow node is played by one run.** Twenty runs reach for one card at once and exactly one gets
// it; the rest are told it is held rather than playing a card somebody else is playing.
func TestOnlyOneRunEverTakesACard(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Contested", Settings: aiSettings(), Body: "Go."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		won   int
		other []error
	)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := flowNodes.StartPlay(ctx, made[0].ID, "run-"+string(rune('a'+n)), "runner")
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				won++
			case errors.Is(err, entities.ErrFlowNodeHeld), errors.Is(err, entities.ErrInvalid),
				errors.Is(err, entities.ErrFlowNodeEmptyPrompt):
				// Refused, and **which** refusal depends on where the loser was when the winner
				// got there: the card is held, or it already stands at `running`. Both are the card
				// being refused, and the spread is the point — the checks before the claim are a
				// courtesy to the caller, and the claim itself is the guarantee.
			default:
				other = append(other, err)
			}
		}(i)
	}
	wg.Wait()
	if won != 1 {
		t.Errorf("%d runs took the card, want exactly 1", won)
	}
	if len(other) > 0 {
		t.Errorf("unexpected failures: %v", other)
	}
}

func TestStartPlayRefusesACardThatCannotBePlayed(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "A person's", Body: "Do it yourself."},
		{Title: "Half-configured", Type: "ai", Settings: entities.TaskSettings{Model: "opus"}, Body: "Go."},
		{Title: "", Settings: aiSettings()},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	for _, card := range made {
		if _, err := flowNodes.StartPlay(ctx, card.ID, "run-1", "run-1"); err == nil {
			t.Errorf("%q was played", card.Title)
		}
	}
}

// A task is valid with a title, a description or a success criterion: an AI card saying any one
// of the three is played, and one saying none of them is refused like a card with no description
// used to be.
func TestStartPlayTakesACardSayingAnyOneOfTheThree(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Titled only", Settings: aiSettings()},
		{Title: "", Body: "Described only.", Settings: aiSettings()},
		{Title: "", Settings: aiSettings(), Criteria: []entities.SuccessCriterion{{Text: "It holds"}}},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[2].Task.Criteria[0].ID == "" {
		t.Error("a criterion came back with no id")
	}
	for i, card := range made {
		if _, err := flowNodes.StartPlay(ctx, card.ID, "run-1", "run-1"); err != nil {
			t.Errorf("card %d was not played: %v", i, err)
		}
		if _, err := flowNodes.EndPlay(ctx, card.ID, "run-1", entities.StatusDone, "run-1"); err != nil {
			t.Fatal(err)
		}
	}
}

// The criteria and the complexity are a task's: created on a Shutdown they are dropped, patched
// onto one they land, and taken off again on purpose.
func TestCriteriaAndComplexityAreATasksOwn(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	five := 5
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Measured", Body: "Go.", Settings: aiSettings(),
			Criteria:   []entities.SuccessCriterion{{ID: "  ", Text: " It holds "}, {Text: "  "}},
			Complexity: &five},
		{Title: "And off", Type: "shutdown",
			Criteria: []entities.SuccessCriterion{{Text: "Nothing measures this."}}, Complexity: &five},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	task := made[0].Task
	if task == nil {
		t.Fatalf("an AI card came back with no task")
	}
	// Empty texts dropped, the missing id minted, the complexity kept.
	if len(task.Criteria) != 1 || task.Criteria[0].Text != "It holds" || task.Criteria[0].ID == "" {
		t.Errorf("criteria = %+v, want one measured line with a minted id", task.Criteria)
	}
	if task.Complexity == nil || *task.Complexity != 5 {
		t.Errorf("complexity = %v, want 5", task.Complexity)
	}
	if made[1].Task != nil {
		t.Errorf("a Shutdown was created carrying %+v, want no task", made[1].Task)
	}

	// Patched: replaced whole, and taken off on purpose. A pasted id is honoured, so a chain
	// of edits keeps naming the same criterion.
	pasted := "11111111-1111-4111-8111-111111111111"
	replacement := []entities.SuccessCriterion{{ID: pasted, Text: "It holds, still"}}
	after, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Criteria: &replacement}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Task.Criteria) != 1 || after.Task.Criteria[0].Text != "It holds, still" ||
		after.Task.Criteria[0].ID != pasted {
		t.Errorf("criteria after patch = %+v, want the replacement keeping its id", after.Task.Criteria)
	}
	cleared, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{ClearComplexity: true}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if cleared.Task.Complexity != nil {
		t.Errorf("complexity after clearing = %v, want none", cleared.Task.Complexity)
	}
	// Anything outside the suite is no complexity at all.
	seven := 7
	off, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Complexity: &seven}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if off.Task.Complexity != nil {
		t.Errorf("complexity after an outside value = %v, want none", off.Task.Complexity)
	}
}

// `blocked` is the user's own word for a card waiting on something off the board, and the whole of
// what it does here is stop the card being played: the claim takes a ready card and no other, so a
// blocked one is refused by the rule that was already there, and saying it is ready again is what
// offers it its turn back.
func TestStartPlayRefusesABlockedCard(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Waiting on somebody else", Settings: aiSettings(), Body: "Go."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	held, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Status: statusPtr(entities.StatusBlocked)}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if held.Status != entities.StatusBlocked {
		t.Fatalf("the card stands at %q, want %q", held.Status, entities.StatusBlocked)
	}
	if held.Status.Held() {
		t.Error("a blocked card is held, but nothing is holding it — that is why it waits")
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err == nil {
		t.Fatal("a blocked card was played")
	}
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Status: statusPtr(entities.StatusReady)}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
		t.Errorf("a card said to be ready again was not played: %v", err)
	}
}

func TestSettleRunFreesTheCardsARestartLeftHeld(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Interrupted", Settings: aiSettings(), Body: "Go."}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	settled, err := flowNodes.SettleRun(ctx, "run-1", "startup")
	if err != nil {
		t.Fatal(err)
	}
	if settled != 1 {
		t.Errorf("settled %d cards, want 1", settled)
	}
	flowNode, err := flowNodes.Find(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if flowNode.Status != entities.StatusInterrupted || flowNode.RunID != "" {
		t.Errorf("the card stands at %q held by %q", flowNode.Status, flowNode.RunID)
	}
}

// The chain is read off the board at the moment it is followed, not off a copy the run has been
// carrying: the card may have been re-chained while the turn ran.
func TestNextFollowsTheBoardAsItStandsNow(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go."},
		{Title: "Second", Settings: aiSettings(), Body: "Then."},
		{Title: "Third", Settings: aiSettings(), Body: "Or this."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, made[2].ID, "alex"); err != nil {
		t.Fatal(err)
	}
	next, err := flowNodes.Next(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.Title != "Third" {
		t.Errorf("next = %v, want Third", next)
	}
	// The card it chained to is deleted: the chain ends rather than pointing at nothing.
	if err := flowNodes.Delete(ctx, []string{made[2].ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	next, err = flowNodes.Next(ctx, made[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if next != nil {
		t.Errorf("next = %v, want the chain to end", next)
	}
}

// The rule EndPlay turns on: a play marks the card and takes nothing away. Whatever the ending —
// answered, stopped part-way, failed — the card still asks what it was asking, so it can be played
// again as it stands.
func TestAPlayLeavesTheDescriptionWhereItIs(t *testing.T) {
	for _, c := range []struct {
		name   string
		status entities.FlowNodeStatus
	}{
		{"answered", entities.StatusDone},
		{"interrupted with work to show", entities.StatusInterrupted},
		{"failed", entities.StatusError},
		{"stopped before it said a word", entities.StatusInterrupted},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, flowNodes, b := board(t)
			ctx := context.Background()
			made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
				{Title: "Asked", Settings: aiSettings(), Body: "Go on."},
			}, "alex")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
				t.Fatal(err)
			}
			ended, err := flowNodes.EndPlay(ctx, made[0].ID, "run-1", c.status, "run-1")
			if err != nil {
				t.Fatal(err)
			}
			if ended.Task.Body != "Go on." {
				t.Errorf("the box holds %q, want the description kept for another play", ended.Task.Body)
			}
			if ended.Status != c.status {
				t.Errorf("the card stands at %q, want %q", ended.Status, c.status)
			}
		})
	}
}

func statusPtr(s entities.FlowNodeStatus) *entities.FlowNodeStatus { return &s }

// **Once per play, not once per attempt.** A turn that met a usage limit is sent the same card
// again by the run that still holds it: the card is taken again without complaint.
func TestARunComingBackToItsOwnCardIsTheSamePlay(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Rate limited", Settings: aiSettings(), Body: "Go on."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	// The limit is met and waited out: the card is held, then sent again by the same run.
	held := entities.StatusWaitingRefresh
	if _, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Status: &held}, nil, "run-1"); err != nil {
		t.Fatal(err)
	}
	again, err := flowNodes.StartPlay(ctx, made[0].ID, "run-1", "run-1")
	if err != nil {
		t.Fatalf("the run could not come back to its own card: %v", err)
	}
	if again.Status != entities.StatusRunning || again.RunID != "run-1" {
		t.Errorf("the card stands at %q held by %q", again.Status, again.RunID)
	}
	if again.Task.Body != "Go on." {
		t.Errorf("the box holds %q, want the description still there to be sent again", again.Task.Body)
	}
	// Another run is still refused, which is the half of the rule the first half must not have cost.
	if _, err := flowNodes.StartPlay(ctx, made[0].ID, "run-2", "run-2"); err == nil {
		t.Error("a second run took a card another run holds")
	}
}

// The editor mints a card's id in the browser, so that the card is drawn the instant it is typed
// and so that pasted cards keep the chains among them. The store honours it — and refuses one it
// could not hold, rather than quietly substituting another that nothing on screen names.
func TestACardKeepsTheIdItsMakerGaveIt(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	mine := "3f1a6d20-0000-4000-8000-000000000001"
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{ID: mine, Title: "Typed here"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made[0].ID != mine {
		t.Errorf("the card was given %q, want the id its maker chose", made[0].ID)
	}
	if _, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{ID: "not-a-uuid", Title: "Bad id"}}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("a malformed id = %v, want ErrInvalid", err)
	}
}

// A Gateway is filed with the branches it lists, in the order it lists them — and with no single
// chain, which is not asked of it. A list said on a card that is no Gateway is dropped, one card
// following those.
func TestCreateFilesAGatewayWithItsBranches(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Branch one", Settings: aiSettings(), Body: "Go."},
		{Title: "Branch two", Settings: aiSettings(), Body: "Go."},
		{
			Title: "Join", Type: string(entities.FlowNodeGateway),
			Next: "the-single-way", Nexts: []string{"", "  "},
		},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// Branches are named by id, so they are said once the branches exist to be named.
	patched, err := flowNodes.Patch(ctx, made[2].ID,
		entities.FlowNodePatch{Nexts: &[]string{made[0].ID, " ", made[0].ID, made[1].ID}}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(patched.Nexts) != 2 || patched.Nexts[0] != made[0].ID || patched.Nexts[1] != made[1].ID {
		t.Errorf("branches = %q, want the two named once each, in order", patched.Nexts)
	}
	if patched.Next != "" {
		t.Errorf("a Gateway still chains the single way to %q", patched.Next)
	}
	// And the list said on a card that is no Gateway is dropped.
	single, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Nexts: &[]string{made[1].ID}, Title: strptr("Branch one")}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(single.Nexts) != 0 {
		t.Errorf("an AI card holds branches %q, want none", single.Nexts)
	}
}

// Patching the branches says them whole: what the card holds afterwards is what was sent, not the
// branches it held with one added.
func TestPatchReplacesAGatewaysBranches(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Branch one", Settings: aiSettings(), Body: "Go."},
		{Title: "Branch two", Settings: aiSettings(), Body: "Go."},
		{Title: "Branch three", Settings: aiSettings(), Body: "Go."},
		{Title: "Join", Type: string(entities.FlowNodeGateway)},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	held, err := flowNodes.Patch(ctx, made[3].ID,
		entities.FlowNodePatch{Nexts: &[]string{made[0].ID, made[1].ID, made[2].ID}}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Nexts) != 3 {
		t.Fatalf("branches = %q, want the three said", held.Nexts)
	}
	patched, err := flowNodes.Patch(ctx, made[3].ID,
		entities.FlowNodePatch{Nexts: &[]string{made[2].ID}}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(patched.Nexts) != 1 || patched.Nexts[0] != made[2].ID {
		t.Errorf("branches = %q, want only the one said", patched.Nexts)
	}
}

// Each branch is a chain, so each names a card of this board: one naming another board refuses the
// whole patch.
func TestPatchRefusesABranchOfAnotherBoard(t *testing.T) {
	boards, flowNodes, b := board(t)
	ctx := context.Background()
	other, err := boards.Create(ctx, services.NewBoardRequest{Name: "Other"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Join", Type: string(entities.FlowNodeGateway)},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	away, err := flowNodes.Create(ctx, other.ID, []services.NewFlowNodeRequest{
		{Title: "Elsewhere", Settings: aiSettings(), Body: "Go."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Nexts: &[]string{away[0].ID}}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("a branch of another board = %v, want ErrInvalid", err)
	}
}

// Branches named on a card that is no Gateway are dropped like a task's fields on a card that is
// none — and where that is all the patch asked for, the patch changes nothing the card has.
func TestBranchesOnACardThatIsNoGatewayAreDropped(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Play it", Settings: aiSettings(), Body: "Go."},
		{Title: "Then", Settings: aiSettings(), Body: "Go."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Nexts: &[]string{made[1].ID}}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("branches alone on an AI card = %v, want ErrInvalid", err)
	}
}

// The type changed and the branches did not: retyping to a Gateway clears the single chain, and
// retyping away from one clears the branches — each kind holds what it is asked for and nothing
// else.
func TestRetypingMovesTheChainBetweenTheSingleCardAndTheBranches(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go."},
		{Title: "Second", Settings: aiSettings(), Body: "Then."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex"); err != nil {
		t.Fatal(err)
	}
	gateway := entities.FlowNodeGateway
	became, err := flowNodes.Patch(ctx, made[0].ID,
		entities.FlowNodePatch{Type: &gateway, Nexts: &[]string{made[1].ID}}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if became.Next != "" {
		t.Errorf("a Gateway still chains the single way to %q", became.Next)
	}
	if len(became.Nexts) != 1 || became.Nexts[0] != made[1].ID {
		t.Errorf("branches = %q, want the one said", became.Nexts)
	}
	human := entities.FlowNodeHuman
	left, err := flowNodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(left.Nexts) != 0 {
		t.Errorf("a Human card still holds branches %q", left.Nexts)
	}
}

// The link call adds a branch to a Gateway — a chain drawn on the board is one more branch, not a
// branch redrawn — names the same one twice to no further effect, and takes them all off with an
// empty target.
func TestChainAddsABranchToAGateway(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "Branch one", Settings: aiSettings(), Body: "Go."},
		{Title: "Branch two", Settings: aiSettings(), Body: "Go."},
		{Title: "Join", Type: string(entities.FlowNodeGateway)},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	join, first, second := made[2].ID, made[0].ID, made[1].ID
	once, err := flowNodes.Chain(ctx, join, first, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(once.Nexts) != 1 || once.Nexts[0] != first {
		t.Fatalf("branches = %q, want the one drawn", once.Nexts)
	}
	if _, err := flowNodes.Chain(ctx, join, first, "alex"); err != nil {
		t.Fatal(err)
	}
	twice, err := flowNodes.Chain(ctx, join, second, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(twice.Nexts) != 2 || twice.Nexts[0] != first || twice.Nexts[1] != second {
		t.Errorf("branches = %q, want both drawn, in order, the repeat held once", twice.Nexts)
	}
	if _, err := flowNodes.Chain(ctx, join, join, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("a gateway chained to itself = %v, want ErrInvalid", err)
	}
	cleared, err := flowNodes.Chain(ctx, join, "", "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(cleared.Nexts) != 0 {
		t.Errorf("branches = %q, want them all taken off", cleared.Nexts)
	}
}

func strptr(s string) *string { return &s }

func TestSchedulerDurationSwitchesModes(t *testing.T) {
	_, nodes, board := board(t)
	ctx := context.Background()
	made, err := nodes.Create(ctx, board.ID, []services.NewFlowNodeRequest{{
		Title: "Wait", Type: "scheduler", Duration: "15m",
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := made[0].Runnable(); err != nil {
		t.Fatal(err)
	}
	at := "2026-10-16T22:00"
	node, err := nodes.Patch(ctx, made[0].ID, entities.FlowNodePatch{ScheduledAt: &at}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.ScheduledAt != at || node.Duration != "" {
		t.Fatalf("datetime switch: %+v", node)
	}
	duration := "1h30m"
	node, err = nodes.Patch(ctx, node.ID, entities.FlowNodePatch{Duration: &duration}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if node.Duration != duration || node.ScheduledAt != "" {
		t.Fatalf("duration switch: %+v", node)
	}
	duration = "-1h"
	if _, err := nodes.Patch(ctx, node.ID, entities.FlowNodePatch{Duration: &duration}, nil, "alex"); err == nil {
		t.Fatal("negative duration accepted")
	}
	duration = "1h"
	if _, err := nodes.Patch(ctx, node.ID, entities.FlowNodePatch{ScheduledAt: &at, Duration: &duration}, nil, "alex"); err == nil {
		t.Fatal("both modes accepted")
	}
}

// Archiving is a boolean flip: the card stays stored, hidden everywhere with its links,
// never playable while hidden, and back when unarchived.
func TestArchivingHidesTheCardWithoutDeletingIt(t *testing.T) {
	_, flowNodes, b := board(t)
	ctx := context.Background()
	made, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{
		{Title: "First", Settings: aiSettings(), Body: "Go."},
		{Title: "Second", Settings: aiSettings(), Body: "Then."},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := flowNodes.Chain(ctx, made[0].ID, made[1].ID, "alex"); err != nil {
		t.Fatal(err)
	}
	yes := true
	archived, err := flowNodes.Patch(ctx, made[1].ID, entities.FlowNodePatch{Archived: &yes}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !archived.Archived {
		t.Error("archived = false, want the boolean flip kept")
	}
	// The card is still there to be read and unarchived.
	if _, err := flowNodes.Find(ctx, made[1].ID); err != nil {
		t.Fatalf("archived card cannot be read: %v", err)
	}
	// Its link ends the chain instead of surfacing a hidden card.
	if next, err := flowNodes.Next(ctx, made[0].ID); err != nil || next != nil {
		t.Errorf("Next past an archived card = %+v, %v; want nil, nil", next, err)
	}
	// An archived card is never played.
	if _, err := flowNodes.StartPlay(ctx, made[1].ID, "run-1", "run-1"); err == nil {
		t.Error("an archived card was played")
	}
	no := false
	if live, err := flowNodes.Patch(ctx, made[1].ID, entities.FlowNodePatch{Archived: &no}, nil, "alex"); err != nil {
		t.Fatal(err)
	} else if live.Archived {
		t.Error("unarchived card still stands archived")
	}
}
