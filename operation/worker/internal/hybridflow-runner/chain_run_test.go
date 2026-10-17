package hybridflowrunner

import (
	"context"
	"encoding/json"
	"kiao/worker/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Playing a board, end to end: a real runner, a real conversation registry, a board held in
// memory and a stand-in for the CLI. **No socket is opened by any of these tests**, which is the
// point of the feature — a run has to reach its end with nobody connected.

// runnerTest is one runner over a temp store, with a fake `claude` on the path.
type runnerTest struct {
	t       *testing.T
	runner  *ChainRunner
	hub     *ClaudeHub
	convs   *ConversationStore
	cfg     *Config
	root    string
	binDir  string
	handle  string
	boards  *memoryBoards
	replies chan string
}

// newRunnerTest builds the runner and the board it plays: `board` is the service-shaped JSON of
// one board, held in memory under the `major` handle, claims included.
func newRunnerTest(t *testing.T, board string) *runnerTest {
	t.Helper()
	convs, cfg := newTurnRegistry(t)
	hub := newClaudeHub(cfg, convs)
	var held boardContent
	if err := json.Unmarshal([]byte(board), &held); err != nil {
		t.Fatalf("decode the board: %v", err)
	}
	boards := newMemoryBoards(t, map[string]*boardContent{"major": &held})
	runner := newChainRunner(cfg, hub, convs, boards, nil, nil)
	hub.chainRunner = runner
	// A whole chain in milliseconds. The waits themselves are pinned by the retry test, which reads
	// the moment the run says it will try again rather than sitting through it.
	runner.retryWait = 10 * time.Millisecond
	runner.resumeWindow = 300 * time.Millisecond
	// The minute a run leaves past the moment a limit says it lifts. The moment itself is the
	// notice's and is not a clock this end can wind on, so a test that wants a limit waited out in
	// milliseconds writes a notice naming a moment already gone — see the refresh tests.
	runner.refreshLeeway = 10 * time.Millisecond
	// The grace before the machine goes off is a courtesy to the tabs about to lose their service,
	// and nothing waits on it here. The command itself is nil until a test asks for one — the
	// configuration a test builds names none, so this is belt and braces on the one field in this
	// service that could reach past it.
	runner.shutdownGrace = time.Millisecond
	runner.shutdown = nil

	rt := &runnerTest{
		t: t, runner: runner, hub: hub, convs: convs, cfg: cfg,
		root: cfg.RootPath, binDir: t.TempDir(), handle: "major", boards: boards,
	}
	rt.fakeCLI()
	return rt
}

// fakeCLI writes the stand-in for the `claude` binary: it reads the prompt frame off its stdin,
// records it, and answers with whatever events the test has queued for that turn.
//
// A real process rather than a hand-built job, because what these tests are about is the run
// driving a turn to its end — the spawn, the stream, the settling and the transcript record the
// reply is read back from.
func (rt *runnerTest) fakeCLI() {
	rt.t.Helper()
	script := "#!/bin/sh\n" +
		// The trace probes the version during spawn. That probe is not a turn and
		// must not race the real process for the queued responses or turn counter.
		"if [ \"$1\" = \"--version\" ]; then echo 'claude-fixture'; exit 0; fi\n" +
		"dir=$(dirname \"$0\")\n" +
		// What the turn was spawned with, one argument per line: the flags carry the model, the
		// effort and the system prompt, which the prompt frame on stdin says nothing about.
		"printf '%s\\n' \"$@\" >> \"$dir/args.jsonl\"\n" +
		"read -r line\n" +
		"printf '%s\\n' \"$line\" >> \"$dir/prompts.jsonl\"\n" +
		"n=$(cat \"$dir/turn\" 2>/dev/null || echo 1)\n" +
		"echo $((n + 1)) > \"$dir/turn\"\n" +
		"if [ -f \"$dir/events-$n.jsonl\" ]; then cat \"$dir/events-$n.jsonl\"; else cat \"$dir/events.jsonl\"; fi\n" +
		// The CLI's own ending: with stream-json input it waits for another frame after it has
		// answered, and it is the service closing stdin on the `result` event that lets it exit. A
		// queued turn that emits no `result` therefore stays alive until something kills it, which is
		// what the tests about stopping need.
		"cat > /dev/null\n"
	path := filepath.Join(rt.binDir, "claude-stub")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		rt.t.Fatal(err)
	}
	rt.hub.agents.set(agentClaude, claudeAgentAt(rt.cfg, path))
	rt.answers("Done.")
}

// answers queues what the CLI says, one turn per argument; the last one answers every turn after
// it.
func (rt *runnerTest) answers(replies ...string) {
	rt.t.Helper()
	_ = os.Remove(filepath.Join(rt.binDir, "turn"))
	for i, reply := range replies {
		events := reply
		if !strings.HasPrefix(reply, "{") {
			events = rt.textEvents(reply)
		}
		name := "events.jsonl"
		if i < len(replies)-1 {
			name = "events-" + string(rune('1'+i)) + ".jsonl"
		}
		if err := os.WriteFile(filepath.Join(rt.binDir, name), []byte(events), 0o644); err != nil {
			rt.t.Fatal(err)
		}
	}
}

// textEvents is a turn that says one thing and ends, in the CLI's own stream-json.
func (rt *runnerTest) textEvents(text string) string {
	block, _ := json.Marshal(map[string]any{
		"type":    "assistant",
		"message": map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}},
	})
	return `{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		string(block) + "\n" +
		`{"type":"result","subtype":"success"}` + "\n"
}

// blockEvents is a turn that says several things and ends — one assistant event per block, which is
// how the CLI writes a reply it composes as it goes, and how it puts an API error or a subscription
// limit *after* everything the turn had already said.
func (rt *runnerTest) blockEvents(texts ...string) string {
	out := `{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n"
	for _, text := range texts {
		block, _ := json.Marshal(map[string]any{
			"type":    "assistant",
			"message": map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}},
		})
		out += string(block) + "\n"
	}
	return out + `{"type":"result","subtype":"success"}` + "\n"
}

// invoked is what the CLI was spawned with, every turn's flags in one text: the model, the
// effort and the system prompt travel there rather than in the prompt frame.
func (rt *runnerTest) invoked() string {
	rt.t.Helper()
	data, err := os.ReadFile(filepath.Join(rt.binDir, "args.jsonl"))
	if err != nil {
		return ""
	}
	return string(data)
}

// prompts is what the CLI was actually asked, in order.
func (rt *runnerTest) prompts() []string {
	rt.t.Helper()
	data, err := os.ReadFile(filepath.Join(rt.binDir, "prompts.jsonl"))
	if err != nil {
		return nil
	}
	out := []string{}
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var frame struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &frame) == nil {
			out = append(out, frame.Message.Content)
		}
	}
	return out
}

// powersOff gives the runner a machine to turn off, and hands back the channel that is closed when
// it is asked to — no test turns a real one off, which is the whole reason the runner holds the
// command as a field.
func (rt *runnerTest) powersOff() chan struct{} {
	rt.t.Helper()
	asked := make(chan struct{})
	rt.runner.shutdown = func() error {
		close(asked)
		return nil
	}
	return asked
}

