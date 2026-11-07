package conversations

import (
	"errors"
	"kiao/worker/internal/core/http"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// newTestConversationStore builds a store over a state directory of its own. Every test in this file
// and in handlers_conversations_test.go goes through it, so the two agree on what a store is.
func newTestConversationStore(t *testing.T) *ConversationStore {
	t.Helper()
	store, err := NewConversationStore(filepath.Join(t.TempDir(), ConversationsDirName))
	if err != nil {
		t.Fatalf("newConversationStore: %v", err)
	}
	return store
}

// mustCreate creates a conversation and fails the test if the store refused, so the tests that are
// about something else are not written twice.
func mustCreate(t *testing.T, store *ConversationStore, folder string) ConversationMeta {
	t.Helper()
	meta, err := store.Create(ConversationMeta{Folder: folder})
	if err != nil {
		t.Fatalf("create(%q) = %v", folder, err)
	}
	return meta
}

// mustAppend writes one transcript record, which is what one half of a turn boundary does.
func mustAppend(t *testing.T, store *ConversationStore, id string, rec ConversationRecord,
	mutate func(*ConversationMeta)) ConversationMeta {
	t.Helper()
	meta, err := store.AppendAndUpdate(id, rec, mutate)
	if err != nil {
		t.Fatalf("appendAndUpdate(%q) = %v", id, err)
	}
	return meta
}

// mustMessages replays a transcript.
func mustMessages(t *testing.T, store *ConversationStore, id string) []ConversationRecord {
	t.Helper()
	records, err := store.Messages(id)
	if err != nil {
		t.Fatalf("messages(%q) = %v", id, err)
	}
	return records
}

// A conversation id is a path segment: it is joined onto the state directory and becomes a directory
// name. It is therefore validated by shape rather than sanitised, and every entry point has to do it
// — a single method that forgot would be the whole traversal. Pinned here the way pathutil_test.go
// pins its own boundary.
func TestConversationIDRejectsTraversal(t *testing.T) {
	store := newTestConversationStore(t)
	real := mustCreate(t, store, "units")

	bad := []string{
		"", ".", "..", "../escape", "/etc/passwd", "conv-x/../y",
		real.ID + "/..", real.ID + "/../" + real.ID, "conv-123-abcd", "CONV-1700000000000-abcd",
		"conv-1700000000000-ABCD", "conv-1700000000000-abcdefff", "conv-1700000000000-zzzz",
	}
	for _, id := range bad {
		if _, err := store.Get(id); !errors.Is(err, errBadConversationID) {
			t.Errorf("get(%q) error = %v, want errBadConversationID", id, err)
		}
		if _, err := store.Messages(id); !errors.Is(err, errBadConversationID) {
			t.Errorf("messages(%q) error = %v, want errBadConversationID", id, err)
		}
		if _, err := store.Update(id, func(*ConversationMeta) {}); !errors.Is(err, errBadConversationID) {
			t.Errorf("update(%q) error = %v, want errBadConversationID", id, err)
		}
		_, err := store.AppendAndUpdate(id, ConversationRecord{Role: RoleUser, Text: "x"}, nil)
		if !errors.Is(err, errBadConversationID) {
			t.Errorf("appendAndUpdate(%q) error = %v, want errBadConversationID", id, err)
		}
		if err := store.Delete(id); !errors.Is(err, errBadConversationID) {
			t.Errorf("delete(%q) error = %v, want errBadConversationID", id, err)
		}
	}

	// Nothing reached the filesystem: the registry still holds exactly the one real conversation.
	entries, err := os.ReadDir(store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != real.ID {
		t.Errorf("state directory holds %v, want only %s", entries, real.ID)
	}
}

// A well-formed id that names no conversation is a different mistake from a malformed one, and the
// client can act on each: one is a stale link, the other is a bug.
func TestUnknownConversationIsNotFound(t *testing.T) {
	store := newTestConversationStore(t)

	if _, err := store.Get("conv-1700000000000-abcd"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("get(unknown) error = %v, want os.ErrNotExist", err)
	}
	if err := store.Delete("conv-1700000000000-abcd"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("delete(unknown) error = %v, want os.ErrNotExist", err)
	}
}

// A turn is exactly two writes to the transcript — the prompt before the spawn and the whole reply
// after the exit — whatever the reply's length. That is the design and not an accident: streaming is
// accumulated in memory, so a forty-minute turn emitting five thousand deltas costs what a one-line
// answer costs. There is deliberately no API here that a streaming loop could call.
func TestAppendAndUpdateIsTwoWritesPerTurn(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")

	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "explain this file"},
		func(m *ConversationMeta) { m.RunningAt = protocol.NowConversationTime() })
	reply := strings.Repeat("a streamed chunk of the answer ", 2000)
	settled := mustAppend(t, store, meta.ID,
		ConversationRecord{Role: RoleAssistant, Text: reply, Model: "sonnet"},
		func(m *ConversationMeta) { m.RunningAt = "" })

	records := mustMessages(t, store, meta.ID)
	if len(records) != 2 {
		t.Fatalf("transcript holds %d records, want the two of one turn", len(records))
	}
	if records[0].Role != RoleUser || records[1].Role != RoleAssistant {
		t.Errorf("roles = %q/%q, want user then assistant", records[0].Role, records[1].Role)
	}
	if records[1].Text != reply || records[1].Truncated {
		t.Errorf("the reply was not stored whole: %d chars, truncated=%v",
			len(records[1].Text), records[1].Truncated)
	}
	if settled.MessageCount != 2 || settled.RunningAt != "" {
		t.Errorf("meta = %+v, want two messages and a settled turn", settled)
	}
}

