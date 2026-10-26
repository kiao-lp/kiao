package runnerhttp

import (
	"encoding/json"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/playback"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// readChainRunLogLines reads run.jsonl whole, one decoded object per line.
func readChainRunLogLines(t *testing.T, path string) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the run log: %v", err)
	}
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("decode %q: %v", line, err)
		}
		out = append(out, rec)
	}
	return out
}

// logKinds is every record's kind, in order — what a test asserts the shape of a play with.
func logKinds(records []map[string]any) []string {
	kinds := make([]string, 0, len(records))
	for _, rec := range records {
		kind, _ := rec["kind"].(string)
		kinds = append(kinds, kind)
	}
	return kinds
}

func TestChainRunLogCreateWritesMetaAndStart(t *testing.T) {
	store := playback.NewChainRunLogStore(t.TempDir())
	if store == nil {
		t.Fatal("no store for a writable state directory")
	}
	id := "run-1790179938262-9742"
	store.Create(id, "Nightly", "boards/major", "flow-node-1", "tester", time.Now())

	dir := filepath.Join(store.Dir, id)
	if info, err := os.Stat(dir); err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		t.Errorf("run dir = %v, want a directory at 0700", info)
	}
	var meta playback.ChainRunLogMeta
	data, err := os.ReadFile(filepath.Join(dir, playback.ChainRunMetaFileName))
	if err != nil {
		t.Fatalf("read meta.json: %v", err)
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		t.Fatalf("decode meta.json: %v", err)
	}
	if meta.ID != id || meta.Name != "Nightly" || meta.Board != "boards/major" ||
		meta.RootFlowNode != "flow-node-1" || meta.Owner != "tester" || meta.State != playback.ChainRunStatePlaying {
		t.Errorf("meta = %+v, want the run's identity", meta)
	}
	if info, err := os.Stat(filepath.Join(dir, playback.ChainRunMetaFileName)); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("meta.json perm = %v, want 0600", info)
	}
	records := readChainRunLogLines(t, filepath.Join(dir, playback.ChainRunLogFileName))
	if len(records) != 1 || records[0]["kind"] != playback.ChainRunLogKindNote {
		t.Fatalf("records = %v, want the single started note", logKinds(records))
	}
	if text, _ := records[0]["text"].(string); !strings.Contains(text, "boards/major") {
		t.Errorf("started note = %q, want the board named", text)
	}
}