// wentOff reports whether the machine was asked to go off, giving a run that is ending a moment to
// get round to it.
func (rt *runnerTest) wentOff(asked chan struct{}) bool {
	rt.t.Helper()
	select {
	case <-asked:
		return true
	case <-time.After(2 * time.Second):
		return false
	}
}

// board reads the board back as the store holds it.
func (rt *runnerTest) board() *boardContent {
	rt.t.Helper()
	board, err := rt.runner.boards.Board(rt.handle)
	if err != nil {
		rt.t.Fatalf("read the board back: %v", err)
	}
	return board
}

// play starts a run and fails the test if it is refused.
func (rt *runnerTest) play(flowNodeID string) {
	rt.t.Helper()
	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, flowNodeID, ""); err != nil {
		rt.t.Fatalf("play %s: %v", flowNodeID, err)
	}
}

// liveRuns is every run still playing. An ended run stays in the list, so this is what "is anything
// still going" means here.
func (rt *runnerTest) liveRuns() []*AgentChainRunDto {
	rt.t.Helper()
	var out []*AgentChainRunDto
	for _, run := range rt.runner.snapshots() {
		if run.State != chainRunStateEnded {
			out = append(out, run)
		}
	}
	return out
}

// live is the one run still playing, or nil. Most tests here start one run and ask what it is
// doing; two would make the question meaningless, so it says so rather than picking one.
func (rt *runnerTest) live() *AgentChainRunDto {
	rt.t.Helper()
	runs := rt.liveRuns()
	if len(runs) > 1 {
		rt.t.Fatalf("%d runs are live, and this asks about one", len(runs))
	}
	if len(runs) == 0 {
		return nil
	}
	return runs[0]
}

// last is the newest run the runner holds, live or ended — what a test asks after the run is over.
func (rt *runnerTest) last() *AgentChainRunDto {
	rt.t.Helper()
	runs := rt.runner.snapshots()
	if len(runs) == 0 {
		return nil
	}
	return runs[len(runs)-1]
}

// stop ends the live run, which is the one every test that calls this has.
func (rt *runnerTest) stop() {
	rt.t.Helper()
	run := rt.live()
	if run == nil {
		rt.t.Fatal("nothing is playing to stop")
	}
	if err := rt.runner.stop(run.ID); err != nil {
		rt.t.Fatalf("stop %s: %v", run.ID, err)
	}
}

// waitIdle waits for every run to end. A run that never ends is a failed test, not a hung one.
func (rt *runnerTest) waitIdle() {
	rt.t.Helper()
	rt.waitFor("every run to end", func() bool { return len(rt.liveRuns()) == 0 })
}

// waitState waits for the run to be in one of the states named.
func (rt *runnerTest) waitState(states ...string) *AgentChainRunDto {
	rt.t.Helper()
	var run *AgentChainRunDto
	rt.waitFor("the run to be "+strings.Join(states, " or "), func() bool {
		run = rt.live()
		if run == nil {
			return false
		}
		for _, state := range states {
			if run.State == state {
				return true
			}
		}
		return false
	})
	return run
}

// waitTurn waits for the run to have a turn actually running, and reports it. The chat is part of
// what it waits for: a run is `playing` from the moment it starts working towards a flow node,
// which is before the conversation it will be played in exists.
func (rt *runnerTest) waitTurn() *AgentChainRunDto {
	rt.t.Helper()
	var run *AgentChainRunDto
	rt.waitFor("a turn to be running", func() bool {
		run = rt.live()
		return run != nil && run.Chat != "" && rt.hub.isRunning(run.Chat)
	})
	return run
}

// waitSaid waits for the running turn to have said something, so a test that then stops it is
// stopping a turn with a reply to file rather than one killed before it spoke.
func (rt *runnerTest) waitSaid(chat string) {
	rt.t.Helper()
	rt.waitFor("the turn to have said something", func() bool {
		job := rt.hub.getJob(chat)
		if job == nil {
			return false
		}
		job.mu.Lock()
		defer job.mu.Unlock()
		return len(job.blocks) > 0
	})
}