// The metadata write and the transcript write are one critical section, so a turn boundary either
// happens or does not: a record with no metadata to explain it would show as an answer to nothing.
func TestAppendAndUpdatePersistsBothHalves(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	exit := 0

	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleAssistant, Text: "done"},
		func(m *ConversationMeta) { m.SessionID = "sess-7"; m.LastExitCode = &exit })

	reloaded, err := NewConversationStore(store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	back, err := reloaded.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.SessionID != "sess-7" || back.LastExitCode == nil || *back.LastExitCode != 0 {
		t.Errorf("meta after a reload = %+v, want the session and exit code recorded", back)
	}
	if records := mustMessages(t, reloaded, meta.ID); len(records) != 1 {
		t.Errorf("transcript after a reload holds %d records, want 1", len(records))
	}
}

// Nothing in this file fsyncs, so a power cut can leave a half-written final line. Skipping it costs
// one record; refusing the file would cost the conversation.
func TestMessagesSkipsATornFinalLine(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "first"}, nil)
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleAssistant, Text: "second"}, nil)

	f, err := os.OpenFile(store.transcriptPath(meta.ID), os.O_APPEND|os.O_WRONLY, conversationFilePerm)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(`{"id":"msg-3","role":"assistant","text":"tor`); err != nil {
		t.Fatal(err)
	}
	f.Close()

	records := mustMessages(t, store, meta.ID)
	if len(records) != 2 || records[1].Text != "second" {
		t.Errorf("records = %+v, want the two whole ones and nothing else", records)
	}
}

// A conversation that has been created but never prompted has no transcript file at all. That is the
// normal state of a new conversation, not a missing file.
func TestMessagesOfANewConversationIsEmptyNotAnError(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "")

	records, err := store.Messages(meta.ID)
	if err != nil {
		t.Fatalf("messages() = %v, want an empty transcript", err)
	}
	if records == nil || len(records) != 0 {
		t.Errorf("records = %+v, want an empty slice rather than null", records)
	}
}

// A transcript that grew past its cap loses its oldest records, and says so where they were. Without
// the notice the conversation would appear to begin mid-sentence, which reads as data loss rather
// than as the trim it is — and the CLI's own session still has every one of them.
func TestCompactionTrimsOldestAndLeavesANotice(t *testing.T) {
	store := newTestConversationStore(t)
	// Driven through the fields rather than the constants: the behaviour is identical at eight
	// megabytes and the test does not have to write them.
	store.maxTranscriptBytes, store.compactTarget = 4096, 2048
	meta := mustCreate(t, store, "units")

	var last ConversationMeta
	for i := 0; i < 15; i++ {
		last = mustAppend(t, store, meta.ID, ConversationRecord{
			Role: RoleAssistant,
			Text: "message-" + string(rune('a'+i)) + " " + strings.Repeat("x", 300),
		}, nil)
	}

	records := mustMessages(t, store, meta.ID)
	if len(records) < 2 {
		t.Fatalf("records = %+v, want a trimmed transcript rather than an empty one", records)
	}
	if records[0].Role != RoleNotice || !strings.Contains(records[0].Text, "trimmed") {
		t.Errorf("first record = %+v, want the notice that explains the gap", records[0])
	}
	if !strings.Contains(records[len(records)-1].Text, "message-o") {
		t.Errorf("last record = %q, want the newest message kept", records[len(records)-1].Text)
	}
	for _, rec := range records {
		if strings.Contains(rec.Text, "message-a ") {
			t.Errorf("the oldest message survived compaction: %q", rec.Text)
		}
	}
	// The count is what a reader will actually be served, so compaction has to correct it rather than
	// leave it counting records that are gone.
	if last.MessageCount != len(records) {
		t.Errorf("messageCount = %d, want %d — the records that are still there",
			last.MessageCount, len(records))
	}
}

// Compaction runs because a record was just appended, so that record is the one thing it may never
// drop. A tail scan with no floor drops it whenever it alone is larger than the target — and then
// `dropped` is every record there is, the rewrite is the notice and nothing else, and a conversation
// loses its whole history to the arrival of one long turn.
func TestCompactionNeverDropsTheRecordItWasCalledFor(t *testing.T) {
	store := newTestConversationStore(t)
	// A record larger than the target on its own: the case the tail scan cannot satisfy at all.
	store.maxTranscriptBytes, store.compactTarget = 512, 256
	meta := mustCreate(t, store, "units")
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "the first prompt"}, nil)

	reply := strings.Repeat("y", 4000)
	last := mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleAssistant, Text: reply}, nil)

	records := mustMessages(t, store, meta.ID)
	if len(records) == 0 {
		t.Fatal("compaction emptied the transcript, taking the turn it was called for with it")
	}
	tail := records[len(records)-1]
	if tail.Role != RoleAssistant || tail.Text != reply {
		t.Errorf("last record = %+v, want the turn that triggered the compaction", tail)
	}
	if last.MessageCount != len(records) {
		t.Errorf("messageCount = %d, want %d — the records that are still there",
			last.MessageCount, len(records))
	}
}

// maxRecordChars bounds a reply's text, but a record is text *and* tools: an unbounded slice beside a
// bounded string is not a bound. It has to be one, because compaction's floor keeps the newest record
// whatever its size — so "one record always fits" is now load-bearing rather than merely likely.
func TestRecordToolsAreBounded(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	tools := make([]conversationTool, MaxRecordTools+50)
	for i := range tools {
		tools[i] = conversationTool{Name: "Bash", Input: "git status"}
	}

	mustAppend(t, store, meta.ID,
		ConversationRecord{Role: RoleAssistant, Text: "done", Tools: tools}, nil)

	records := mustMessages(t, store, meta.ID)
	if len(records) != 1 {
		t.Fatalf("records = %d, want one", len(records))
	}
	if got := len(records[0].Tools); got != MaxRecordTools {
		t.Errorf("tools = %d, want the cap of %d", got, MaxRecordTools)
	}
	if !records[0].Truncated {
		t.Error("a record that lost tool calls must say so, like one that lost text")
	}
}

