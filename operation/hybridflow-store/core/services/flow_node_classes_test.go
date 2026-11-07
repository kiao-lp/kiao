package services_test

import (
	"context"
	"errors"
	"testing"

	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
)

func classCore(t *testing.T) (*services.Boards, *services.FlowNodes, *services.FlowNodeClasses, *entities.Board, *memory.Store) {
	t.Helper()
	boards, flowNodes, _, store := newCore()
	classes := services.NewFlowNodeClasses(store, store, store, store, store, fixedClock{}, &countingIDs{})
	made, err := boards.Create(context.Background(), services.NewBoardRequest{Name: "Major"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	return boards, flowNodes, classes, made, store
}

// A class is filed with its first version beneath it: a class always has at least one version,
// because a class with nothing under it is one nothing could be instantiated from.
func TestCreateClassFilesTheFirstVersion(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	made, err := classes.Create(context.Background(), b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Permission: "manualLive",
		Body: "Read the diff.", Criteria: []entities.SuccessCriterion{{Text: "No nits left"}},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Class.BoardID != b.ID || made.Class.Title != "Review" || made.Class.Type != entities.FlowNodeAI {
		t.Errorf("class = %+v, want the filed card", made.Class)
	}
	if made.Class.Permission != "manualLive" {
		t.Errorf("permission = %q, want manualLive", made.Class.Permission)
	}
	if len(made.Versions) != 1 || made.Versions[0].Number != 1 {
		t.Fatalf("versions = %+v, want one first version", made.Versions)
	}
	first := made.Versions[0]
	if first.Body != "Read the diff." || first.Status != entities.ClassVersionDraft {
		t.Errorf("first = %+v, want the words as a draft", first)
	}
	if len(first.Criteria) != 1 || first.Criteria[0].ID == "" {
		t.Errorf("criteria = %+v, want one minted pair", first.Criteria)
	}
}

// What a class is not asked is dropped at the write: a Human class keeps no permission, no
// runner and no transition, whatever the request said.
func TestCreateClassDropsTheAIAnswersOffAHumanClass(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	made, err := classes.Create(context.Background(), b.ID, services.NewClassRequest{
		Title: "Do it", Type: "human", Permission: "manualLive", Runner: "somewhere",
		Transition: entities.Transition{Mode: entities.TransitionContinue, Compact: true},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Class.Permission != "" || made.Class.Runner != "" {
		t.Errorf("class = %+v, want no AI answers", made.Class)
	}
	if made.Class.Transition.Mode != entities.TransitionEnd || made.Class.Transition.Compact {
		t.Errorf("transition = %+v, want the default", made.Class.Transition)
	}
}

// A chain names a class of this board. A simple flow node is refused by the lookup, which reads
// classes and nothing else — the two kinds chain among themselves and never across.
func TestPatchClassRefusesAChainOntoAFlowNode(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Card"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	next := cards[0].ID
	if _, err := classes.Patch(ctx, made.Class.ID, entities.FlowNodeClassPatch{Next: &next}, nil, "alex"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("patch = %v, want the flow node refused as not a class", err)
	}
}

// Retyping a class away from AI takes its AI answers off in the same write rather than in the
// next one: a Human class saying how its instances' turns answer is a card saying two things.
func TestPatchClassRetypeClearsTheAIAnswers(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Permission: "manualLive",
		Transition: entities.Transition{Mode: entities.TransitionContinue, Compact: true},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	human := entities.FlowNodeHuman
	patched, err := classes.Patch(ctx, made.Class.ID, entities.FlowNodeClassPatch{Type: &human}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Permission != "" || patched.Transition.Compact || patched.Transition.Mode != entities.TransitionEnd {
		t.Errorf("patched = %+v, want the AI answers gone", patched)
	}
}

// A chain drawn out of a Shutdown is a chain nothing could follow: retyping to one takes it off.
func TestPatchClassToShutdownBreaksTheChain(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "First"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Second"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, first.Class.ID, second.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	shutdown := entities.FlowNodeShutdown
	patched, err := classes.Patch(ctx, first.Class.ID, entities.FlowNodeClassPatch{Type: &shutdown}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if patched.Next != "" {
		t.Errorf("next = %q, want the chain broken", patched.Next)
	}
}

// Versions are successive: each new one is one more than the succession holds, and a draft — a
// new version is written before it is published. `From` copies the words it starts from.
func TestCreateVersionNumbersTheSuccession(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read the diff.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.CreateVersion(ctx, made.Class.ID, services.NewVersionRequest{From: made.Versions[0].ID}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if second.Number != 2 || second.Status != entities.ClassVersionDraft || second.Body != "Read the diff." {
		t.Errorf("second = %+v, want a draft copy numbered 2", second)
	}
	third, err := classes.CreateVersion(ctx, made.Class.ID, services.NewVersionRequest{Body: "Fresh words."}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if third.Number != 3 || third.Body != "Fresh words." {
		t.Errorf("third = %+v, want a blank-start draft numbered 3", third)
	}
}

// A draft says what is still being written: it may be changed, and it may be published —
// one way, since a published version is never drafted again.
func TestPatchVersionEditsADraftAndPublishesIt(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	body := "Read the diff."
	edited, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Body: &body}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Body != body || edited.Status != entities.ClassVersionDraft {
		t.Errorf("edited = %+v, want the words changed, still a draft", edited)
	}
	published := entities.ClassVersionPublished
	frozen, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Status: &published}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !frozen.Status.Published() {
		t.Errorf("frozen = %+v, want published", frozen)
	}
}

// A published version is what stays said: whatever a client sends, it is refused.
func TestPatchVersionRefusesAPublishedVersion(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read the diff.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	body := "Other words."
	if _, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Body: &body}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want a published version refused", err)
	}
}

// A draft somebody changed their mind about goes; a published one is kept for statistics,
// and a version that has gone is not found.
func TestDeleteVersionRemovesADraft(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read the diff.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	draft, err := classes.CreateVersion(ctx, made.Class.ID, services.NewVersionRequest{From: made.Versions[0].ID}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := classes.DeleteVersion(ctx, draft.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := classes.Versions(ctx, made.Class.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 1 || held[0].ID != made.Versions[0].ID {
		t.Errorf("versions = %+v, want only the published one left", held)
	}
	if err := classes.DeleteVersion(ctx, made.Versions[0].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("delete = %v, want a published version refused", err)
	}
	if err := classes.DeleteVersion(ctx, draft.ID, "alex"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("delete = %v, want a gone version not found", err)
	}
}

// Instantiating a class makes a flow node from it and from each successor, with the links
// recreated reproducing those between the classes — each from its latest published version,
// and each naming the version it was made from.
func TestInstantiateMakesTheChainFromTheLatestPublished(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "First", Type: "ai", Permission: "manualLive", Body: "v1 words.",
		Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// A newer draft changes nothing about what is instantiated: the latest version that is
	// *not* a draft is the one used.
	if _, err := classes.CreateVersion(ctx, first.Class.ID, services.NewVersionRequest{Body: "draft words."}, "alex"); err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Second", Body: "Second words.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, first.Class.ID, second.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	made, err := classes.Instantiate(ctx, first.Class.ID, b.ID, &entities.Spot{X: 10, Y: 20}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(made) != 2 {
		t.Fatalf("instantiated %d flow nodes, want 2", len(made))
	}
	if made[0].Title != "First" || made[0].Task == nil || made[0].Task.Body != "v1 words." {
		t.Errorf("head = %+v, want the first class's published words", made[0])
	}
	if made[0].Task.Settings.Permission != "manualLive" {
		t.Errorf("permission = %q, want the class's", made[0].Task.Settings.Permission)
	}
	if made[0].Task.Settings.Agent != "" || made[0].Task.Settings.Effort != "" || made[0].Task.Settings.Folder != "" {
		t.Errorf("settings = %+v, want the instance's answers empty", made[0].Task.Settings)
	}
	if made[0].Spot == nil || made[0].Spot.X != 10 || made[0].Spot.Y != 20 {
		t.Errorf("spot = %+v, want the head placed", made[0].Spot)
	}
	if made[1].Spot != nil {
		t.Errorf("second spot = %+v, want the rest unplaced", made[1].Spot)
	}
	if made[0].Next != made[1].ID {
		t.Errorf("head next = %q, want the second instance %q", made[0].Next, made[1].ID)
	}
	if made[0].ClassVersionID != first.Versions[0].ID {
		t.Errorf("head version = %q, want %q", made[0].ClassVersionID, first.Versions[0].ID)
	}
	if made[0].ClassRef == nil || made[0].ClassRef.ClassTitle != "First" || made[0].ClassRef.VersionNumber != 1 {
		t.Errorf("head ref = %+v, want the class and version named", made[0].ClassRef)
	}
	// And they are on the board, not just in the answer.
	onBoard, err := flowNodes.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(onBoard) != 2 {
		t.Errorf("board holds %d cards, want 2", len(onBoard))
	}
}

// A class with no published version refuses the whole call: a partial instantiation would be a
// chain with a card missing from its middle.
func TestInstantiateRefusesAClassWithNothingPublished(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Drafty"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Instantiate(ctx, made.Class.ID, b.ID, nil, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("instantiate = %v, want nothing published refused", err)
	}
}

// Converting a task files a class from it: its title, kind and answers become the class's, and
// its description and success criteria become the first version's — published, because they are
// already what instances should be asked. The flow node itself is left alone.
func TestConvertNodeFilesAClassFromATask(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{
		Title: "Review", Type: "ai", Body: "Read the diff.",
		Criteria: []entities.SuccessCriterion{{Text: "No nits left"}},
		Settings: entities.TaskSettings{Permission: "manualLive", Folder: "/"},
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := classes.ConvertNode(ctx, cards[0].ID, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Class.Title != "Review" || made.Class.Type != entities.FlowNodeAI || made.Class.BoardID != b.ID {
		t.Errorf("class = %+v, want the card's title, kind and board", made.Class)
	}
	if made.Class.Permission != "manualLive" {
		t.Errorf("permission = %q, want the card's", made.Class.Permission)
	}
	if len(made.Versions) != 1 {
		t.Fatalf("versions = %+v, want one", made.Versions)
	}
	first := made.Versions[0]
	if first.Body != "Read the diff." || !first.Status.Published() || len(first.Criteria) != 1 {
		t.Errorf("first = %+v, want the words published", first)
	}
	held, err := flowNodes.Find(ctx, cards[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if held.ClassVersionID != "" || held.Title != "Review" {
		t.Errorf("card = %+v, want the flow node left alone", held)
	}
}

// Only a task converts: a Shutdown describes no work, so there are no words for a version.
func TestConvertNodeRefusesACardThatIsNoTask(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Off", Type: "shutdown"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.ConvertNode(ctx, cards[0].ID, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("convert = %v, want a Shutdown refused", err)
	}
}

// A flow node names the version it was made from — or nothing, for one made by hand — and the
// link breaks with the empty string, changing nothing else about the card.
func TestPatchFlowNodeLinksAndBreaksTheClassVersion(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read it.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{Title: "Card"}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	version := made.Versions[0].ID
	linked, err := flowNodes.Patch(ctx, cards[0].ID, entities.FlowNodePatch{ClassVersionID: &version}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if linked.ClassVersionID != version || linked.ClassRef == nil || linked.ClassRef.VersionNumber != 1 {
		t.Errorf("linked = %+v, want the version named and resolved", linked)
	}
	empty := ""
	broken, err := flowNodes.Patch(ctx, cards[0].ID, entities.FlowNodePatch{ClassVersionID: &empty}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if broken.ClassVersionID != "" || broken.ClassRef != nil || broken.Title != "Card" {
		t.Errorf("broken = %+v, want the link broken and nothing else changed", broken)
	}
	ghost := "id-999"
	if _, err := flowNodes.Patch(ctx, cards[0].ID, entities.FlowNodePatch{ClassVersionID: &ghost}, nil, "alex"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("patch = %v, want a version nothing holds refused", err)
	}
}

// Deleting a class takes its versions with it, breaks the chains onto it, and unlinks the flow
// nodes made from it — which keep saying what they were asked.
func TestDeleteClassUnlinksItsInstances(t *testing.T) {
	_, flowNodes, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read it.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	instances, err := classes.Instantiate(ctx, made.Class.ID, b.ID, nil, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if err := classes.Delete(ctx, []string{made.Class.ID}, "alex"); err != nil {
		t.Fatal(err)
	}
	held, err := flowNodes.Find(ctx, instances[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if held.ClassVersionID != "" || held.Task == nil || held.Task.Body != "Read it." {
		t.Errorf("instance = %+v, want it unlinked and still asking", held)
	}
}

// A version copied from a template version starts as its source said, unless the request says
// otherwise: a template stays a template down the succession until somebody unchecks it.
func TestCreateVersionCarriesTemplateModeFromItsSource(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read ${what:text}.", IsTemplate: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !made.Versions[0].IsTemplate {
		t.Fatalf("first = %+v, want the template mode filed", made.Versions[0])
	}
	next, err := classes.CreateVersion(ctx, made.Class.ID,
		services.NewVersionRequest{From: made.Versions[0].ID}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !next.IsTemplate || next.Body != "Read ${what:text}." {
		t.Errorf("next = %+v, want the template and its words carried", next)
	}
	plain := false
	edited, err := classes.CreateVersion(ctx, made.Class.ID, services.NewVersionRequest{
		From: made.Versions[0].ID, IsTemplate: &plain,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if edited.IsTemplate {
		t.Errorf("edited = %+v, want the explicit answer to win", edited)
	}
}

// The template mode is a draft's to change, like the words: a published version keeps saying
// what it said.
func TestPatchVersionChangesTheTemplateMode(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Body: "Read the diff.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	on := true
	patched, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{IsTemplate: &on}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !patched.IsTemplate {
		t.Errorf("patched = %+v, want the template mode on", patched)
	}
	published := entities.ClassVersionPublished
	if _, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Status: &published}, nil, "alex"); err != nil {
		t.Fatal(err)
	}
	off := false
	if _, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{IsTemplate: &off}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want a published version refused", err)
	}
}

// Instantiating with bodies asks each named class's flow node the instantiated text instead of
// its version's body: the template filled in by whoever asked. A class not named is asked its
// version's words, and a class named that is not instantiated is passed over.
func TestInstantiateAsksTheInstantiatedBodies(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "First", Body: "Read ${what:text}.", IsTemplate: true, Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Second", Body: "Second words.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, first.Class.ID, second.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	made, err := classes.Instantiate(ctx, first.Class.ID, b.ID, nil, map[string]string{
		first.Class.ID:                         "Read the auth module.",
		"00000000-0000-4000-8000-000000000000": "nowhere",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(made) != 2 {
		t.Fatalf("instantiated %d flow nodes, want 2", len(made))
	}
	if made[0].Task == nil || made[0].Task.Body != "Read the auth module." {
		t.Errorf("head = %+v, want the instantiated text", made[0])
	}
	if made[1].Task == nil || made[1].Task.Body != "Second words." {
		t.Errorf("second = %+v, want the version's words", made[1])
	}
	if made[0].ClassVersionID != first.Versions[0].ID {
		t.Errorf("head version = %q, want the version still named", made[0].ClassVersionID)
	}
}

// fileClassAgent files the agent a version names as its default, straight into the store.
func fileClassAgent(t *testing.T, store *memory.Store, id, name string) {
	t.Helper()
	if err := store.CreateAgent(context.Background(), &entities.Agent{
		ID: id, Name: name, Platform: entities.PlatformClaude, Revision: 1,
	}, "alex"); err != nil {
		t.Fatal(err)
	}
}

// An AI class is filed with its first version's default agent and its note: the agent an
// instance is played by at first, and the words beside the reusable card.
func TestCreateClassFilesTheDefaultAgentAndTheNote(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	made, err := classes.Create(context.Background(), b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Agent: "agent-1", Note: "When the diff is ready.",
		Body: "Read the diff.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Versions[0].Agent != "agent-1" {
		t.Errorf("agent = %q, want the default filed", made.Versions[0].Agent)
	}
	if made.Class.Note != "When the diff is ready." {
		t.Errorf("note = %q, want the class's own words", made.Class.Note)
	}
}

// What a class is not asked is dropped at the write: a Human class's version keeps no default
// agent, whatever the request said — while the note, asked of every kind, is kept.
func TestCreateClassDropsTheDefaultAgentOffAHumanClass(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	made, err := classes.Create(context.Background(), b.ID, services.NewClassRequest{
		Title: "Review", Type: "human", Agent: "agent-1", Note: "For a person.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Versions[0].Agent != "" {
		t.Errorf("agent = %q, want none on a Human version", made.Versions[0].Agent)
	}
	if made.Class.Note != "For a person." {
		t.Errorf("note = %q, want the note kept", made.Class.Note)
	}
}

// A version naming an agent nothing holds is refused at the write: it names nothing to play
// its instances.
func TestCreateClassRefusesAnAgentNothingHolds(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	if _, err := classes.Create(context.Background(), b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Agent: "agent-gone",
	}, "alex"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("create = %v, want an unknown agent refused", err)
	}
}

// A draft's default agent is picked, and taken off again with the empty string; an id nothing
// holds is refused.
func TestPatchVersionSetsTheDefaultAgent(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review", Type: "ai"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	version := made.Versions[0].ID
	agent := "agent-1"
	set, err := classes.PatchVersion(ctx, version, entities.FlowNodeClassVersionPatch{Agent: &agent}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if set.Agent != "agent-1" {
		t.Errorf("agent = %q, want the default picked", set.Agent)
	}
	empty := ""
	cleared, err := classes.PatchVersion(ctx, version, entities.FlowNodeClassVersionPatch{Agent: &empty}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if cleared.Agent != "" {
		t.Errorf("agent = %q, want the default taken off", cleared.Agent)
	}
	gone := "agent-gone"
	if _, err := classes.PatchVersion(ctx, version, entities.FlowNodeClassVersionPatch{Agent: &gone}, nil, "alex"); !errors.Is(err, entities.ErrNotFound) {
		t.Errorf("patch = %v, want an unknown agent refused", err)
	}
}

// A default agent named on a version of a class that is not AI is dropped rather than refused:
// only an AI class's versions are asked for one.
func TestPatchVersionDropsTheDefaultAgentOffANonAIClass(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review", Type: "human"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	agent := "agent-1"
	if _, err := classes.PatchVersion(ctx, made.Versions[0].ID,
		entities.FlowNodeClassVersionPatch{Agent: &agent}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("patch = %v, want nothing left to write refused", err)
	}
}

// A version copied from another starts as its source said — the default agent included —
// unless the request names one.
func TestCreateVersionCarriesTheDefaultAgentFromItsSource(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	fileClassAgent(t, store, "agent-2", "Writer")
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Agent: "agent-1", Body: "Read the diff.",
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	copied, err := classes.CreateVersion(ctx, made.Class.ID,
		services.NewVersionRequest{From: made.Versions[0].ID}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if copied.Agent != "agent-1" {
		t.Errorf("agent = %q, want the source's default", copied.Agent)
	}
	overridden, err := classes.CreateVersion(ctx, made.Class.ID,
		services.NewVersionRequest{From: made.Versions[0].ID, Agent: "agent-2"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if overridden.Agent != "agent-2" {
		t.Errorf("agent = %q, want the named default", overridden.Agent)
	}
}

// Instantiating assigns the version's default agent to the instance's task, and copies what
// done means: the instance arrives naming both, with only the effort and the folder left to
// pick.
func TestInstantiateAssignsTheDefaultAgentAndCopiesTheCriteria(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Review", Type: "ai", Permission: "manualLive", Agent: "agent-1",
		Body: "Read the diff.", Criteria: []entities.SuccessCriterion{{Text: "No nits left"}},
		Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	instantiated, err := classes.Instantiate(ctx, made.Class.ID, b.ID, nil, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(instantiated) != 1 || instantiated[0].Task == nil {
		t.Fatalf("instantiated = %+v, want one task", instantiated)
	}
	settings := instantiated[0].Task.Settings
	if settings.Agent != "agent-1" {
		t.Errorf("agent = %q, want the version's default", settings.Agent)
	}
	if settings.Effort != "" || settings.Folder != "" {
		t.Errorf("settings = %+v, want the instance's answers empty", settings)
	}
	criteria := instantiated[0].Task.Criteria
	if len(criteria) != 1 || criteria[0].Text != "No nits left" || criteria[0].ID == "" {
		t.Errorf("criteria = %+v, want the version's copied", criteria)
	}
}

// Converting a task carries its agent to the first version's default.
func TestConvertNodeCarriesTheAgentToTheFirstVersion(t *testing.T) {
	_, flowNodes, classes, b, store := classCore(t)
	fileClassAgent(t, store, "agent-1", "Reviewer")
	ctx := context.Background()
	cards, err := flowNodes.Create(ctx, b.ID, []services.NewFlowNodeRequest{{
		Title: "Review", Type: "ai", Body: "Read the diff.",
		Settings: entities.TaskSettings{Agent: "agent-1", Folder: "/"},
	}}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	made, err := classes.ConvertNode(ctx, cards[0].ID, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if made.Versions[0].Agent != "agent-1" {
		t.Errorf("agent = %q, want the card's", made.Versions[0].Agent)
	}
}

// The note is the class's own words beside the reusable card: written on any kind, and kept
// where the kind changes — it is no AI answer, so no retype takes it off.
func TestPatchClassWritesTheNote(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review", Type: "ai"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	note := "When the diff is ready."
	noted, err := classes.Patch(ctx, made.Class.ID, entities.FlowNodeClassPatch{Note: &note}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if noted.Note != "When the diff is ready." {
		t.Errorf("note = %q, want the written words", noted.Note)
	}
	retyped := entities.FlowNodeHuman
	kept, err := classes.Patch(ctx, made.Class.ID, entities.FlowNodeClassPatch{Type: &retyped}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if kept.Note != "When the diff is ready." {
		t.Errorf("note = %q, want the note kept across the retype", kept.Note)
	}
}

// A class is off the Instantiate menu unless ticked: filed unticked by default, offered where
// the creation said so, and flipped by a patch either way.
func TestClassInstantiableOffUnlessTicked(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	bare, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Quiet"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if bare.Class.Instantiable {
		t.Errorf("instantiable = true, want off by default")
	}
	ticked, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Ready", Instantiable: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !ticked.Class.Instantiable {
		t.Errorf("instantiable = false, want the creation's tick kept")
	}
	off := false
	unticked, err := classes.Patch(ctx, ticked.Class.ID,
		entities.FlowNodeClassPatch{Instantiable: &off}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if unticked.Instantiable {
		t.Errorf("instantiable = true, want the patch's untick kept")
	}
	on := true
	reticked, err := classes.Patch(ctx, bare.Class.ID,
		entities.FlowNodeClassPatch{Instantiable: &on}, nil, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if !reticked.Instantiable {
		t.Errorf("instantiable = false, want the patch's tick kept")
	}
}

// Instantiating a workflow class makes a workflow named as the rectangle was, with one flow
// node per member grouped in it — members only, from their latest published versions, with
// the instantiated bodies asked where named.
func TestInstantiateWorkflowMakesAGroupedWorkflow(t *testing.T) {
	boards, _, classes, b, store := classCore(t)
	workflows := services.NewWorkflows(store, store, store, fixedClock{}, &countingIDs{})
	ctx := context.Background()
	first, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "First", Body: "First words.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	second, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Second", Body: "Second words.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	// Outside the rectangle, chained from a member: neither instantiated nor linked to.
	away, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Away", Body: "Away words.", Published: true,
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, first.Class.ID, second.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	if _, err := classes.Chain(ctx, second.Class.ID, away.Class.ID, "alex"); err != nil {
		t.Fatal(err)
	}
	rectangle, err := workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{
		Name: "Shapes", Classes: []string{first.Class.ID, second.Class.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	other, err := boards.Create(ctx, services.NewBoardRequest{Name: "Minor"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	workflow, made, err := classes.InstantiateWorkflow(ctx, rectangle.ID, other.ID,
		&entities.Spot{X: 10, Y: 20}, map[string]string{first.Class.ID: "Filled words."}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if workflow.Name != "Shapes" || workflow.BoardID != other.ID {
		t.Errorf("workflow = %+v, want Shapes on the target board", workflow)
	}
	if len(made) != 2 {
		t.Fatalf("instantiated %d flow nodes, want 2", len(made))
	}
	if made[0].Title != "First" || made[0].Task == nil || made[0].Task.Body != "Filled words." {
		t.Errorf("head = %+v, want the instantiated text", made[0])
	}
	if made[1].Task == nil || made[1].Task.Body != "Second words." {
		t.Errorf("second = %+v, want the version's words", made[1])
	}
	for _, one := range made {
		if one.WorkflowID != workflow.ID {
			t.Errorf("%q names workflow %q, want %q", one.Title, one.WorkflowID, workflow.ID)
		}
	}
	if made[0].Spot == nil || made[0].Spot.X != 10 || made[0].Spot.Y != 20 {
		t.Errorf("spot = %+v, want the head placed", made[0].Spot)
	}
	if made[1].Spot != nil {
		t.Errorf("second spot = %+v, want the rest unplaced", made[1].Spot)
	}
	if made[0].Next != made[1].ID {
		t.Errorf("head next = %q, want the second instance %q", made[0].Next, made[1].ID)
	}
	if made[1].Next != "" {
		t.Errorf("second next = %q, want the chain outside the rectangle left off", made[1].Next)
	}
	if made[0].ClassVersionID != first.Versions[0].ID {
		t.Errorf("head version = %q, want %q", made[0].ClassVersionID, first.Versions[0].ID)
	}
}

// An empty rectangle and a member with nothing published refuse the whole call — and the
// refusal leaves no empty workflow behind.
func TestInstantiateWorkflowRefusesEmptyOrUnpublished(t *testing.T) {
	_, _, classes, b, store := classCore(t)
	workflows := services.NewWorkflows(store, store, store, fixedClock{}, &countingIDs{})
	ctx := context.Background()
	empty, err := workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{Name: "Hollow"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := classes.InstantiateWorkflow(ctx, empty.ID, b.ID, nil, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("instantiate = %v, want the empty rectangle refused", err)
	}
	drafty, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Drafty"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	rectangle, err := workflows.CreateClass(ctx, b.ID, services.NewWorkflowClassRequest{
		Name: "Shapes", Classes: []string{drafty.Class.ID},
	}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := classes.InstantiateWorkflow(ctx, rectangle.ID, b.ID, nil, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("instantiate = %v, want the unpublished member refused", err)
	}
	held, err := workflows.Board(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 0 {
		t.Errorf("the board holds %d workflows, want none left behind", len(held))
	}
}

// A class is reusable words — a description and what done means — and a Gateway holds none, so
// there is nothing in one to file: filing one as a class, or retyping one to a Gateway, is
// refused.
func TestAGatewayIsNoClass(t *testing.T) {
	_, _, classes, b, _ := classCore(t)
	ctx := context.Background()
	if _, err := classes.Create(ctx, b.ID, services.NewClassRequest{
		Title: "Join", Type: string(entities.FlowNodeGateway),
	}, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("a gateway class = %v, want ErrInvalid", err)
	}
	made, err := classes.Create(ctx, b.ID, services.NewClassRequest{Title: "Review"}, "alex")
	if err != nil {
		t.Fatal(err)
	}
	gateway := entities.FlowNodeGateway
	if _, err := classes.Patch(ctx, made.Class.ID,
		entities.FlowNodeClassPatch{Type: &gateway}, nil, "alex"); !errors.Is(err, entities.ErrInvalid) {
		t.Errorf("a class retyped to gateway = %v, want ErrInvalid", err)
	}
}