func (rt *runnerTest) waitFor(what string, ready func() bool) {
	rt.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			run := rt.live()
			rt.t.Fatalf("timed out waiting for %s; the run is %+v", what, run)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// chainBoard is two chained flow nodes, the transition mode of the first saying what the second is
// given of its chat.
func chainBoard(mode string) string {
	return `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.",
		 "settings":{"agent":"claude","model":"opus","effort":"high","permission":"bypassPermissions","folder":"/"},
		 "onSuccess":{"flowNode":"flow-node-2","mode":"` + mode + `"}},
		{"id":"flow-node-2","title":"Second","body":"Do the second thing.",
		 "settings":{"agent":"claude","model":"sonnet","effort":"low","permission":"bypassPermissions","folder":"/"}}
	]}`
}

// chainBoardCompacting is the same board with the first card asking for its chat to be shortened
// when it ends. It is the box beside the mode, and a different question: who gets the conversation
// next is one thing, what this card leaves it as is another.
func chainBoardCompacting(mode string) string {
	return strings.Replace(chainBoard(mode),
		`"mode":"`+mode+`"`, `"mode":"`+mode+`","compact":true`, 1)
}

// twoChainBoard is two chains of two cards on one board, sharing nothing: what two runs playing
// side by side look like.
func twoChainBoard() string {
	const settings = `"settings":{"agent":"claude","model":"opus","effort":"high",` +
		`"permission":"bypassPermissions","folder":"/"}`
	return `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.",` + settings + `,
		 "onSuccess":{"flowNode":"flow-node-2","mode":"end"}},
		{"id":"flow-node-2","title":"Second","body":"Do the second thing.",` + settings + `},
		{"id":"flow-node-3","title":"Third","body":"Do the third thing.",` + settings + `,
		 "onSuccess":{"flowNode":"flow-node-4","mode":"end"}},
		{"id":"flow-node-4","title":"Fourth","body":"Do the fourth thing.",` + settings + `}
	]}`
}

// editFlowNode rewrites one card of the board in the store, the way the panel would: what a person
// does between a run ending and starting it again.
func (rt *runnerTest) editFlowNode(id string, edit func(*flowNode)) {
	rt.t.Helper()
	boards, ok := rt.runner.boards.(*memoryBoards)
	if !ok {
		rt.t.Fatal("editFlowNode needs the memory board store")
	}
	boards.mu.Lock()
	defer boards.mu.Unlock()
	board, ok := boards.boards[rt.handle]
	if !ok {
		rt.t.Fatalf("no board %s in the store", rt.handle)
	}
	flowNode := board.flowNode(id)
	if flowNode == nil {
		rt.t.Fatalf("no flow node %s on the board", id)
	}
	edit(flowNode)
}

// TestChainRunPlaysTheChainWithNobodyWatching is the whole feature in one test: a run started
// through the REST surface plays its flow node, marks it, hands its chat to the flow node it names
// and plays that one too — with no socket open at any point.
func TestChainRunPlaysTheChainWithNobodyWatching(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	rt.answers("The first answer.", "The second answer.")

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	first, second := board.flowNode("flow-node-1"), board.flowNode("flow-node-2")
	if first.Status != flowNodeStatusDone || second.Status != flowNodeStatusDone {
		t.Fatalf("statuses = %q / %q, want both flow nodes marked done", first.Status, second.Status)
	}
	// The descriptions stay where they are: a play sends them, and what the turns said is in the
	// conversations the cards name.
	if first.Body != "Do the first thing." || second.Body != "Do the second thing." {
		t.Errorf("bodies = %q / %q, want the descriptions kept", first.Body, second.Body)
	}
	// The chain carries the conversation, and carries it as a **fork**: the second flow node was
	// played in a copy of the first one's chat rather than in the chat itself, so each card keeps a
	// conversation of its own while the second still remembers everything the first did. It is written
	// on the flow node rather than held in the run, so a chain resumed goes back into it.
	if first.Chat == "" || second.Chat == "" || first.Chat == second.Chat {
		t.Errorf("chats = %q / %q, want the second flow node played in a fork of the first one's chat",
			first.Chat, second.Chat)
	}
	forked, err := rt.convs.get(second.Chat)
	if err != nil {
		t.Fatalf("read the forked conversation: %v", err)
	}
	if forked.ForkedFrom != first.Chat {
		t.Errorf("forkedFrom = %q, want the copy branched from the chat the chain ran in (%q)",
			forked.ForkedFrom, first.Chat)
	}
	// Named after the card it was made for: a switcher of six copies called "First" would have lost
	// the one thing a title is for.
	if forked.Title != "Second" {
		t.Errorf("title = %q, want the fork named after the flow node it is played in", forked.Title)
	}
	// The description alone: the title is the card's name on the board, not a line of the prompt.
	prompts := rt.prompts()
	if len(prompts) != 2 || !strings.HasPrefix(prompts[0], "Do the first thing.") {
		t.Fatalf("prompts = %q, want the description of each flow node", prompts)
	}
	if strings.Contains(prompts[0], "First") {
		t.Errorf("prompt = %q, want the title left out of it", prompts[0])
	}
	if !strings.HasPrefix(prompts[1], "Do the second thing.") {
		t.Errorf("second prompt = %q, want the second flow node's own text", prompts[1])
	}
}

// A chain that ends its conversation plays the next flow node in one of its own.
func TestChainRunChainCanEndTheConversation(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	if first, second := board.flowNode("flow-node-1"), board.flowNode("flow-node-2"); first.Chat == second.Chat {
		t.Errorf("chats = %q / %q, want a conversation of its own for a flow node handed nothing",
			first.Chat, second.Chat)
	}
}

// A chain that ends its conversation plays the next flow node in a chat of its own even when the
// next card already names the conversation just finished: a chain run before under `continue`
// writes it onto the next card, and flipping the mode to `end` since does not take it back off —
// but the ended conversation is still ended, so a fresh one is made for what follows.
func TestChainRunChainEndingTheConversationMakesOneForTheNextFlowNode(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	shared := mustCreateConversation(t, rt.convs, "")
	rt.editFlowNode("flow-node-1", func(flowNode *flowNode) { flowNode.Chat = shared.ID })
	rt.editFlowNode("flow-node-2", func(flowNode *flowNode) { flowNode.Chat = shared.ID })

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	first, second := board.flowNode("flow-node-1"), board.flowNode("flow-node-2")
	if first.Status != flowNodeStatusDone || second.Status != flowNodeStatusDone {
		t.Fatalf("statuses = %q / %q, want both flow nodes marked done", first.Status, second.Status)
	}
	if first.Chat != shared.ID {
		t.Errorf("first chat = %q, want the finished flow node played in the conversation it named (%q)",
			first.Chat, shared.ID)
	}
	if second.Chat == first.Chat {
		t.Errorf("chats = %q / %q, want the next flow node played in a chat of its own rather than in the conversation the finished flow node ended",
			first.Chat, second.Chat)
	}
}

// A card that asks for it has its chat shortened once its own flow node is done, and `/compact`
// goes in as itself — into the chat that card ran in, before the fork the next flow node is played
// in is taken off it.
func TestChainRunCompactsTheChatOfTheFlowNodeThatAskedForIt(t *testing.T) {
	rt := newRunnerTest(t, chainBoardCompacting(transitionContinue))

	rt.play("flow-node-1")
	rt.waitIdle()

	prompts := rt.prompts()
	if len(prompts) != 3 || prompts[1] != chainRunCompactCommand {
		t.Fatalf("prompts = %q, want the compaction between the two flow nodes", prompts)
	}
}

// The box says what a card leaves its own conversation as, so it is honoured on a card that hands
// that conversation to nobody — the last of a chain, or one played on its own.
func TestChainRunCompactsTheChatOfAFlowNodeThatEndsTheConversation(t *testing.T) {
	rt := newRunnerTest(t, chainBoardCompacting(transitionEnd))

	rt.play("flow-node-1")
	rt.waitIdle()

	prompts := rt.prompts()
	if len(prompts) != 3 || prompts[1] != chainRunCompactCommand {
		t.Fatalf("prompts = %q, want the first flow node's chat shortened before the chain moved on", prompts)
	}
	board := rt.board()
	if first, second := board.flowNode("flow-node-1"), board.flowNode("flow-node-2"); first.Chat == second.Chat {
		t.Errorf("chats = %q / %q, want the conversation still ended with the card that shortened it",
			first.Chat, second.Chat)
	}
}

// A flow node whose turn blocked twice is forked and played again from the fork: the card
// points at the fork, the forked turn is sent the fork prompt rather than the description,
// and its answer marks the card done — so the run carries on instead of stopping on the
// blockage.
func TestChainRunForksAFlowNodeBlockedTwice(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	rt.answers("The answer from the fork.")
	flowNode := rt.board().flowNode("flow-node-1")
	resolved, err := rt.runner.resolveAgent(*flowNode)
	if err != nil {
		t.Fatalf("resolve the flow node's agent: %v", err)
	}
	run := &chainRun{id: "run-1", name: "Test", handle: rt.handle,
		owner: core.Identity{User: "tester"}, done: make(chan struct{})}
	// The blocked turn held the card: a forked answer marks it, and a mark is refused from a run
	// that does not hold the card.
	if _, err := rt.runner.boards.Start(rt.handle, "flow-node-1", run.id); err != nil {
		t.Fatalf("claim the card for the run: %v", err)
	}
	chat, err := rt.runner.conversationFor(run, *flowNode, resolved)
	if err != nil {
		t.Fatalf("make the flow node's chat: %v", err)
	}
	out, fault := rt.runner.playBlockedFork(context.Background(), run, *flowNode,
		playOneOutcome{chat: chat, title: flowNode.Title, agent: resolved.platform}, resolved, chat)
	if fault != nil {
		t.Fatalf("playBlockedFork fault = %+v, want the forked answer to decide", fault)
	}
	if out.round != roundOn {
		t.Errorf("round = %v, want the chain to carry on", out.round)
	}
	if out.chat == "" || out.chat == chat {
		t.Fatalf("chat = %q, want the fork rather than the blocked conversation", out.chat)
	}
	forked, err := rt.convs.get(out.chat)
	if err != nil {
		t.Fatalf("read the forked conversation: %v", err)
	}
	if forked.ForkedFrom != chat {
		t.Errorf("forkedFrom = %q, want the copy branched from the blocked chat (%q)",
			forked.ForkedFrom, chat)
	}
	prompts := rt.prompts()
	if len(prompts) != 1 || !strings.HasPrefix(prompts[0], chainRunBlockedForkPrompt) {
		t.Errorf("prompts = %q, want the fork prompt", prompts)
	}
	got := rt.board().flowNode("flow-node-1")
	if got.Status != flowNodeStatusDone {
		t.Errorf("status = %q, want the flow node done on the forked answer", got.Status)
	}
	if got.Chat != out.chat {
		t.Errorf("chat = %q, want the card pointing at the fork (%q)", got.Chat, out.chat)
	}
}

// A turn that came back one of the CLI's own error notices did not do the flow node: nothing is
// marked, and an error that passes is waited out and sent again.
func TestChainRunWaitsOutAPassingError(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	rt.answers(
		"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
		"The answer, second time round.")

	rt.play("flow-node-1")
	waiting := rt.waitState(chainRunStateWaiting, chainRunStatePlaying)
	if waiting.State == chainRunStateWaiting && waiting.RetryAt == 0 {
		t.Error("a run waiting must say when it will try again, or the board shows a spinner for twenty minutes")
	}
	rt.waitIdle()

	board := rt.board()
	first := board.flowNode("flow-node-1")
	if first.Status != flowNodeStatusDone {
		t.Fatalf("status = %q, want the flow node done on the second try", first.Status)
	}
	if first.Body != "Do the first thing." {
		t.Errorf("body = %q, want the description kept", first.Body)
	}
	if len(rt.prompts()) < 2 {
		t.Errorf("prompts = %q, want the same flow node sent again", rt.prompts())
	}
}

// An error a wait will not fix marks the flow node and stops the run: nothing but the user clears
// it.
func TestChainRunMarksAFlowNodeItsTurnCouldNotDo(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	rt.answers("API Error: 401 Invalid API key · Please run /login")

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	if board.flowNode("flow-node-1").Status != flowNodeStatusError {
		t.Errorf("status = %q, want the flow node marked as the error it came back", board.flowNode("flow-node-1").Status)
	}
	if board.flowNode("flow-node-2").Status != "" {
		t.Error("on success means on success: the chain must not be followed past an error")
	}
	if len(rt.prompts()) != 1 {
		t.Errorf("prompts = %q, want no second try for an error a wait does not fix", rt.prompts())
	}
}

// A turn that worked for an hour and then met the five-hour window is a flow node that was **not**
// done. The CLI writes the limit as one more block after everything already said, and a reply read
// only at its head is an answer — so the board must not mark it done by the very sentence saying it
// was not finished.
//
// What it does instead is **hold** the flow node: the notice says when the window reopens, and
// until then there is nothing to do with the card and nothing to say about it but that. The chain
// is not followed, and the board says `waiting-refresh` where a spinner would have claimed the turn
// was still working.
func TestChainRunHoldsAFlowNodeThatRanIntoTheSessionLimit(t *testing.T) {
	const limit = "You've hit your session limit · resets 7:10pm (Europe/Paris)"
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	rt.answers(rt.blockEvents("I'll start by exploring the hybridflow code.",
		"Let me refine two details.", limit))

	rt.play("flow-node-1")
	held := rt.waitState(chainRunStateRefreshing)

	if held.RetryAt == 0 || time.UnixMilli(held.RetryAt).Before(time.Now()) {
		t.Errorf("retryAt = %d, want the moment the notice named, which is still to come", held.RetryAt)
	}
	board := rt.board()
	first := board.flowNode("flow-node-1")
	if first.Status != flowNodeStatusWaitingRefresh {
		t.Fatalf("status = %q, want the card saying it is waiting for the limit to refresh rather than"+
			" drawing a spinner over a turn that is not running", first.Status)
	}
	if first.Body == "" {
		t.Error("body = empty, want the description kept: the flow node has not been done")
	}
	if board.flowNode("flow-node-2").Status != "" {
		t.Error("on success means on success: the chain must not be followed past a limit")
	}

	// The run is stopped while it holds — and the card, which was nobody's but this run's, says the
	// flowNode was left part-way rather than sitting `waiting-refresh` for a run that is gone.
	rt.stop()
	rt.waitIdle()
	if got := rt.board().flowNode("flow-node-1").Status; got != flowNodeStatusInterrupted {
		t.Errorf("status = %q, want a held flow node marked interrupted when the run holding it ends", got)
	}
}

// The limit lifts, and what goes back into the chat is **not the flow node**: the turn that met the
// limit had been working, its conversation still holds every word of it, and asking for the
// description again would pay for that hour twice. The word sent instead picks the cut-off turn
// back up, and what it answers is the flow node's answer.
func TestChainRunResumesTheCutOffTurnWhenTheLimitLifts(t *testing.T) {
	// A moment already gone, said the way the CLI says it: the window this notice names reopened in
	// 2025, so the wait is the leeway alone.
	const limit = "Claude AI usage limit reached|1750000000"
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	rt.answers(
		rt.blockEvents("I'll start by reading the folder.", limit),
		"Picked it back up, and it is done.")

	rt.play("flow-node-1")
	rt.waitIdle()

	// The description once, and then the word that picks the turn back up — never the description a
	// second time, which is what would ask for the hour already worked all over again. Each carries
	// the note saying where the turn runs, as every message does.
	prompts := rt.prompts()
	if len(prompts) < 2 || !strings.HasPrefix(prompts[0], "Do the first thing.") ||
		!strings.HasPrefix(prompts[1], chainRunResumePrompt) {
		t.Fatalf("prompts = %q, want the flow node once and then the word that resumes its turn", prompts)
	}
	first := rt.board().flowNode("flow-node-1")
	if first.Status != flowNodeStatusDone {
		t.Fatalf("status = %q, want the flow node done by the turn that picked itself back up", first.Status)
	}
	if first.Body != "Do the first thing." {
		t.Errorf("body = %q, want the description kept", first.Body)
	}
}

// A limit that will not lift — every try meets the same closed window — is given the same four
// tries as any other error that passes, and then marked. A board that waits for ever is a board
// that looks busy and is not.
func TestChainRunGivesUpOnALimitThatNeverLifts(t *testing.T) {
	const limit = "Claude AI usage limit reached|1750000000"
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	rt.answers(rt.blockEvents(limit))

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	if got := board.flowNode("flow-node-1").Status; got != flowNodeStatusError {
		t.Fatalf("status = %q, want the flow node marked as the limit it never got out of", got)
	}
	if board.flowNode("flow-node-2").Status != "" {
		t.Error("on success means on success: the chain must not be followed past a limit")
	}
	if len(rt.prompts()) != rt.runner.retryLimit+1 {
		t.Errorf("prompts = %d, want the flow node tried %d times before the run gives up",
			len(rt.prompts()), rt.runner.retryLimit+1)
	}
}

// Stopping the turn from its chat stops the run — and keeps it, so the next message said in that
// chat can pick the whole chain back up.
func TestStoppingTheChatSuspendsTheRun(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	// A turn that says its piece and then waits: the run is playing while the test stops it.
	rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Half an answer."}]}}` + "\n" +
		`{"type":"other","note":"still working"}` + "\n")

	rt.play("flow-node-1")
	run := rt.waitTurn()
	rt.waitSaid(run.Chat)

	// The mark goes on before the prompt does: for as long as the turn runs, the board is the only
	// thing that says which flow node is being worked on to anybody not watching this run.
	if got := rt.board().flowNode("flow-node-1").Status; got != flowNodeStatusRunning {
		t.Errorf("status = %q, want the flow node marked as being worked on while its turn runs", got)
	}

	rt.hub.stopProcess(run.Chat, "tester")

	suspended := rt.waitState(chainRunStateSuspended)
	if suspended.FlowNodeID != "flow-node-1" || suspended.Chat != run.Chat {
		t.Errorf("run = %+v, want the flow node and the chat kept so it can be resumed", suspended)
	}
	board := rt.board()
	if flowNode := board.flowNode("flow-node-1"); flowNode.Status != flowNodeStatusInterrupted {
		t.Errorf("flow node = %+v, want the flow node marked interrupted"+
			" — it was worked on, and it was not finished", *flowNode)
	}
	if board.flowNode("flow-node-2").Status != "" {
		t.Error("a stopped turn is the last one played: the chain must not carry on")
	}

	// Resuming with nothing said in the chat plays the flow node again itself, and the chain follows.
	rt.answers("The answer after the interruption.", "The second answer.")
	if _, err := rt.runner.resume(core.Identity{User: "tester"}, rt.last().ID); err != nil {
		t.Fatalf("resume: %v", err)
	}
	rt.waitIdle()
	if got := rt.board().flowNode("flow-node-2").Status; got != flowNodeStatusDone {
		t.Errorf("second flow node = %q, want the chain carried on after the resume", got)
	}
}