// A runaway reply is cut with a marker rather than allowed to make a conversation unopenable, and it
// is cut on a rune boundary: half a rune would reach the browser as a replacement character in a
// file that is otherwise valid UTF-8.
func TestRecordTruncatedAtRuneBoundary(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	// A two-byte rune, so a cut counted in bytes would land inside one.
	mustAppend(t, store, meta.ID,
		ConversationRecord{Role: RoleAssistant, Text: strings.Repeat("é", maxRecordChars+100)}, nil)

	records := mustMessages(t, store, meta.ID)
	if len(records) != 1 || !records[0].Truncated {
		t.Fatalf("records = %d, truncated = %v, want one truncated record", len(records), records[0].Truncated)
	}
	text := records[0].Text
	if !utf8.ValidString(text) || strings.ContainsRune(text, utf8.RuneError) {
		t.Error("the truncated reply is not valid UTF-8: the cut landed inside a rune")
	}
	if want := maxRecordChars + len([]rune(protocol.TruncationMarker)); len([]rune(text)) != want {
		t.Errorf("truncated length = %d runes, want %d", len([]rune(text)), want)
	}
	if !strings.HasSuffix(text, protocol.TruncationMarker) {
		t.Error("a truncated reply must say so, or it reads as an answer that simply stopped")
	}
}

// A block record answers to the same two caps a flat one does, and it spends them from the *end* of
// the turn: what a reader wants from a turn that ran away is what it was doing when it finished. The
// last blocks survive whole, the one the budget runs out in is cut on a rune boundary, and Truncated
// says a cut happened at all.
func TestBlockRecordIsBoundedFromTheTail(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	tail := strings.Repeat("é", 100) // two-byte runes, so a cut counted in bytes lands inside one
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleAssistant, Blocks: []ConversationBlock{
		{Kind: agentapi.BlockKindText, Text: strings.Repeat("a", maxRecordChars)},
		{Kind: agentapi.BlockKindToolUse, Name: "Bash", Input: "git status"},
		{Kind: agentapi.BlockKindText, Text: tail},
	}}, nil)

	records := mustMessages(t, store, meta.ID)
	if len(records) != 1 || !records[0].Truncated {
		t.Fatalf("records = %+v, want one truncated record", records)
	}
	kept := records[0].Blocks
	if len(kept) != 3 {
		t.Fatalf("kept %d blocks, want all three with the oldest cut down: %+v", len(kept), kept)
	}
	if kept[2].Text != tail {
		t.Error("the last block was cut; the budget is spent on the newest blocks first")
	}
	head := kept[0].Text
	if !utf8.ValidString(head) || strings.ContainsRune(head, utf8.RuneError) {
		t.Error("the cut block is not valid UTF-8: the cut landed inside a rune")
	}
	if !strings.HasPrefix(head, protocol.TruncationMarker) {
		t.Error("a block cut from the front must say so, or it reads as a turn that began mid-sentence")
	}
	if want := maxRecordChars - len([]rune(tail)) + len([]rune(protocol.TruncationMarker)); len([]rune(head)) != want {
		t.Errorf("cut block = %d runes, want %d — the whole budget, less what the tail took",
			len([]rune(head)), want)
	}
}

// The other half of the same bound: a bounded string beside an unbounded list of tool calls is not a
// bound, and one long turn can make hundreds of them.
func TestBlockRecordToolsAreBounded(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	blocks := make([]ConversationBlock, MaxRecordTools+50)
	for i := range blocks {
		blocks[i] = ConversationBlock{Kind: agentapi.BlockKindToolUse, Name: "Bash", Input: "git status"}
	}

	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleAssistant, Blocks: blocks}, nil)

	records := mustMessages(t, store, meta.ID)
	if len(records) != 1 || !records[0].Truncated {
		t.Fatalf("records = %+v, want one truncated record", records)
	}
	if got := len(records[0].BlockTools()); got != MaxRecordTools {
		t.Errorf("tool calls = %d, want the cap of %d", got, MaxRecordTools)
	}
}

// The two views of one record. `blocks` is the order and the whole of it; `text` and `tools` are
// derived from it, so a reader that knows neither blocks nor thinking still gets the reply it always
// got — and thinking stays out of `text`, which is what the model *said*.
func TestBlockRecordDerivesTextAndTools(t *testing.T) {
	rec := ConversationRecord{Role: RoleAssistant, Blocks: []ConversationBlock{
		{Kind: agentapi.BlockKindText, Text: "Looking. "},
		{Kind: agentapi.BlockKindThinking, Text: "it is probably under units/"},
		{Kind: agentapi.BlockKindToolUse, Name: "Read", Input: `{"file_path":"units/a.md"}`,
			Detail: "{\n  \"file_path\": \"units/a.md\"\n}"},
		{Kind: agentapi.BlockKindText, Text: "Found it."},
	}}

	if got, want := rec.BlockText(), "Looking. Found it."; got != want {
		t.Errorf("blockText() = %q, want %q — thinking is not something the model said", got, want)
	}
	tools := rec.BlockTools()
	if len(tools) != 1 || tools[0].Name != "Read" {
		t.Fatalf("blockTools() = %+v, want the one Read call", tools)
	}

	// A record from before blocks existed reports what it stored: the order it happened in was never
	// captured, and is not invented here.
	old := ConversationRecord{Role: RoleAssistant, Text: "done",
		Tools: []conversationTool{{Name: "Bash", Input: "git status"}}}
	if old.BlockText() != "done" || len(old.BlockTools()) != 1 {
		t.Errorf("a record with no blocks = %q / %+v, want its own text and tools",
			old.BlockText(), old.BlockTools())
	}
}