func TestChainRunLogRecords(t *testing.T) {
	store := playback.NewChainRunLogStore(t.TempDir())
	id := "run-1790179938262-9742"
	store.Create(id, "Nightly", "boards/major", "flow-node-1", "tester", time.Now())

	exit := 0
	store.Note(id, "flow-node-1", "conv-1", runstate.NoticeWarning, "played again at 12:20")
	store.State(id, "flow-node-1", "conv-1", playback.ChainRunStateWaiting)
	store.Turn(id, "flow-node-1", "conv-1", playback.ChainRunTurnOutcome{
		Prompt: playback.ChainRunPromptCard, Agent: "claude", Model: "sonnet",
		Effort: "high", Permission: "bypassPermissions", ExitCode: &exit,
		Fault: &agentfaults.TurnFault{Summary: "the API is at capacity", Retry: true},
	})
	store.Chain(id, "flow-node-1", playback.ChainRunChainDecision{
		Done: pkgBoards.FlowNode{ID: "flow-node-1",
			Settings:  pkgBoards.FlowNodeSettings{Folder: "/corpora"},
			OnSuccess: pkgBoards.FlowNodeSuccess{FlowNode: "flow-node-2", Mode: pkgBoards.TransitionContinue}},
		NextID: "flow-node-2", ToFolder: "", From: "conv-1", Decision: playback.ChainRunChainFolderMismatch,
	})
	store.Wait(id, "flow-node-1", "conv-1", playback.ChainRunStateWaiting,
		time.Date(2026, 9, 24, 12, 20, 0, 0, time.UTC), "the API is at capacity")

	records := readChainRunLogLines(t, filepath.Join(store.Dir, id, playback.ChainRunLogFileName))
	if kinds := logKinds(records); len(kinds) != 6 ||
		kinds[1] != playback.ChainRunLogKindNote || kinds[2] != playback.ChainRunLogKindState ||
		kinds[3] != playback.ChainRunLogKindTurn || kinds[4] != playback.ChainRunLogKindChain ||
		kinds[5] != playback.ChainRunLogKindWait {
		t.Fatalf("kinds = %v, want one record of each kind after the start", kinds)
	}
	turn := records[3]
	if turn["prompt"] != playback.ChainRunPromptCard || turn["agent"] != "claude" || turn["model"] != "sonnet" {
		t.Errorf("turn = %v, want what the turn ran on", turn)
	}
	if turn["fault"] != "the API is at capacity" || turn["faultRetry"] != true {
		t.Errorf("turn = %v, want the fault and whether it is worth waiting out", turn)
	}
	if _, stopped := turn["stopped"]; stopped {
		t.Errorf("turn = %v, want no stopped flag on a turn that finished", turn)
	}
	chain := records[4]
	if chain["next"] != "flow-node-2" || chain["mode"] != pkgBoards.TransitionContinue {
		t.Errorf("chain = %v, want what the finished card says comes after it", chain)
	}
	if chain["fromFolder"] != "corpora" || chain["decision"] != playback.ChainRunChainFolderMismatch {
		t.Errorf("chain = %v, want the normalised folders and the branch taken", chain)
	}
	if _, ok := chain["toFolder"]; ok {
		t.Errorf("chain = %v, want the store root left out rather than sent as an empty folder", chain)
	}
	wait := records[5]
	if wait["until"] != "2026-09-24T12:20:00.000Z" || wait["reason"] != "the API is at capacity" {
		t.Errorf("wait = %v, want the moment and what is being waited out", wait)
	}
}

// A log that cannot be kept costs the debugging and never the run: every entry point is safe on
// a nil store, on an empty state directory, and on an id that names nothing — including one
// trying to leave the directory.
func TestChainRunLogNeverFailsARun(t *testing.T) {
	if store := playback.NewChainRunLogStore(""); store != nil {
		t.Errorf("store for an empty state path = %v, want nil", store)
	}
	var store *playback.ChainRunLogStore
	now := time.Now()
	store.Create("run-1790179938262-9742", "n", "b", "f", "o", now)
	store.Finish("run-1790179938262-9742", playback.ChainRunStateEnded, "done", now)
	store.Restarted("run-1790179938262-9742", "f", now)
	store.Resumed("run-1790179938262-9742", "f", "c")
	store.Note("run-1790179938262-9742", "f", "c", runstate.NoticeInfo, "hi")
	store.Note("run-1790179938262-9742", "f", "c", runstate.NoticeInfo, "   ")
	store.State("run-1790179938262-9742", "f", "c", playback.ChainRunStatePlaying)
	store.Turn("run-1790179938262-9742", "f", "c", playback.ChainRunTurnOutcome{Prompt: playback.ChainRunPromptCard})
	store.Chain("run-1790179938262-9742", "f", playback.ChainRunChainDecision{Decision: playback.ChainRunChainEnd})
	store.Wait("run-1790179938262-9742", "f", "c", playback.ChainRunStateWaiting, now, "")
	store.WriteMeta("run-1790179938262-9742", nil)
	store.Append("run-1790179938262-9742", "nope")

	real := playback.NewChainRunLogStore(t.TempDir())
	for _, id := range []string{"", "run-123", "../conversations", "run-1790179938262-9742/x"} {
		real.Create(id, "n", "b", "f", "o", now)
		real.Note(id, "f", "c", runstate.NoticeInfo, "hi")
		real.State(id, "f", "c", playback.ChainRunStatePlaying)
		real.Finish(id, playback.ChainRunStateEnded, "done", now)
	}
	if entries, err := os.ReadDir(real.Dir); err != nil || len(entries) != 0 {
		t.Errorf("entries = %v, %v, want nothing written for ids that are not runs", entries, err)
	}

	var runner *playback.ChainRunner
	runner.LogNote(nil, "f", "c", runstate.NoticeInfo, "hi")
	runner.LogState(nil, "f", "c", playback.ChainRunStatePlaying)
	runner.LogTurn(nil, "f", "c", playback.ChainRunTurnOutcome{})
	runner.LogChain(nil, "f", playback.ChainRunChainDecision{})
	runner.LogWait(nil, "f", "c", playback.ChainRunStateWaiting, now, "")
	(&playback.ChainRunner{}).LogNote(nil, "f", "c", runstate.NoticeInfo, "hi")
}