// Stop and the chat's Stop are a step apart at the end: a run somebody ended is over, while one
// whose turn was interrupted is kept for the next message in that chat to pick up. Pressing both is
// the first of the two.
func TestStopEndsARunWhoseTurnIsThenStoppedFromTheChat(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionContinue))
	rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Half an answer."}]}}` + "\n" +
		`{"type":"other","note":"still working"}` + "\n")

	rt.play("flow-node-1")
	run := rt.waitTurn()
	rt.stop()
	rt.hub.stopProcess(run.Chat, "tester")

	rt.waitIdle()
	if got := rt.board().flowNode("flow-node-1").Status; got != flowNodeStatusInterrupted {
		t.Errorf("first flow node = %q, want the interrupted turn marked as one whoever else pressed what", got)
	}
	if got := rt.board().flowNode("flow-node-2").Status; got != "" {
		t.Errorf("second flow node = %q, want nothing after a run that was stopped", got)
	}
}

// Two runs, two chains, one board — which is what the panel exists to show. They mark the same
// board at the same time, and the point of the test is that neither loses the other's marks.
func TestTwoRunsPlayTwoChainsOfOneBoard(t *testing.T) {
	rt := newRunnerTest(t, twoChainBoard())

	rt.play("flow-node-1")
	rt.play("flow-node-3")
	rt.waitIdle()

	board := rt.board()
	for _, id := range []string{"flow-node-1", "flow-node-2", "flow-node-3", "flow-node-4"} {
		if got := board.flowNode(id).Status; got != flowNodeStatusDone {
			t.Errorf("%s = %q, want both chains to have played to the end", id, got)
		}
	}
	if runs := rt.runner.snapshots(); len(runs) != 2 {
		t.Fatalf("%d runs kept, want the two that played", len(runs))
	}
}