// Nothing deletes a conversation on the user's behalf, so the ceiling is what stops a client looping
// on create from filling the disk. It is a situation the caller can act on — archive or delete some
// — which is what makes it a 409 rather than a 500.
func TestCreateRefusedOverTheCap(t *testing.T) {
	store := newTestConversationStore(t)
	store.MaxConversations = 2
	mustCreate(t, store, "")
	mustCreate(t, store, "")

	_, err := store.Create(ConversationMeta{})
	if err == nil {
		t.Fatal("create() = nil over the cap, want a refusal")
	}
	if status, _ := httpkit.StatusForError(err); status != 409 {
		t.Errorf("create over the cap maps to %d, want 409", status)
	}
	if listed := store.List(true); len(listed) != 2 {
		t.Errorf("list = %d conversations, want the two that fit", len(listed))
	}
}

// An id is a timestamp and four random hex, so two conversations created in the same millisecond
// collide once in 65536 — and a collision is not a duplicate, it is a "new" conversation opening on
// the previous one's directory: same transcript, metadata overwritten, the old handle replaced in the
// index. Forced here through the minting seam, because arranging the real collision is not something
// a test can do.
func TestCreateNeverAdoptsAnExistingConversation(t *testing.T) {
	store := newTestConversationStore(t)
	store.newID = func() string { return "conv-1700000000000-abcd" }
	first := mustCreate(t, store, "units")
	mustAppend(t, store, first.ID, ConversationRecord{Role: RoleUser, Text: "the first prompt"}, nil)

	if _, err := store.Create(ConversationMeta{Folder: "units"}); err == nil {
		t.Fatal("create() = nil with every id colliding, want a refusal rather than a second " +
			"conversation on the first one's files")
	}

	records := mustMessages(t, store, first.ID)
	if len(records) != 1 || records[0].Text != "the first prompt" {
		t.Errorf("records = %+v, want the first conversation's transcript untouched", records)
	}
	if listed := store.List(true); len(listed) != 1 {
		t.Errorf("list = %d conversations, want only the one that was created", len(listed))
	}
	meta, err := store.Get(first.ID)
	if err != nil {
		t.Fatalf("get() = %v", err)
	}
	if meta.MessageCount != 1 {
		t.Errorf("messageCount = %d, want the first conversation's own", meta.MessageCount)
	}
}

// Archiving is how a conversation leaves the switcher without being lost, so the default listing
// leaves it out and the manager asks for it explicitly.
func TestListExcludesArchivedByDefault(t *testing.T) {
	store := newTestConversationStore(t)
	kept := mustCreate(t, store, "units")
	archived := mustCreate(t, store, "units")
	if _, err := store.Update(archived.ID, func(m *ConversationMeta) { m.Archived = true }); err != nil {
		t.Fatal(err)
	}

	visible := store.List(false)
	if len(visible) != 1 || visible[0].ID != kept.ID {
		t.Fatalf("list(false) = %+v, want only the unarchived conversation", visible)
	}
	if all := store.List(true); len(all) != 2 {
		t.Errorf("list(true) = %d conversations, want both", len(all))
	}
}

// The list is what the switcher renders, so the most recently touched conversation comes first.
func TestListIsNewestFirst(t *testing.T) {
	store := newTestConversationStore(t)
	first := mustCreate(t, store, "")
	second := mustCreate(t, store, "")
	// Two conversations created back to back land in the same millisecond as often as not, and a tie
	// on UpdatedAt is broken by the id — which would then put the *newer* one first and make this test
	// a coin toss. The one that is not being touched is aged deliberately instead of hoping for a
	// clock tick, which is also what the switcher sees in real use.
	if _, err := store.Update(second.ID, func(m *ConversationMeta) {
		m.UpdatedAt = "2020-01-01T00:00:00.000Z"
	}); err != nil {
		t.Fatal(err)
	}
	// A turn in the older conversation makes it the most recent one.
	mustAppend(t, store, first.ID, ConversationRecord{Role: RoleUser, Text: "hello"}, nil)

	listed := store.List(false)
	if len(listed) != 2 || listed[0].ID != first.ID || listed[1].ID != second.ID {
		t.Errorf("list = %v, want the conversation that was just used first",
			[]string{listed[0].ID, listed[1].ID})
	}
}