func TestPruneChainRunLogsKeepsTheNewestAndTheForeign(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"run-1790179938000-0001", "run-1790179938000-0002", "run-1790179938000-0003",
		"run-1790179938000-0004", "run-1790179938000-0005",
	} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	// Something else's: a directory and a file the prune must not touch, whatever they are
	// called — including a name in the shape of a run that is not a directory.
	if err := os.Mkdir(filepath.Join(dir, "mine"), 0o700); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(dir, "notes.txt"), "leave me alone")
	mustWrite(t, filepath.Join(dir, "run-1790179938000-0009"), "not a directory")

	playback.PruneChainRunLogs(dir, 2)

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, entry := range entries {
		names[entry.Name()] = true
	}
	for _, want := range []string{"run-1790179938000-0004", "run-1790179938000-0005", "mine", "notes.txt", "run-1790179938000-0009"} {
		if !names[want] {
			t.Errorf("remaining = %v, want %s kept", names, want)
		}
	}
	if len(names) != 5 {
		t.Errorf("remaining = %v, want the three oldest runs gone and nothing else touched", names)
	}
}

func TestChainRunLogCutsOneLongRecord(t *testing.T) {
	store := playback.NewChainRunLogStore(t.TempDir())
	id := "run-1790179938262-9742"
	store.Create(id, "n", "b", "f", "o", time.Now())
	store.Note(id, "f", "c", runstate.NoticeError, strings.Repeat("x", playback.MaxChainRunLogLineChars*2))

	data, err := os.ReadFile(filepath.Join(store.Dir, id, playback.ChainRunLogFileName))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("%d lines, want the start and the cut note", len(lines))
	}
	if !strings.HasSuffix(lines[1], "…[cut]") || len(lines[1]) > playback.MaxChainRunLogLineChars+len(" …[cut]") {
		t.Errorf("cut line is %d chars without the marker, want it held at the cap", len(lines[1]))
	}
}

func TestChainRunLogStopsAtItsSizeLimit(t *testing.T) {
	store := playback.NewChainRunLogStore(t.TempDir())
	id := "run-1790179938262-9742"
	store.Create(id, "n", "b", "f", "o", time.Now())
	filler := strings.Repeat("x", 4096)
	for i := 0; i < 300; i++ {
		store.Note(id, "f", "c", runstate.NoticeInfo, filler)
	}
	path := filepath.Join(store.Dir, id, playback.ChainRunLogFileName)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(before)), "\n")
	if len(lines) >= 300 {
		t.Fatalf("%d lines, want the file stopped rather than the filler kept whole", len(lines))
	}
	var last map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &last); err != nil {
		t.Fatalf("decode the last line: %v", err)
	}
	if text, _ := last["text"].(string); !strings.Contains(text, "size limit") {
		t.Errorf("last line = %q, want the marker saying the log stopped", text)
	}
	// Past the marker nothing is kept — and nothing fails.
	store.Note(id, "f", "c", runstate.NoticeInfo, "one more")
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("log grew past its marker, want every record after it dropped")
	}
}