// A run is named at the click, and that name is the whole of what tells two runs of one board
// apart.
func TestARunIsCalledWhatItWasStartedAs(t *testing.T) {
	rt := newRunnerTest(t, twoChainBoard())

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", "  Nightly  "); err != nil {
		t.Fatal(err)
	}
	if got := rt.last().Name; got != "Nightly" {
		t.Errorf("name = %q, want what was typed, trimmed", got)
	}
	rt.waitIdle()

	// An empty box is a name all the same: the run says when it started, which is what the box the
	// user was offered had been prefilled with anyway.
	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-3", ""); err != nil {
		t.Fatal(err)
	}
	if got := rt.last().Name; !strings.HasPrefix(got, "Started ") {
		t.Errorf("name = %q, want the moment it started", got)
	}
	rt.waitIdle()
}

// A card is played by one run. A second play on the same card is refused, and — this is the half
// worth stating — the run already on it carries straight on.
func TestPlayRefusesACardAnotherRunHolds(t *testing.T) {
	rt := newRunnerTest(t, twoChainBoard())
	// A turn that never emits `result` keeps the first run on its card while the second is tried.
	rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Working."}]}}` + "\n")

	rt.play("flow-node-1")
	first := rt.waitTurn()

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", "Second"); err == nil {
		t.Error("a card another run is holding must be refused rather than played twice")
	}
	if runs := rt.runner.snapshots(); len(runs) != 1 || runs[0].ID != first.ID {
		t.Fatalf("runs = %+v, want the refused play to have left the first one alone", runs)
	}

	rt.stop()
	rt.hub.stopProcess(first.Chat, "tester")
	rt.waitIdle()
}

// A chain walking into a card another run is holding stops there and says whose it is: two turns
// on one flow node would have the second mark written over the first.
func TestAChainStopsAtACardAnotherRunHolds(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	// Both turns queued up front, one file each: the first never ends — that is the held card — and
	// the second answers. Written now rather than between the two plays, because rewriting the file
	// a running stub is still reading is a race, and the whole point of this test is the one that is
	// still running.
	rt.answers(
		`{"type":"system","subtype":"init","session_id":"sess-1"}`+"\n"+
			`{"type":"assistant","message":{"content":[{"type":"text","text":"Working."}]}}`+"\n",
		"The first answer.")

	// The second card first, and held: its turn never ends.
	rt.play("flow-node-2")
	held := rt.waitTurn()
	rt.waitSaid(held.Chat)

	// Now the chain, whose first card answers and whose second is that held card.
	rt.play("flow-node-1")
	rt.waitFor("the chain to end at the held card", func() bool {
		for _, run := range rt.runner.snapshots() {
			if run.RootFlowNodeID == "flow-node-1" && run.State == chainRunStateEnded {
				return true
			}
		}
		return false
	})

	if got := rt.board().flowNode("flow-node-1").Status; got != flowNodeStatusDone {
		t.Errorf("first flow node = %q, want its own turn marked", got)
	}
	if len(rt.prompts()) != 2 {
		t.Errorf("%d prompts, want the held card not to have been sent a second turn", len(rt.prompts()))
	}

	rt.stop()
	rt.hub.stopProcess(held.Chat, "tester")
	rt.waitIdle()
}

// A run stays in the list once it is over, saying so — that is what a Restart is offered on — and
// Restart plays it again from the card it started on, under the name it already has.
func TestAnEndedRunIsRestartedFromTheCardItStartedOn(t *testing.T) {
	rt := newRunnerTest(t, twoChainBoard())

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", "Nightly"); err != nil {
		t.Fatal(err)
	}
	rt.waitIdle()

	ended := rt.last()
	if ended.State != chainRunStateEnded || ended.EndedAt == 0 {
		t.Fatalf("run = %+v, want it kept in the list saying it is over", ended)
	}

	// The card still asks what it was asking — a play takes nothing away — so it plays again as it
	// stands: same run, same name, same place in the list.
	if _, err := rt.runner.restart(core.Identity{User: "tester"}, ended.ID); err != nil {
		t.Fatalf("restart: %v", err)
	}
	again := rt.live()
	if again == nil || again.ID != ended.ID || again.Name != "Nightly" {
		t.Fatalf("run = %+v, want the same run played again under its own name", again)
	}
	rt.waitIdle()
	if runs := rt.runner.snapshots(); len(runs) != 1 {
		t.Errorf("%d runs, want the restart to have kept one and not made a second", len(runs))
	}
}