// The folder is the CLI's working directory and the folder whose slug owns the CLI's own transcript.
// An update that could move it would make the two disagree silently, so the store restores it
// whatever the caller's mutate did.
func TestUpdateCannotMoveAConversation(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units/demo")

	updated, err := store.Update(meta.ID, func(m *ConversationMeta) {
		m.Folder = "elsewhere"
		m.ID = "conv-1700000000000-ffff"
		m.CreatedAt = "1999-01-01T00:00:00Z"
		m.Archived = true
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Folder != "units/demo" || updated.ID != meta.ID || updated.CreatedAt != meta.CreatedAt {
		t.Errorf("meta = %+v, want its identity unchanged", updated)
	}
	if !updated.Archived {
		t.Error("the update did not apply what it was allowed to change")
	}
}

// A turn dies with the service that spawned it, and nothing else will ever close it: the metadata
// would say "running" forever. The user's record is written before the spawn, so an interrupted turn
// always has a dangling prompt for this to answer.
func TestSweepInterruptedClosesADanglingUserTurn(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "a long job"},
		func(m *ConversationMeta) { m.RunningAt = protocol.NowConversationTime() })
	settled := mustCreate(t, store, "units")

	// Read back from disk, which is what a restart does.
	restarted, err := NewConversationStore(store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if n := restarted.SweepInterrupted(); n != 1 {
		t.Fatalf("sweepInterrupted() = %d, want the one interrupted conversation", n)
	}

	after, err := restarted.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.RunningAt != "" {
		t.Error("the conversation still claims a turn is running after the sweep")
	}
	records := mustMessages(t, restarted, meta.ID)
	if len(records) != 2 || records[1].Role != RoleAssistant || !records[1].Interrupted {
		t.Errorf("records = %+v, want the dangling prompt closed by an interrupted reply", records)
	}
	// A second sweep has nothing to do, and a conversation that was idle is never touched.
	if n := restarted.SweepInterrupted(); n != 0 {
		t.Errorf("a second sweep settled %d conversations, want none", n)
	}
	if idle := mustMessages(t, restarted, settled.ID); len(idle) != 0 {
		t.Errorf("an idle conversation gained %d records from the sweep", len(idle))
	}
}

// The registry outlives the process; a conversation whose meta.json cannot be read is skipped rather
// than taking the service down with it, because one unreadable conversation is not worth refusing to
// start over.
func TestReloadSkipsAnUnreadableConversation(t *testing.T) {
	store := newTestConversationStore(t)
	good := mustCreate(t, store, "units")
	broken := mustCreate(t, store, "units")
	mustWriteBytes(t, store.metaPath(broken.ID), []byte("{not json"))

	reloaded, err := NewConversationStore(store.Dir)
	if err != nil {
		t.Fatalf("newConversationStore() = %v, want the good conversation loaded anyway", err)
	}
	listed := reloaded.List(true)
	if len(listed) != 1 || listed[0].ID != good.ID {
		t.Errorf("list = %+v, want only the conversation that reads", listed)
	}
}

// A title has to exist the moment the first message is sent, so it comes from the prompt itself: its
// first non-empty line, on one line, short enough for a list row.
func TestConversationTitleFromFirstLine(t *testing.T) {
	cases := []struct{ name, prompt, want string }{
		{"first line", "Fix the header\n\nand also the footer", "Fix the header"},
		{"leading blank lines", "\n\n  Rename the unit  \nmore", "Rename the unit"},
		{"whitespace collapsed", "Fix   the\theader", "Fix the header"},
		{"nothing to derive", "   \n\t\n", DefaultConversationTitle},
		{"empty", "", DefaultConversationTitle},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := conversationTitle(c.prompt); got != c.want {
				t.Errorf("conversationTitle(%q) = %q, want %q", c.prompt, got, c.want)
			}
		})
	}

	// A long first line is cut back to a word boundary, and the result stays inside the cap *with*
	// its ellipsis — otherwise re-normalising a derived title would cut it a second time.
	long := conversationTitle(strings.Repeat("word ", 40))
	if len([]rune(long)) > maxTitleRunes {
		t.Errorf("title = %q (%d runes), want at most %d", long, len([]rune(long)), maxTitleRunes)
	}
	if !strings.HasSuffix(long, "…") || strings.HasSuffix(long, " …") {
		t.Errorf("title = %q, want it cut on a word boundary with an ellipsis", long)
	}
	if NormaliseTitle(long) != long {
		t.Errorf("normaliseTitle(%q) = %q, want a derived title left alone", long, NormaliseTitle(long))
	}
	// A single unbroken word has no boundary to cut back to and is cut where it stands rather than
	// reduced to nothing.
	if got := conversationTitle(strings.Repeat("x", 200)); len([]rune(got)) != maxTitleRunes {
		t.Errorf("title of one long word = %q (%d runes), want %d", got, len([]rune(got)), maxTitleRunes)
	}
}

// The naming happens once, at the first prompt, and only to a conversation that is still carrying the
// placeholder: a title the user chose, or one already derived, is never overwritten by a later turn.
func TestTheFirstPromptNamesTheConversation(t *testing.T) {
	store := newTestConversationStore(t)
	auto := mustCreate(t, store, "units")
	named, err := store.Create(ConversationMeta{Folder: "units", Title: "Release notes", TitleSetByUser: true})
	if err != nil {
		t.Fatal(err)
	}

	first := mustAppend(t, store, auto.ID, ConversationRecord{Role: RoleUser, Text: "Fix the header\nplease"}, nil)
	if first.Title != "Fix the header" {
		t.Errorf("title = %q, want it derived from the first prompt", first.Title)
	}
	second := mustAppend(t, store, auto.ID, ConversationRecord{Role: RoleUser, Text: "Now the footer"}, nil)
	if second.Title != "Fix the header" {
		t.Errorf("title = %q, want the derived title kept by a later turn", second.Title)
	}
	kept := mustAppend(t, store, named.ID, ConversationRecord{Role: RoleUser, Text: "Fix the header"}, nil)
	if kept.Title != "Release notes" {
		t.Errorf("title = %q, want the title the user chose kept", kept.Title)
	}
}

// A title is a label in a list, so pasting a document into the rename box must not make the switcher
// unreadable.
func TestTitleIsBoundedAndSingleLine(t *testing.T) {
	store := newTestConversationStore(t)
	meta, err := store.Create(ConversationMeta{Title: "a title\nwith lines and " + strings.Repeat("padding ", 20)})
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(meta.Title, "\n\t") || len([]rune(meta.Title)) > maxTitleRunes {
		t.Errorf("title = %q (%d runes), want one bounded line", meta.Title, len([]rune(meta.Title)))
	}
	if untitled := mustCreate(t, store, ""); untitled.Title != DefaultConversationTitle {
		t.Errorf("title = %q, want %q", untitled.Title, DefaultConversationTitle)
	}
}

// Deleting takes the whole directory: a transcript left behind would be prompt text the user asked to
// be rid of.
func TestDeleteRemovesTheWholeDirectory(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "secret"}, nil)

	if err := store.Delete(meta.ID); err != nil {
		t.Fatalf("delete() = %v", err)
	}
	if _, err := os.Stat(store.ConvDir(meta.ID)); !os.IsNotExist(err) {
		t.Errorf("the conversation directory survived the delete; stat err = %v", err)
	}
	if _, err := store.Get(meta.ID); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("get() after a delete = %v, want os.ErrNotExist", err)
	}
}