func TestChainRunLogFinishRestartResume(t *testing.T) {
	store := playback.NewChainRunLogStore(t.TempDir())
	id := "run-1790179938262-9742"
	started := time.Now()
	store.Create(id, "Nightly", "boards/major", "flow-node-1", "tester", started)

	ended := started.Add(time.Minute)
	store.Finish(id, playback.ChainRunStateEnded, "Stopped.", ended)
	var finished playback.ChainRunLogMeta
	readChainRunLogMeta(t, store.Dir, id, &finished)
	if finished.State != playback.ChainRunStateEnded || finished.Ending != "Stopped." || finished.EndedAt == "" {
		t.Errorf("meta after finish = %+v, want the ending filed", finished)
	}

	// A fresh value per read: the cleared fields are absent from the file, and unmarshalling
	// over the previous read would keep their old values.
	restarted := ended.Add(time.Minute)
	store.Restarted(id, "flow-node-1", restarted)
	var replayed playback.ChainRunLogMeta
	readChainRunLogMeta(t, store.Dir, id, &replayed)
	if replayed.State != playback.ChainRunStatePlaying || replayed.Ending != "" || replayed.EndedAt != "" {
		t.Errorf("meta after restart = %+v, want the ending cleared and the play current", replayed)
	}
	if want := restarted.UTC().Format(protocol.ConversationTimeFormat); replayed.StartedAt != want {
		t.Errorf("startedAt = %q, want the restart's own %q", replayed.StartedAt, want)
	}

	store.Resumed(id, "flow-node-1", "conv-1")
	var pickedUp playback.ChainRunLogMeta
	readChainRunLogMeta(t, store.Dir, id, &pickedUp)
	if pickedUp.State != playback.ChainRunStatePlaying || pickedUp.Ending != "" || pickedUp.EndedAt != "" {
		t.Errorf("meta after resume = %+v, want the run current", pickedUp)
	}
	records := readChainRunLogLines(t, filepath.Join(store.Dir, id, playback.ChainRunLogFileName))
	if kinds := logKinds(records); len(kinds) != 4 {
		t.Fatalf("kinds = %v, want the start and one note per boundary in the one file", kinds)
	}
}

func readChainRunLogMeta(t *testing.T, dir, id string, meta *playback.ChainRunLogMeta) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, id, playback.ChainRunMetaFileName))
	if err != nil {
		t.Fatalf("read meta.json: %v", err)
	}
	if err := json.Unmarshal(data, meta); err != nil {
		t.Fatalf("decode meta.json: %v", err)
	}
}

// A played chain files its play: the turns it sent, the fork it took, and the ending it stopped
// on — the records a run that stopped in the night is diagnosed from.
func TestChainRunWritesItsLog(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(pkgBoards.TransitionContinue))
	rt.answers("The first answer.", "The second answer.")

	rt.play("flow-node-1")
	rt.waitIdle()

	run := rt.last()
	if run == nil || run.State != playback.ChainRunStateEnded {
		t.Fatalf("run = %+v, want the chain played to its end", run)
	}
	dir := filepath.Join(rt.cfg.StatePath, playback.ChainRunsDirName, run.ID)
	var meta playback.ChainRunLogMeta
	readChainRunLogMeta(t, filepath.Join(rt.cfg.StatePath, playback.ChainRunsDirName), run.ID, &meta)
	if meta.Board != rt.handle || meta.RootFlowNode != "flow-node-1" || meta.Owner != "tester" {
		t.Errorf("meta = %+v, want the run's identity", meta)
	}
	// The ending is filed under the same lock that moves the run to ended, so once the run
	// reads as ended the whole play is on disk — nothing to wait for.
	records := readChainRunLogLines(t, filepath.Join(dir, playback.ChainRunLogFileName))
	var turns int
	var chains []map[string]any
	for _, rec := range records {
		switch rec["kind"] {
		case playback.ChainRunLogKindTurn:
			turns++
			if rec["prompt"] != playback.ChainRunPromptCard || rec["agent"] == "" {
				t.Errorf("turn = %v, want what the turn was sent as and ran on", rec)
			}
		case playback.ChainRunLogKindChain:
			chains = append(chains, rec)
		}
	}
	if turns != 2 {
		t.Errorf("turns = %d, want one record per flow node played", turns)
	}
	// Every card files its handoff: the fork the first card took, and the chain running out on
	// the second.
	if len(chains) != 2 || chains[0]["decision"] != playback.ChainRunChainForked ||
		chains[1]["decision"] != playback.ChainRunChainEnd || chains[1]["flowNode"] != "flow-node-2" {
		t.Fatalf("chains = %v, want the fork and then the chain running out", chains)
	}
	forked, _ := chains[0]["forked"].(string)
	if forked == "" {
		t.Fatalf("chain = %v, want the copy the handoff made", chains[0])
	}
	if forked != "" {
		if _, err := rt.convs.Get(forked); err != nil {
			t.Errorf("forked chat %q is not a conversation: %v", forked, err)
		}
	}
	last := records[len(records)-1]
	if last["kind"] != playback.ChainRunLogKindNote || !strings.Contains(last["text"].(string), "run ended") {
		t.Errorf("last = %v, want the ending filed last", last)
	}
}