// Forget is the only way a run leaves the list, and it is refused while the run is playing: one
// button doing two things is a button nobody can predict.
func TestForgetTakesAnEndedRunOffTheList(t *testing.T) {
	rt := newRunnerTest(t, twoChainBoard())

	rt.play("flow-node-1")
	rt.waitIdle()
	ended := rt.last()

	if err := rt.runner.forget(ended.ID); err != nil {
		t.Fatalf("forget: %v", err)
	}
	if runs := rt.runner.snapshots(); len(runs) != 0 {
		t.Errorf("runs = %+v, want the ended run gone", runs)
	}
}

// What the panel draws: the chain a run has walked, the card it is on, and what lies ahead of it —
// each with the title and the status the board holds, so a chain run shows without its board.
func TestARunReportsTheChainItIsWalking(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))

	rt.play("flow-node-1")
	rt.waitIdle()

	run := rt.last()
	if len(run.FlowNodes) != 2 {
		t.Fatalf("flow nodes = %+v, want the two cards of the chain", run.FlowNodes)
	}
	if run.FlowNodes[0].ID != "flow-node-1" || run.FlowNodes[0].Title != "First" || !run.FlowNodes[0].Played {
		t.Errorf("first = %+v, want the card it played, named and marked as played", run.FlowNodes[0])
	}
	if run.FlowNodes[1].Status != flowNodeStatusDone {
		t.Errorf("second = %+v, want the status the board holds", run.FlowNodes[1])
	}
	for _, flowNode := range run.FlowNodes {
		if flowNode.Current {
			t.Errorf("%+v is marked current, and the run is over", flowNode)
		}
	}
}

// Stop is the board's own: the turn under way is left to finish and is filed like any other, and
// nothing after it is started.
func TestChainRunStopEndsTheChainAfterTheTurn(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionContinue))

	rt.play("flow-node-1")
	rt.waitTurn()
	rt.stop()
	rt.waitIdle()

	board := rt.board()
	if board.flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Errorf("first flow node = %q, want the turn under way filed and marked", board.flowNode("flow-node-1").Status)
	}
	if board.flowNode("flow-node-2").Status != "" {
		t.Error("Stop ends the chain: nothing after the turn under way is played")
	}
}

// A flow node nobody named a model, an effort, a permission mode and a folder for is not Claude's,
// and nothing here writes any of them for it.
func TestPlayRefusesAFlowNodeNothingCanPlay(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Somebody's own work"}]}`)

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", ""); err == nil {
		t.Error("a flow node with no settings must be refused rather than run on something nobody chose")
	}
	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "no-such-flow-node", ""); err == nil {
		t.Error("a flow node that is not on the board must be refused")
	}
	if _, err := rt.runner.play(core.Identity{User: "tester"}, "no-such-board", "flow-node-1", ""); err == nil {
		t.Error("a board the store does not hold must be refused")
	}
	if rt.live() != nil {
		t.Error("a refused play must leave no run behind")
	}
}

// The prompt is the title, the description or the success criteria, so a card saying none of
// the three has nothing to send. Writing one of them is what offers it a turn.
func TestPlayRefusesAFlowNodeWithNothingToSend(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", ""); err == nil {
		t.Error("a flow node with nothing to send must be refused rather than sent as an empty prompt")
	}
	if rt.live() != nil {
		t.Error("a refused play must leave no run behind")
	}
}

// ... while a card with no description but a title is played on its name.
func TestPlayTakesAFlowNodeWithNoDescriptionButATitle(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"Something to send","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)

	run, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", "")
	if err != nil {
		t.Fatalf("a titled flow node was refused: %v", err)
	}
	if run == nil || rt.live() == nil {
		t.Error("a titled flow node leaves no run behind")
	}
	// The run is left to end: its loop writes into the temp store, and the test ending first
	// races the cleanup removing it.
	rt.waitIdle()
}

// And the same rule ends a chain: the card after this one has an empty box, so there is
// nothing to send it and the run stops rather than spending a turn on an empty prompt.
func TestChainRunChainStopsAtAFlowNodeWithNothingToSend(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"},
		 "onSuccess":{"flowNode":"flow-node-2","mode":"continue"}},
		{"id":"flow-node-2","title":"","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	if board.flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Fatalf("first flow node = %q, want the card that was played marked done", board.flowNode("flow-node-1").Status)
	}
	if got := board.flowNode("flow-node-2").Status; got != "" {
		t.Errorf("second flow node = %q, want the chain stopped at a card with nothing to send", got)
	}
	if len(rt.prompts()) != 1 {
		t.Errorf("prompts = %q, want the one flow node that had something to send", rt.prompts())
	}
}

// A card with no description is still played on its name: the title stands in for the missing
// description, so the chain carries on to a titled card.
func TestChainRunChainPlaysATitledFlowNodeWithNoDescription(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"},
		 "onSuccess":{"flowNode":"flow-node-2","mode":"continue"}},
		{"id":"flow-node-2","title":"Second","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`)

	rt.play("flow-node-1")
	rt.waitIdle()

	if got := rt.board().flowNode("flow-node-2").Status; got != flowNodeStatusDone {
		t.Errorf("second flow node = %q, want the titled card played on its name", got)
	}
	prompts := rt.prompts()
	if len(prompts) != 2 || prompts[1] != "Second" {
		t.Errorf("prompts = %q, want the second turn sent the title alone", prompts)
	}
}

// A conversation is made for a folder and keeps it, so a flow node cannot be handed a chat that
// runs somewhere else. Where a played turn writes is the one thing this board never decides for the
// user.
func TestChainRunChainStopsWhenTheNextFlowNodeRunsElsewhere(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"First","body":"Do the first thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"},"onSuccess":{"flowNode":"flow-node-2"}},
		{"id":"flow-node-2","title":"Second","body":"Do the second thing.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"units"}}]}`)
	mustMkdir(t, rt.root, "units")

	rt.play("flow-node-1")
	rt.waitIdle()

	if got := rt.board().flowNode("flow-node-2").Status; got != "" {
		t.Errorf("second flow node = %q, want the chain stopped rather than run in another folder", got)
	}
}

// The board is read again at every step: a card edited while its turn ran is still the same
// flow node, and still gets its own mark — and the edit survives the run's write, the mark being
// one field of the card rather than the card whole.
func TestChainRunFindsItsFlowNodeWhereverTheBoardPutIt(t *testing.T) {
	rt := newRunnerTest(t, chainBoard(transitionEnd))
	rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Marked on the right card."}]}}` + "\n" +
		`{"type":"other","note":"still working"}` + "\n")

	rt.play("flow-node-1")
	run := rt.waitTurn()
	rt.waitSaid(run.Chat)

	// The board is edited under the run: the played card is retitled and moved, exactly as a
	// person would while its turn runs.
	rt.editFlowNode("flow-node-1", func(flowNode *flowNode) {
		flowNode.Title = "First, renamed"
		flowNode.Spot = &flowNodeSpot{X: 640, Y: 320}
	})

	rt.hub.stopProcess(run.Chat, "tester")
	rt.waitState(chainRunStateSuspended)

	after := rt.board().flowNode("flow-node-1")
	if after.Title != "First, renamed" || after.Spot == nil || after.Spot.X != 640 {
		t.Errorf("card = %+v, want the run's write to have kept the edit made under it", after)
	}
	if after.Status != flowNodeStatusInterrupted {
		t.Errorf("status = %q, want the stopped turn marked on the flow node however it was edited",
			after.Status)
	}
}