// A fork is a copy that carries on from where the source stands: the same folder and settings, the
// whole transcript, and — the point of the whole thing — the CLI session, so the copy is one Claude
// remembers rather than a fresh chat with someone else's history above it.
func TestForkCopiesTheTranscriptAndTheSession(t *testing.T) {
	store := newTestConversationStore(t)
	source, err := store.Create(ConversationMeta{
		Folder: "units/demo", Title: "Rewrite the README", TitleSetByUser: true,
		Model: "opus", Effort: "low", PermissionMode: runnerconfig.PermissionModeManual, Thinking: false,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "first"},
		func(meta *ConversationMeta) { meta.SessionID = "sess-7" })
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleAssistant,
		Blocks: []ConversationBlock{{Kind: agentapi.BlockKindText, Text: "an answer"}}}, nil)

	fork, err := store.Fork(source.ID, "someone", "", claudeForkTarget())
	if err != nil {
		t.Fatalf("fork() = %v", err)
	}
	if fork.ID == source.ID {
		t.Fatal("a fork must be a conversation of its own")
	}
	if fork.Folder != source.Folder || fork.Model != source.Model || fork.Effort != source.Effort ||
		fork.PermissionMode != source.PermissionMode || fork.Thinking != source.Thinking {
		t.Errorf("fork = %+v, want the source's folder and settings %+v", fork, source)
	}
	if fork.Owner != "someone" {
		t.Errorf("fork owner = %q, want the user who asked for it", fork.Owner)
	}
	// The session is carried, and the marker with it: what the fork holds is what it will branch
	// from, not what it will write.
	if fork.SessionID != "sess-7" || !fork.ForkPending {
		t.Errorf("fork session = %q pending = %v, want sess-7 marked to be branched off",
			fork.SessionID, fork.ForkPending)
	}
	if fork.Title != "Rewrite the README (fork)" || !fork.TitleSetByUser {
		t.Errorf("fork title = %q (set by user %v), want it named after the source",
			fork.Title, fork.TitleSetByUser)
	}

	// The transcript is the source's, closed by the notice that says where the two part company.
	records := mustMessages(t, store, fork.ID)
	if len(records) != 3 {
		t.Fatalf("fork transcript = %d records, want the source's two and a notice", len(records))
	}
	if records[0].Text != "first" || records[1].BlockText() != "an answer" {
		t.Errorf("fork transcript = %+v, want the source's records in order", records)
	}
	if records[2].Role != RoleNotice || !strings.Contains(records[2].Text, "Rewrite the README") {
		t.Errorf("last record = %+v, want a notice naming what it was forked from", records[2])
	}
	if fork.MessageCount != 3 {
		t.Errorf("fork messageCount = %d, want the %d records it can show", fork.MessageCount, 3)
	}
}

// Forking *from* a message is the whole feature: the copy carries what happened before that message
// and stops short of the message itself, and its session is picked up at the last reply it kept. The
// message is left out because forking is asked of a prompt — the user is about to ask it again,
// differently, which is the only reason to branch there.
func TestForkFromAMessageStopsShortOfItAndAnchorsTheSession(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "first"},
		func(meta *ConversationMeta) { meta.SessionID = "sess-7" })
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleAssistant,
		Blocks:        []ConversationBlock{{Kind: agentapi.BlockKindText, Text: "an answer"}},
		SessionAnchor: "uuid-of-the-first-reply"}, nil)
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "the wrong turn"}, nil)
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleAssistant,
		Blocks:        []ConversationBlock{{Kind: agentapi.BlockKindText, Text: "off we go"}},
		SessionAnchor: "uuid-of-the-second-reply"}, nil)

	records := mustMessages(t, store, source.ID)
	fork, err := store.Fork(source.ID, "someone", records[2].ID, claudeForkTarget())
	if err != nil {
		t.Fatalf("fork() = %v", err)
	}
	// The session is the source's, cut where the copy stops: the anchor is the last reply kept and
	// never the last reply there was.
	if fork.SessionID != "sess-7" || !fork.ForkPending || fork.ForkAnchor != "uuid-of-the-first-reply" {
		t.Errorf("fork = session %q pending %v anchor %q, want sess-7 branched at the first reply",
			fork.SessionID, fork.ForkPending, fork.ForkAnchor)
	}
	kept := mustMessages(t, store, fork.ID)
	if len(kept) != 3 {
		t.Fatalf("fork transcript = %d records, want the two before the fork point and a notice", len(kept))
	}
	if kept[0].Text != "first" || kept[1].BlockText() != "an answer" || kept[2].Role != RoleNotice {
		t.Errorf("fork transcript = %+v, want everything before the fork point and then the notice", kept)
	}
	// The source is a conversation the user is still free to carry on, so nothing about it moves.
	if after := mustMessages(t, store, source.ID); len(after) != 4 {
		t.Errorf("source transcript = %d records, want the four it had", len(after))
	}
}

// A fork from the very first prompt has no reply behind it to anchor at, and neither has a fork from
// a transcript written before anchors existed. There is then no point in the session to pick the
// conversation up at, so the copy takes none of it: showing history the model was never given is the
// one thing the notice must not let happen quietly.
func TestForkFromAPointWithNoAnchorTakesNoSession(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "first"},
		func(meta *ConversationMeta) { meta.SessionID = "sess-7" })
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleAssistant,
		Blocks: []ConversationBlock{{Kind: agentapi.BlockKindText, Text: "an answer"}}}, nil)
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "the wrong turn"}, nil)

	records := mustMessages(t, store, source.ID)
	for name, from := range map[string]string{
		"the very first prompt":  records[0].ID,
		"a reply with no anchor": records[2].ID,
	} {
		fork, err := store.Fork(source.ID, "someone", from, claudeForkTarget())
		if err != nil {
			t.Fatalf("fork from %s = %v", name, err)
		}
		if fork.SessionID != "" || fork.ForkPending || fork.ForkAnchor != "" {
			t.Errorf("fork from %s = session %q pending %v anchor %q, want a session of its own",
				name, fork.SessionID, fork.ForkPending, fork.ForkAnchor)
		}
		kept := mustMessages(t, store, fork.ID)
		notice := kept[len(kept)-1]
		if notice.Role != RoleNotice || !strings.Contains(notice.Text, "not remembered") {
			t.Errorf("notice of a fork from %s = %q, want it to say the history is not remembered",
				name, notice.Text)
		}
	}
}