// The compact + continue stop: the first card shortens its chat, and the chain then refuses to
// hand that chat to a card running in another folder. The log carries the compaction, the two
// folders as the guard compared them, and the branch the chain ended on.
func TestChainRunLogsTheFolderMismatch(t *testing.T) {
	rt := newRunnerTest(t, chainBoardCompacting(pkgBoards.TransitionContinue))
	mustMkdir(t, rt.root, "corpora")
	rt.editFlowNode("flow-node-1", func(flowNode *pkgBoards.FlowNode) { flowNode.Settings.Folder = "/corpora" })

	rt.play("flow-node-1")
	rt.waitIdle()

	run := rt.last()
	if run == nil || run.State != playback.ChainRunStateEnded {
		t.Fatalf("run = %+v, want the play stopped after the first flow node", run)
	}
	if board := rt.board(); board.FlowNode("flow-node-1").Status != pkgBoards.FlowNodeStatusDone {
		t.Fatalf("first status = %q, want the first flow node done",
			board.FlowNode("flow-node-1").Status)
	}
	dir := filepath.Join(rt.cfg.StatePath, playback.ChainRunsDirName, run.ID)
	records := readChainRunLogLines(t, filepath.Join(dir, playback.ChainRunLogFileName))
	var compacts int
	var mismatch map[string]any
	for _, rec := range records {
		if rec["kind"] == playback.ChainRunLogKindTurn && rec["prompt"] == playback.ChainRunPromptCompact {
			compacts++
		}
		if rec["kind"] == playback.ChainRunLogKindChain {
			mismatch = rec
		}
	}
	if compacts != 1 {
		t.Errorf("compactions = %d, want the chat shortened before the handoff", compacts)
	}
	if mismatch == nil {
		t.Fatalf("kinds = %v, want the handoff that ended the chain", logKinds(records))
	}
	if mismatch["decision"] != playback.ChainRunChainFolderMismatch ||
		mismatch["fromFolder"] != "corpora" || mismatch["next"] != "flow-node-2" {
		t.Errorf("chain = %v, want the mismatch and the two folders it compared", mismatch)
	}
	if _, ok := mismatch["toFolder"]; ok {
		t.Errorf("chain = %v, want the store root read as the empty folder", mismatch)
	}
}

// A state written by an older build still carries its run logs under `workflow-runs`: the first
// open moves them to `chain-runs`, and a second open has nothing left to move.
func TestChainRunLogStoreCarriesLegacyLogsOver(t *testing.T) {
	state := t.TempDir()
	id := "run-1790179938262-9742"
	legacy := filepath.Join(state, playback.LegacyChainRunsDirName, id)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatalf("write the legacy logs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, playback.ChainRunMetaFileName), []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write the legacy meta: %v", err)
	}

	store := playback.NewChainRunLogStore(state)
	if store == nil {
		t.Fatal("no store for a writable state directory")
	}
	if _, err := os.Stat(filepath.Join(state, playback.ChainRunsDirName, id, playback.ChainRunMetaFileName)); err != nil {
		t.Errorf("carried meta: %v, want the legacy run under chain-runs", err)
	}
	if _, err := os.Stat(filepath.Join(state, playback.LegacyChainRunsDirName)); !os.IsNotExist(err) {
		t.Errorf("legacy dir = %v, want nothing left under workflow-runs", err)
	}

	again := playback.NewChainRunLogStore(state)
	if again == nil {
		t.Fatal("no store on the second open")
	}
	if _, err := os.Stat(filepath.Join(state, playback.ChainRunsDirName, id, playback.ChainRunMetaFileName)); err != nil {
		t.Errorf("carried meta after the second open: %v", err)
	}
}