// ── the two cards the board plays to itself ──────────────────────────────────

// shutdownBoard is a chain ending on a **Shutdown** card, with a third flow node named nowhere: a
// card that turns the machine off names nothing after it, so the chain ends there whatever else is
// on the board.
func shutdownBoard() string {
	return `{"flowNodes":[
		{"id":"flow-node-1","title":"The last thing tonight","type":"ai","body":"Do it.",
		 "settings":{"agent":"claude","model":"opus","effort":"high","permission":"bypassPermissions","folder":"/"},
		 "onSuccess":{"flowNode":"flow-node-2","mode":"end"}},
		{"id":"flow-node-2","title":"Good night","type":"shutdown"},
		{"id":"flow-node-3","title":"Tomorrow","type":"ai","body":"Do it tomorrow.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`
}

// schedulerBoard is a Scheduler holding for `at`, and the flow node it plays when the hour comes.
func schedulerBoard(at string) string {
	return `{"flowNodes":[
		{"id":"flow-node-1","title":"Overnight","type":"scheduler","at":"` + at + `",
		 "onSuccess":{"flowNode":"flow-node-2","mode":"end"}},
		{"id":"flow-node-2","title":"Tomorrow","type":"ai","body":"Do it tomorrow.","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/"}}]}`
}

// The whole feature: a chain reaching a Shutdown card turns the machine off, and ends there —
// playing anything into a machine on its way down would be starting work to abandon it.
func TestChainRunShutdownCardEndsTheChainAndTurnsTheMachineOff(t *testing.T) {
	rt := newRunnerTest(t, shutdownBoard())
	asked := rt.powersOff()

	rt.play("flow-node-1")
	rt.waitIdle()

	if !rt.wentOff(asked) {
		t.Fatal("the chain reached a Shutdown card and the machine was not turned off")
	}
	board := rt.board()
	if board.flowNode("flow-node-2").Status != flowNodeStatusDone {
		t.Errorf("the card = %q, want it marked done before anything goes off", board.flowNode("flow-node-2").Status)
	}
	if len(rt.prompts()) != 1 {
		t.Errorf("prompts = %q, want nothing said to Claude by a card that speaks to nobody", rt.prompts())
	}
}

// It is a card like any other, so it is played like any other: the board's Play on it is the whole
// of what it takes.
func TestChainRunShutdownCardIsPlayedOnItsOwn(t *testing.T) {
	rt := newRunnerTest(t, shutdownBoard())
	asked := rt.powersOff()

	rt.play("flow-node-2")
	rt.waitIdle()

	if !rt.wentOff(asked) {
		t.Fatal("a Shutdown card played on its own turns the machine off")
	}
	if len(rt.prompts()) != 0 {
		t.Errorf("prompts = %q, want a card that speaks to nobody to speak to nobody", rt.prompts())
	}
}

// A turn that came back an error stops the chain before the card is ever reached, which is the
// whole point of putting the machine at the end of one: a machine somebody has to look at stays on.
func TestChainRunShutdownCardIsNotReachedByAFailedChain(t *testing.T) {
	rt := newRunnerTest(t, shutdownBoard())
	asked := rt.powersOff()
	rt.answers(rt.blockEvents("Started.", "API Error: 400 the request was malformed"))

	rt.play("flow-node-1")
	rt.waitIdle()

	if rt.board().flowNode("flow-node-1").Status != flowNodeStatusError {
		t.Fatalf("flow node = %q, want the turn's error marked", rt.board().flowNode("flow-node-1").Status)
	}
	if rt.wentOff(asked) {
		t.Error("a chain that came back an error leaves the machine on")
	}
}

// A turn somebody stopped is somebody at the keyboard, which is the plainest thing there is to say
// the machine is wanted.
func TestChainRunShutdownCardLeavesAStoppedTurnsMachineOn(t *testing.T) {
	rt := newRunnerTest(t, shutdownBoard())
	asked := rt.powersOff()
	rt.answers(`{"type":"system","subtype":"init","session_id":"sess-1"}` + "\n" +
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Half of it."}]}}` + "\n" +
		`{"type":"other","note":"still working"}` + "\n")

	rt.play("flow-node-1")
	run := rt.waitTurn()
	rt.waitSaid(run.Chat)
	rt.hub.stopProcess(run.Chat, "tester")
	rt.waitState(chainRunStateSuspended)

	if rt.wentOff(asked) {
		t.Error("a turn that was stopped leaves the machine on")
	}
}

// Where the deployment cannot turn a machine off — a server, the image, every start but the executable
// — the card is marked an error: it asked for something that did not happen, and a card left saying
// `done` over a machine still running would be the play claiming otherwise.
func TestChainRunShutdownCardIsAnErrorWhereTheMachineIsNotThisServicesToTurnOff(t *testing.T) {
	rt := newRunnerTest(t, shutdownBoard())
	// No shutdown command: what LoadConfig gives every deployment but `kiao`.
	rt.runner.shutdown = machinePowerOff(&Config{})

	rt.play("flow-node-2")
	rt.waitIdle()

	if got := rt.board().flowNode("flow-node-2").Status; got != flowNodeStatusError {
		t.Errorf("the card = %q, want a machine still running marked as what it is", got)
	}
}

// A Scheduler whose datetime has passed does not wait: a schedule is a floor under the next flow
// node, not a claim that the board was running at the time.
func TestChainRunSchedulerPlaysOnWhenItsDatetimeHasPassed(t *testing.T) {
	rt := newRunnerTest(t, schedulerBoard("2020-01-01T03:00"))

	rt.play("flow-node-1")
	rt.waitIdle()

	board := rt.board()
	if board.flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Errorf("the scheduler = %q, want a card that has done its waiting marked done",
			board.flowNode("flow-node-1").Status)
	}
	if board.flowNode("flow-node-2").Status != flowNodeStatusDone {
		t.Errorf("the flow node after it = %q, want the chain carried on", board.flowNode("flow-node-2").Status)
	}
	if len(rt.prompts()) != 1 {
		t.Errorf("prompts = %q, want the one turn the chain holds", rt.prompts())
	}
}

// The card holding for its hour is the run doing the one thing that card is for: nothing is
// running, nothing has gone wrong, and the board says which of the two waits it is in.
func TestChainRunSchedulerHoldsForItsDatetime(t *testing.T) {
	rt := newRunnerTest(t, schedulerBoard("2099-01-01T03:00"))

	rt.play("flow-node-1")
	run := rt.waitState(chainRunStateScheduled)

	if run.FlowNodeID != "flow-node-1" {
		t.Errorf("flow node = %q, want the card being waited on", run.FlowNodeID)
	}
	if rt.board().flowNode("flow-node-1").Status != flowNodeStatusRunning {
		t.Errorf("the scheduler = %q, want the run's mark on the card it is holding",
			rt.board().flowNode("flow-node-1").Status)
	}
	if len(rt.prompts()) != 0 {
		t.Errorf("prompts = %q, want nothing played while the card waits", rt.prompts())
	}

	// Stop is what ends a wait here, as it ends the twenty minutes between two tries.
	rt.stop()
	rt.waitIdle()
	if got := rt.board().flowNode("flow-node-2").Status; got != "" {
		t.Errorf("the flow node after it = %q, want a stopped wait to play nothing", got)
	}
}