// A message id this transcript does not hold is the client pointing at a record that was compacted
// away or belongs to another conversation. Forking the whole thing instead would hand back a copy
// remembering more than the user asked to branch from, so it is refused.
func TestForkFromAMessageThatIsNotThere(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "first"}, nil)

	if _, err := store.Fork(source.ID, "someone", "msg-1700000000000-abcd", claudeForkTarget()); err == nil {
		t.Fatal("fork from an unknown message = nil, want a refusal")
	}
	if got := len(store.List(true)); got != 1 {
		t.Errorf("conversations after a refused fork = %d, want the source alone", got)
	}
}

// Forking must not touch what it copies: the source keeps its transcript, its session and its title,
// because a user forking a conversation is trying a second direction on it and not spending it.
func TestForkLeavesTheSourceAlone(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "the only prompt"},
		func(meta *ConversationMeta) { meta.SessionID = "sess-7" })
	before, err := store.Get(source.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	if _, err := store.Fork(source.ID, "someone", "", claudeForkTarget()); err != nil {
		t.Fatalf("fork() = %v", err)
	}

	after, err := store.Get(source.ID)
	if err != nil {
		t.Fatalf("get after the fork: %v", err)
	}
	if after != before {
		t.Errorf("source after the fork = %+v, want it untouched %+v", after, before)
	}
	if after.ForkPending {
		t.Error("the source must not be marked to branch off itself")
	}
	if records := mustMessages(t, store, source.ID); len(records) != 1 {
		t.Errorf("source transcript = %d records, want the one it had", len(records))
	}
}

// A source with no session — one nobody has prompted, or one whose session the CLI has already
// refused — has nothing to branch from, so the copy is the transcript alone and its first turn opens
// a session of its own. Marking it would ask the CLI to fork nothing.
func TestForkWithoutASessionAsksToBranchOffNothing(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")

	fork, err := store.Fork(source.ID, "someone", "", claudeForkTarget())
	if err != nil {
		t.Fatalf("fork() = %v", err)
	}
	if fork.SessionID != "" || fork.ForkPending {
		t.Errorf("fork = session %q pending %v, want neither", fork.SessionID, fork.ForkPending)
	}
	// Nor is there anything to name it after, so it is unnamed and its own first prompt names it —
	// "New conversation (fork)" would be a name it could never grow out of.
	if fork.Title != DefaultConversationTitle || fork.TitleSetByUser {
		t.Errorf("fork of an unnamed conversation = %q (set by user %v), want it unnamed too",
			fork.Title, fork.TitleSetByUser)
	}
	// Still a copy: an empty conversation forks to one holding only the notice.
	if records := mustMessages(t, store, fork.ID); len(records) != 1 || records[0].Role != RoleNotice {
		t.Errorf("fork transcript = %+v, want the fork notice alone", records)
	}

	named := mustAppend(t, store, fork.ID, ConversationRecord{Role: RoleUser, Text: "Rewrite the README"}, nil)
	if named.Title != "Rewrite the README" {
		t.Errorf("fork title after its first prompt = %q, want it named after the prompt", named.Title)
	}
}

// The cap is the cap: a fork is a new conversation and is refused like any other once the registry
// is full — and it leaves nothing behind when it is.
func TestForkIsRefusedOverTheCap(t *testing.T) {
	store := newTestConversationStore(t)
	store.MaxConversations = 1
	source := mustCreate(t, store, "units")

	if _, err := store.Fork(source.ID, "someone", "", claudeForkTarget()); err == nil {
		t.Fatal("fork over the cap = nil, want a refusal")
	}
	if got := len(store.List(true)); got != 1 {
		t.Errorf("conversations after a refused fork = %d, want the source alone", got)
	}
}

// A fork of an unknown or malformed id is the same two mistakes every other entry point tells apart.
func TestForkOfANonConversation(t *testing.T) {
	store := newTestConversationStore(t)
	if _, err := store.Fork("conv-1700000000000-abcd", "someone", "", claudeForkTarget()); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("fork of an unknown id = %v, want os.ErrNotExist", err)
	}
	if _, err := store.Fork("../escape", "someone", "", claudeForkTarget()); !errors.Is(err, errBadConversationID) {
		t.Errorf("fork of a malformed id = %v, want errBadConversationID", err)
	}
}

// The suffix is what a switcher full of forks is read by, so it is the source title that gives way
// when the two do not fit — a row that lost the marker could not be told from the original.
func TestForkTitleKeepsItsMarker(t *testing.T) {
	long := strings.Repeat("a", maxTitleRunes)
	cases := map[string]string{
		"short":   "Notes",
		"blank":   "",
		"at cap":  long,
		"a fork":  "Notes (fork)",
		"spacing": "  Notes   again  ",
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			title := forkTitle(source)
			if !strings.HasSuffix(title, forkTitleSuffix) {
				t.Errorf("forkTitle(%q) = %q, want it to end in %q", source, title, forkTitleSuffix)
			}
			if got := len([]rune(title)); got > maxTitleRunes {
				t.Errorf("forkTitle(%q) = %d runes, want at most %d", source, got, maxTitleRunes)
			}
			// Whatever comes out is a title, so it must survive the store's own normalisation
			// unchanged — otherwise the fork is named one thing and stored as another.
			if normalised := NormaliseTitle(title); normalised != title {
				t.Errorf("forkTitle(%q) = %q, normalised to %q", source, title, normalised)
			}
		})
	}
}