// The datetime is a Scheduler's whole configuration, and it is missing the way an effort is missing
// on an AI card: there is nothing to play.
func TestChainRunSchedulerWithNoDatetimeIsNotPlayed(t *testing.T) {
	rt := newRunnerTest(t, schedulerBoard(""))

	if _, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", ""); err == nil {
		t.Fatal("a scheduler naming no datetime has nothing to wait for")
	}
}

// imageBoard is one flow node whose body links two pictures from the store root: one the store
// holds, one that was never there.
const imageBoard = `{"flowNodes":[
		{"id":"flow-node-1","title":"Fix the header",
		 "body":"Here is what it looks like:\n\n![shot](/boards/shot.png)\n\nAnd one that is gone: ![old](/boards/old.png)",
		 "settings":{"agent":"claude","model":"opus","effort":"high","permission":"bypassPermissions","folder":"/"}}
	]}`

// A flow node's images travel with it. The CLI takes text on a pipe, so what reaches the turn is
// the path of the file in the store — the real one, resolved from the store root rather than
// against the folder the turn runs in.
func TestChainRunHandsAFlowNodesImagesToTheTurn(t *testing.T) {
	rt := newRunnerTest(t, imageBoard)
	mustWriteBytes(t, filepath.Join(rt.root, "boards/shot.png"), []byte("0123456789"))

	rt.play("flow-node-1")
	rt.waitIdle()

	prompts := rt.prompts()
	if len(prompts) != 1 {
		t.Fatalf("prompts = %q, want the one flow node", prompts)
	}
	if want := filepath.Join(rt.root, "boards/shot.png") + " (image/png, 10 bytes)"; !strings.Contains(prompts[0], want) {
		t.Errorf("prompt does not name the flow node's image as %q:\n%s", want, prompts[0])
	}
	// A dead link is said out loud and nothing more: the flow node is played as it stands, and no path
	// is handed over for a file the store does not hold.
	if gone := filepath.Join(rt.root, "boards/old.png"); strings.Contains(prompts[0], gone) {
		t.Errorf("prompt names an image that is not in the store:\n%s", prompts[0])
	}
	if rt.board().flowNode("flow-node-1").Status != flowNodeStatusDone {
		t.Error("the flow node was not played to its end")
	}
}

// The runner's side of it: what it hands the turn is what the store actually holds, whatever else
// the body names.
func TestBoardImagesOfDropsWhatIsNotThere(t *testing.T) {
	rt := newRunnerTest(t, imageBoard)
	mustWriteBytes(t, filepath.Join(rt.root, "boards/shot.png"), []byte("0123456789"))

	images := rt.runner.imagesOf(&chainRun{handle: rt.handle}, *rt.board().flowNode("flow-node-1"))

	if len(images) != 1 || images[0].Path != filepath.Join(rt.root, "boards/shot.png") {
		t.Errorf("images = %+v, want the one picture the store holds", images)
	}
}

// The boards are one list shared by every machine, so a card may perfectly well name an agent
// this host does not offer, or a mode that agent does not have. Both are refused at the click,
// where the message can name the card's own words, rather than at the spawn where the run would
// have a conversation on the books already.
func TestPlayRefusesACardItsAgentCannotHonour(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"On an agent nobody has","body":"Do a thing","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/","agent":"gemini"}},
		{"id":"flow-node-2","title":"In a mode Codex lacks","body":"Do a thing","settings":{"agent":"claude","model":"gpt-5.1-codex",
		 "effort":"high","permission":"manual","folder":"/","agent":"codex"}}]}`)
	rt.hub.agents.entries = append(rt.hub.agents.entries, agentEntry{
		name: agentCodex, label: "Codex", agent: codexAgentAt(rt.cfg, "codex-stub"),
	})

	_, err := rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-1", "")
	if err == nil || !strings.Contains(err.Error(), "gemini") {
		t.Errorf("play of a card naming an agent this service has not = %v, want a refusal naming it", err)
	}
	_, err = rt.runner.play(core.Identity{User: "tester"}, rt.handle, "flow-node-2", "")
	if err == nil || !strings.Contains(err.Error(), "Codex") {
		t.Errorf("play of a card asking Codex for manual = %v, want a refusal naming the agent", err)
	}
	if rt.live() != nil {
		t.Error("a refused play must leave no run behind")
	}
}

// A card that names an agent is played in a conversation bound to it, which is what makes the turn
// run on that engine at all: the hub reads the agent off the conversation and never off the
// request.
func TestAPlayedCardBindsItsChatToItsAgent(t *testing.T) {
	rt := newRunnerTest(t, `{"flowNodes":[
		{"id":"flow-node-1","title":"A card","body":"Do a thing","settings":{"agent":"claude","model":"opus",
		 "effort":"high","permission":"bypassPermissions","folder":"/","agent":"claude"}}]}`)

	chat, err := rt.runner.conversationFor(&chainRun{owner: core.Identity{User: "tester"}}, flowNode{
		ID: "flow-node-1", Title: "A card",
		Settings: flowNodeSettings{Model: "opus", Effort: "high",
			Permission: permissionModeBypass, Folder: "/", Agent: agentClaude},
	}, playAgent{platform: agentClaude, model: "opus"})
	if err != nil {
		t.Fatalf("conversationFor = %v", err)
	}
	meta, err := rt.convs.get(chat)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Agent != agentClaude {
		t.Errorf("agent = %q, want the card's own", meta.Agent)
	}
}

func TestChainRunSchedulerDurationWaitsThenChains(t *testing.T) {
	content := strings.Replace(schedulerBoard(""), `"at":""`, `"duration":"150ms"`, 1)
	rt := newRunnerTest(t, content)
	started := time.Now()
	rt.play("flow-node-1")
	rt.waitState(chainRunStateScheduled)
	if len(rt.prompts()) != 0 {
		t.Fatal("successor played before the wait elapsed")
	}
	rt.waitIdle()
	if time.Since(started) < 150*time.Millisecond {
		t.Fatal("duration was skipped")
	}
	if rt.board().flowNode("flow-node-1").Status != flowNodeStatusDone || len(rt.prompts()) != 1 {
		t.Fatal("duration scheduler did not finish and play its successor")
	}
}

func TestChainRunSchedulerDurationCanBeStopped(t *testing.T) {
	content := strings.Replace(schedulerBoard(""), `"at":""`, `"duration":"1h"`, 1)
	rt := newRunnerTest(t, content)
	rt.play("flow-node-1")
	rt.waitState(chainRunStateScheduled)
	rt.stop()
	rt.waitIdle()
	if len(rt.prompts()) != 0 {
		t.Fatal("stopped duration played its successor")
	}
	if rt.board().flowNode("flow-node-1").Status != flowNodeStatusInterrupted {
		t.Fatal("stopped scheduler was not marked interrupted")
	}
}