// claudeForkTarget is a fork onto the agent the source is already on — the ordinary case, and the
// only one the store itself can be asked about without a registry. What the handler works out and
// passes in is which agent the copy runs on and whether that agent can branch a session; Claude
// can, so a fork of a conversation with a session carries it.
func claudeForkTarget() ForkTarget {
	return ForkTarget{Agent: agentapi.AgentClaude, Label: "Claude", Branches: true}
}

// A fork is a link, and a title is neither unique nor stable: the copy names the conversation it
// was forked from by id, and the message it branched at, where renaming the source cannot break
// the link. The notice keeps the title for a reader; the metadata keeps the ids for anything that
// has to follow them after the notice has been compacted away.
func TestForkNamesItsSourceByID(t *testing.T) {
	store := newTestConversationStore(t)
	source := mustCreate(t, store, "units")
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "first"}, nil)
	prompt := mustMessages(t, store, source.ID)[0]
	mustAppend(t, store, source.ID, ConversationRecord{Role: RoleUser, Text: "second"}, nil)

	forked, err := store.Fork(source.ID, "someone", prompt.ID, claudeForkTarget())
	if err != nil {
		t.Fatal(err)
	}
	if forked.ForkedFrom != source.ID || forked.ForkedFromMessage != prompt.ID {
		t.Errorf("fork meta = %+v, want the source id and the branch message", forked)
	}
	records := mustMessages(t, store, forked.ID)
	notice := records[len(records)-1]
	if notice.Role != RoleNotice || notice.ForkFrom != source.ID || notice.ForkFromMessage != prompt.ID {
		t.Errorf("fork notice = %+v, want the source id beside the title", notice)
	}

	whole, err := store.Fork(source.ID, "someone", "", claudeForkTarget())
	if err != nil {
		t.Fatal(err)
	}
	if whole.ForkedFrom != source.ID || whole.ForkedFromMessage != "" {
		t.Errorf("whole fork meta = %+v, want the source id and no branch message", whole)
	}
	if meta, err := store.Get(source.ID); err != nil || meta.ForkedFrom != "" {
		t.Errorf("source meta = %+v, want the source itself untouched", meta)
	}
}

// A settled turn names its turn on the record that closes it — even one the service was killed in
// the middle of, which has no job left to ask. The running marker carries the id for exactly that.
func TestSweepInterruptedNamesTheTurnItCloses(t *testing.T) {
	store := newTestConversationStore(t)
	meta := mustCreate(t, store, "units")
	mustAppend(t, store, meta.ID, ConversationRecord{Role: RoleUser, Text: "a long job", TurnID: "turn-9"},
		func(m *ConversationMeta) { m.RunningAt, m.RunningTurn = protocol.NowConversationTime(), "turn-9" })

	restarted, err := NewConversationStore(store.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if n := restarted.SweepInterrupted(); n != 1 {
		t.Fatalf("sweepInterrupted() = %d, want 1", n)
	}
	records := mustMessages(t, restarted, meta.ID)
	if len(records) != 2 || records[1].TurnID != "turn-9" || records[1].EndReason == "" {
		t.Errorf("records = %+v, want the settle record naming its turn and why it ended", records)
	}
	if after, _ := restarted.Get(meta.ID); after.RunningTurn != "" {
		t.Errorf("meta = %+v, want the running turn cleared with the marker", after)
	}
}

// The turn around the reply is held to the same caps as the reply itself: the composed message to
// the prompt's, the briefing and the instructions shorter, the asks to the newest hundred, and
// every tool result to what a transcript can show.
func TestNormaliseRecordCapsTheTurnAroundTheReply(t *testing.T) {
	asks := make([]ConversationAsk, 0, maxRecordAsks+10)
	for i := 0; i < maxRecordAsks+10; i++ {
		asks = append(asks, ConversationAsk{ID: "req", Tool: "Edit", Outcome: AskOutcomeAllow})
	}
	rec := normaliseRecord(ConversationRecord{
		Role:           RoleAssistant,
		ComposedPrompt: strings.Repeat("c", maxRecordChars+10),
		SystemPrompt:   strings.Repeat("s", maxRecordBriefingChars+10),
		Instructions:   strings.Repeat("i", maxRecordBriefingChars+10),
		Asks:           asks,
		Blocks: []ConversationBlock{{
			Kind: agentapi.BlockKindToolUse, Name: "Bash",
			Result: strings.Repeat("r", protocol.MaxBlockResultChars+10),
		}},
	})
	if !rec.Truncated {
		t.Error("an over-cap record came back unmarked")
	}
	if got := len([]rune(rec.ComposedPrompt)); got > maxRecordChars+len([]rune(protocol.TruncationMarker)) {
		t.Errorf("composed prompt = %d runes, want it held to the prompt's cap", got)
	}
	for name, text := range map[string]string{"system": rec.SystemPrompt, "instructions": rec.Instructions} {
		if got := len([]rune(text)); got > maxRecordBriefingChars+len([]rune(protocol.TruncationMarker)) {
			t.Errorf("%s = %d runes, want it held to the briefing's cap", name, got)
		}
	}
	if len(rec.Asks) != maxRecordAsks {
		t.Errorf("asks = %d, want the newest %d", len(rec.Asks), maxRecordAsks)
	}
	if got := len([]rune(rec.Blocks[0].Result)); got > protocol.MaxBlockResultChars+len([]rune(protocol.TruncationMarker)) {
		t.Errorf("tool result = %d runes, want it held to what a transcript can show", got)
	}
}
