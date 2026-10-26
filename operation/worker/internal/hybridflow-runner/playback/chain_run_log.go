package playback

import (
	"encoding/json"
	"kiao/worker/internal/core/filesystem"
	agentfaults "kiao/worker/internal/hybridflow-runner/agents/faults"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// chainRunsDirName is where the run logs live under the state directory, beside the
// conversation registry they mirror.
const ChainRunsDirName = "chain-runs"

// legacyChainRunsDirName is what that directory was called before the run was renamed a
// chain run. A state written by an older build still carries it, and the first open moves
// it — see newChainRunLogStore.
const LegacyChainRunsDirName = "workflow-runs"

// chainRunMetaFileName names what the run is, and chainRunLogFileName what it did.
const ChainRunMetaFileName = "meta.json"

const ChainRunLogFileName = "run.jsonl"

// chainRunLogSchemaVersion is written into every meta.json so a later format change can be
// detected rather than silently misread.
const chainRunLogSchemaVersion = 1

// A run log names prompts, folders and endings rather than carrying transcripts, but it is
// still a record of what was asked for — the same posture as the rest of the state directory.
const chainRunLogDirPerm = 0o700

const chainRunLogFilePerm = 0o600

// maxChainRunLogs bounds the registry. Runs are evicted from memory after twenty ended
// ones; the disk keeps five times that, because a log is read about the run that stopped in
// the night and never about the fortieth one back — and unbounded, an automated client
// starting runs would fill a disk with history nobody asked for.
const maxChainRunLogs = 100

// maxChainRunLogBytes bounds one run's log. A run writes tens of records over hours, so
// this is a backstop rather than a budget: a run that has written a megabyte of decisions is
// one looping on something, and its beginning is the part nobody has seen.
const maxChainRunLogBytes = 1 << 20

// maxChainRunLogLineChars bounds one record. Every field here is service-composed, but a
// refusal message and a fault summary arrive from outside, and one of those carrying a page
// of proxy HTML must not spend the file's budget on a run that did nothing wrong.
const MaxChainRunLogLineChars = 8 << 10

// chainRunIDRe is the only thing standing between a run id and filepath.Join. A run id reaches
// the filesystem directly, so it is validated by shape rather than sanitised: "run-" + start
// millis (a directory listing is then chronological) + four random hex. It matches the ids play()
// mints, and nothing else in this directory is ever pruned.
var chainRunIDRe = regexp.MustCompile(`^run-[0-9]{13,}-[0-9a-f]{4}$`)

const ChainRunLogKindNote = "note"

const ChainRunLogKindState = "state"

const ChainRunLogKindTurn = "turn"

const ChainRunLogKindChain = "chain"

const ChainRunLogKindWait = "wait"

const ChainRunPromptCard = "card"

const chainRunPromptResume = "resume"

const chainRunPromptAttach = "attach"

const ChainRunPromptCompact = "compact"

const chainRunPromptBlockedFork = "blocked-fork"

const ChainRunChainForked = "forked"

const chainRunChainOwnChat = "own-chat"

const ChainRunChainEnd = "chain-end"

const chainRunChainNextUnplayable = "next-unplayable"

const chainRunChainNextEmpty = "next-empty"

const chainRunChainPinned = "pinned-elsewhere"

const chainRunChainReplayed = "replayed"

const chainRunChainHeld = "held"

const ChainRunChainFolderMismatch = "folder-mismatch"

const chainRunChainForkFailed = "fork-failed"

const chainRunChainGatewayWaiting = "gateway-waiting"

const chainRunChainGatewayForked = "gateway-forked"

// chainRunLogMeta is the on-disk record at
// <StatePath>/chain-runs/<id>/meta.json: what the run is, for a reader opening its directory
// without reading the log.
type ChainRunLogMeta struct {
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Board         string `json:"board"`
	RootFlowNode  string `json:"rootFlowNodeId"`
	Owner         string `json:"owner"`
	StartedAt     string `json:"startedAt"`
	UpdatedAt     string `json:"updatedAt"`
	// EndedAt and Ending are set when the run stops, and cleared when it is played again — a
	// restarted run is the same directory with a second play in it.
	EndedAt string `json:"endedAt,omitempty"`
	Ending  string `json:"ending,omitempty"`
	State   string `json:"state,omitempty"`
}

// chainRunLogLine is the header every record carries: when it was written, and what it is.
type chainRunLogLine struct {
	At   string `json:"at"`
	Kind string `json:"kind"`
}

// chainRunLogNote is something the run said or did, in a sentence: every notice it raised, at
// the level it raised it, and every lifecycle step it took.
//
// FlowNode is the card the run reports itself on, which lags by one card where the run has not
// been positioned yet — a board it could not read, a card gone from under it. The sentence names
// what the field cannot there.
type chainRunLogNote struct {
	chainRunLogLine
	FlowNode string `json:"flowNode,omitempty"`
	Chat     string `json:"chat,omitempty"`
	Level    string `json:"level,omitempty"`
	Text     string `json:"text"`
}

// chainRunLogState is where the run stands after a move: the card, the chat and the state. The
// skeleton of the file — everything else hangs off the moves.
type chainRunLogState struct {
	chainRunLogLine
	FlowNode string `json:"flowNode,omitempty"`
	Chat     string `json:"chat,omitempty"`
	State    string `json:"state"`
}

// chainRunLogTurn is one prompt answered. The prompt's own words are in the conversation it
// names; what is here is what the run decided on — the refusal, the fault, whether either is
// worth waiting out.
type chainRunLogTurn struct {
	chainRunLogLine
	FlowNode string `json:"flowNode,omitempty"`
	Chat     string `json:"chat,omitempty"`
	// Prompt is what the turn was sent as: card, resume, attach, compact or blocked-fork.
	Prompt     string `json:"prompt"`
	Agent      string `json:"agent,omitempty"`
	Model      string `json:"model,omitempty"`
	Effort     string `json:"effort,omitempty"`
	Permission string `json:"permissionMode,omitempty"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	// Stopped is the turn having been stopped from its chat rather than finished.
	Stopped bool `json:"stopped,omitempty"`
	// RefusalCode and Refusal are why no turn ever ran, where none did.
	RefusalCode string `json:"refusalCode,omitempty"`
	Refusal     string `json:"refusal,omitempty"`
	// Fault is what the turn came back with instead of an answer, in the board's few words for
	// it — and whether sending the same prompt again is worth anything, and whether what was met
	// was a usage limit rather than a failure at all.
	Fault      string `json:"fault,omitempty"`
	FaultRetry bool   `json:"faultRetry,omitempty"`
	FaultLimit bool   `json:"faultLimit,omitempty"`
}

// chainRunLogChain is one handoff: the finished card, what it says comes after it, the folders
// on both sides of the handoff, and which branch the chain took. The folders are the normalised
// ones the guard compared — "" is the store root — so a mismatch reads as the two values that
// differed rather than as the sentence it ended in.
type chainRunLogChain struct {
	chainRunLogLine
	FlowNode string `json:"flowNode"`
	Next     string `json:"next,omitempty"`
	Mode     string `json:"mode,omitempty"`
	Compact  bool   `json:"compact,omitempty"`
	// FromFolder is the finished card's, ToFolder the next card's, where there is a next card.
	FromFolder string `json:"fromFolder,omitempty"`
	ToFolder   string `json:"toFolder,omitempty"`
	// From is the chat the handoff was offered, Forked the copy the next card was given, and Chat
	// the chat the next card goes in — the fork, or its own where nothing was handed on.
	From   string `json:"from,omitempty"`
	Forked string `json:"forked,omitempty"`
	Chat   string `json:"chat,omitempty"`
	// Holder is the run already playing the next card, where that is why the chain ends.
	Holder   string `json:"holder,omitempty"`
	Decision string `json:"decision"`
}

// chainRunLogWait is one wait: the state the run reports meanwhile, and the moment it ends at.
type chainRunLogWait struct {
	chainRunLogLine
	FlowNode string `json:"flowNode,omitempty"`
	Chat     string `json:"chat,omitempty"`
	State    string `json:"state"`
	Until    string `json:"until"`
	Reason   string `json:"reason,omitempty"`
}

// chainRunLogStore owns the run logs: one directory per run under the state directory.
//
// The lock is the store's rather than the run's: several runs append at once, and an event is a
// rare thing — tens per run over hours — so one mutex serialising whole appends costs nothing and
// keeps every record a whole line. Every helper below is called with the runner's lock released,
// with the one exception of end(): it files under it, so that a run that reads as ended has filed
// its ending — once per run, and no lock order to keep, since nothing here ever takes the
// runner's lock back.
type ChainRunLogStore struct {
	Dir string

	mu sync.Mutex
}

// carryLegacyChainRunLogs moves the run logs a state written by an older build still carries
// under `workflow-runs` to `chain-runs`. One rename, once: afterwards there is nothing left to
// move. A move that fails is a warning and not an error — the runs still play, and their new
// logs land beside the old ones rather than instead of them.
func carryLegacyChainRunLogs(statePath string) {
	oldDir := filepath.Join(statePath, LegacyChainRunsDirName)
	if _, err := os.Stat(oldDir); err != nil {
		return
	}
	newDir := filepath.Join(statePath, ChainRunsDirName)
	if _, err := os.Stat(newDir); err == nil {
		return
	}
	if err := os.Rename(oldDir, newDir); err != nil {
		pkgBoards.LogChainRun.Warn("cannot carry the chain run logs over from workflow-runs",
			"dir", oldDir, "error", err)
	}
}

// newChainRunLogStore opens the registry, creating it. A failure is answered with nil rather
// than an error: nothing about a log is worth failing a service for, and every method below is
// nil-safe, so the whole of what an unwritable state directory costs is the debugging.
func NewChainRunLogStore(statePath string) *ChainRunLogStore {
	if strings.TrimSpace(statePath) == "" {
		return nil
	}
	carryLegacyChainRunLogs(statePath)
	dir := filepath.Join(statePath, ChainRunsDirName)
	if err := os.MkdirAll(dir, chainRunLogDirPerm); err != nil {
		pkgBoards.LogChainRun.Warn("cannot open the chain run logs",
			"dir", dir, "error", err)
		return nil
	}
	return &ChainRunLogStore{Dir: dir}
}

// create starts the log of one run: its directory, its meta.json, and the record saying it
// started. Older runs are pruned on the way — by name order, which is age order, and only the
// directories this service minted.
func (s *ChainRunLogStore) Create(id, name, board, rootFlowNode, owner string, startedAt time.Time) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	s.mu.Lock()
	PruneChainRunLogs(s.Dir, maxChainRunLogs-1)
	if err := os.MkdirAll(filepath.Join(s.Dir, id), chainRunLogDirPerm); err != nil {
		s.mu.Unlock()
		pkgBoards.LogChainRun.Warn("cannot open the chain run log", "run", id, "error", err)
		return
	}
	now := protocol.NowConversationTime()
	meta := ChainRunLogMeta{
		SchemaVersion: chainRunLogSchemaVersion,
		ID:            id,
		Name:          name,
		Board:         board,
		RootFlowNode:  rootFlowNode,
		Owner:         owner,
		StartedAt:     startedAt.UTC().Format(protocol.ConversationTimeFormat),
		UpdatedAt:     now,
		State:         ChainRunStatePlaying,
	}
	if err := writeChainRunLogMeta(filepath.Join(s.Dir, id, ChainRunMetaFileName), meta); err != nil {
		s.mu.Unlock()
		pkgBoards.LogChainRun.Warn("cannot open the chain run log", "run", id, "error", err)
		return
	}
	s.mu.Unlock()
	s.Append(id, chainRunLogNote{
		chainRunLogLine: chainRunLogLine{At: now, Kind: ChainRunLogKindNote},
		FlowNode:        rootFlowNode,
		Text:            "run started on board " + board,
	})
}

// finish rewrites the meta of a run that stopped, and appends the record saying why. A restart or
// a resume clears the ending again rather than starting a second log: one directory per run, and
// every play of it in the one file.
func (s *ChainRunLogStore) Finish(id, state, ending string, endedAt time.Time) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	now := protocol.NowConversationTime()
	s.WriteMeta(id, func(meta *ChainRunLogMeta) {
		meta.State = state
		meta.Ending = ending
		meta.EndedAt = endedAt.UTC().Format(protocol.ConversationTimeFormat)
		meta.UpdatedAt = now
	})
	s.Append(id, chainRunLogNote{
		chainRunLogLine: chainRunLogLine{At: now, Kind: ChainRunLogKindNote},
		Text:            "run ended: " + ending,
	})
}

// restarted marks a run played again from its first card: the start moves, the ending goes, and
// the log carries on in the same file.
func (s *ChainRunLogStore) Restarted(id, rootFlowNode string, startedAt time.Time) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	now := protocol.NowConversationTime()
	s.WriteMeta(id, func(meta *ChainRunLogMeta) {
		meta.StartedAt = startedAt.UTC().Format(protocol.ConversationTimeFormat)
		meta.UpdatedAt = now
		meta.State = ChainRunStatePlaying
		meta.EndedAt, meta.Ending = "", ""
	})
	s.Append(id, chainRunLogNote{
		chainRunLogLine: chainRunLogLine{At: now, Kind: ChainRunLogKindNote},
		FlowNode:        rootFlowNode,
		Text:            "run restarted from its first card",
	})
}

// resumed marks a suspended run picked back up: the log carries on where it stopped.
func (s *ChainRunLogStore) Resumed(id, flowNodeID, chat string) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	now := protocol.NowConversationTime()
	s.WriteMeta(id, func(meta *ChainRunLogMeta) {
		meta.UpdatedAt = now
		meta.State = ChainRunStatePlaying
		meta.EndedAt, meta.Ending = "", ""
	})
	s.Append(id, chainRunLogNote{
		chainRunLogLine: chainRunLogLine{At: now, Kind: ChainRunLogKindNote},
		FlowNode:        flowNodeID,
		Chat:            chat,
		Text:            "run resumed",
	})
}

// note appends a sentence: a notice the run raised, or a lifecycle step it took.
func (s *ChainRunLogStore) Note(id, flowNodeID, chat, level, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	s.Append(id, chainRunLogNote{
		chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindNote},
		FlowNode:        flowNodeID,
		Chat:            chat,
		Level:           level,
		Text:            text,
	})
}

// state appends a move: the card, the chat and the state after it.
func (s *ChainRunLogStore) State(id, flowNodeID, chat, state string) {
	s.Append(id, chainRunLogState{
		chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindState},
		FlowNode:        flowNodeID,
		Chat:            chat,
		State:           state,
	})
}

// turn appends one prompt answered.
func (s *ChainRunLogStore) Turn(id, flowNodeID, chat string, outcome ChainRunTurnOutcome) {
	rec := chainRunLogTurn{
		chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindTurn},
		FlowNode:        flowNodeID,
		Chat:            chat,
		Prompt:          outcome.Prompt,
		Agent:           outcome.Agent,
		Model:           outcome.Model,
		Effort:          outcome.Effort,
		Permission:      outcome.Permission,
		ExitCode:        outcome.ExitCode,
		Stopped:         outcome.Stopped,
	}
	if outcome.Refusal != nil {
		rec.RefusalCode, rec.Refusal = outcome.Refusal.Code, outcome.Refusal.Message
	}
	if outcome.Fault != nil {
		rec.Fault, rec.FaultRetry, rec.FaultLimit = outcome.Fault.Summary, outcome.Fault.Retry, outcome.Fault.Limit
	}
	s.Append(id, rec)
}

// chain appends one handoff: what the finished card says, the folders on both sides, and which
// branch the chain took.
func (s *ChainRunLogStore) Chain(id, flowNodeID string, decision ChainRunChainDecision) {
	s.Append(id, chainRunLogChain{
		chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindChain},
		FlowNode:        flowNodeID,
		Next:            decision.NextID,
		Mode:            decision.Done.OnSuccess.Mode,
		Compact:         decision.Done.OnSuccess.Compact,
		FromFolder:      decision.Done.Settings.WorkFolder(),
		ToFolder:        decision.ToFolder,
		From:            decision.From,
		Forked:          decision.Forked,
		Chat:            decision.Chat,
		Holder:          decision.Holder,
		Decision:        decision.Decision,
	})
}

// wait appends one wait: the state reported meanwhile, and the moment it ends at.
func (s *ChainRunLogStore) Wait(id, flowNodeID, chat, state string, until time.Time, reason string) {
	s.Append(id, chainRunLogWait{
		chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindWait},
		FlowNode:        flowNodeID,
		Chat:            chat,
		State:           state,
		Until:           until.UTC().Format(protocol.ConversationTimeFormat),
		Reason:          reason,
	})
}

// writeMeta applies mutate to the run's meta.json and persists it. A meta that cannot be read is
// started fresh rather than failing the write: a directory left anonymous by an interrupted
// creation is still a run worth naming.
func (s *ChainRunLogStore) WriteMeta(id string, mutate func(*ChainRunLogMeta)) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.Dir, id, ChainRunMetaFileName)
	meta := ChainRunLogMeta{ID: id}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &meta)
		meta.ID = id
	}
	meta.SchemaVersion = chainRunLogSchemaVersion
	if mutate != nil {
		mutate(&meta)
	}
	if err := writeChainRunLogMeta(path, meta); err != nil {
		pkgBoards.LogChainRun.Warn("cannot write the chain run log", "run", id, "error", err)
	}
}

// append appends one record, cut and bounded.
//
// The guards are in the order that makes them cheap: an unknown run and an unencodable record are
// answered before the lock is even taken, and the cut is applied to the encoded line rather than
// to each field, so one cap covers every shape of record including the ones added later. The run's
// directory is create's to have made: a write landing where no directory is fails and warns,
// like a transcript append beside it.
func (s *ChainRunLogStore) Append(id string, rec any) {
	if s == nil || !chainRunIDRe.MatchString(id) {
		return
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return
	}
	text := string(line)
	if len(text) > MaxChainRunLogLineChars {
		// Cut as bytes and not as runes: the line is JSON, so a cut of any kind makes it
		// unparseable, and what is left is read as the evidence it is rather than as a record.
		text = text[:MaxChainRunLogLineChars] + " …[cut]"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.Dir, id, ChainRunLogFileName)
	var size int64
	if info, err := os.Stat(path); err == nil {
		size = info.Size()
	}
	if size > maxChainRunLogBytes {
		// Already capped: the marker went in when it crossed, and every record since is dropped
		// rather than failing anything.
		return
	}
	if size+int64(len(text))+1 > maxChainRunLogBytes {
		marker, _ := json.Marshal(chainRunLogNote{
			chainRunLogLine: chainRunLogLine{At: protocol.NowConversationTime(), Kind: ChainRunLogKindNote},
			Text:            "the log reached its size limit; nothing after this point was kept",
		})
		_ = appendChainRunLogLine(path, string(marker))
		return
	}
	if err := appendChainRunLogLine(path, text); err != nil {
		pkgBoards.LogChainRun.Warn("cannot write the chain run log", "run", id, "error", err)
	}
}

// pruneChainRunLogs leaves at most keep run logs in the directory, deleting the oldest first.
// A run id is `run-<millis>-<hex>`, so name order is age order and no directory has to be stat'd
// to sort them. Only directories this service minted are ever removed: anything else in here is
// somebody's, and a prune is not a sweep.
func PruneChainRunLogs(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() && chainRunIDRe.MatchString(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	if len(names) <= keep {
		return
	}
	sort.Strings(names)
	for _, name := range names[:len(names)-keep] {
		_ = os.RemoveAll(filepath.Join(dir, name))
	}
}

// writeChainRunLogMeta replaces the run's meta.json atomically. It is rewritten at the run's
// boundaries and read by whoever opens the directory afterwards, so a half-written one would cost
// the name of the run the log beside it belongs to.
func writeChainRunLogMeta(path string, meta ChainRunLogMeta) error {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(path, append(data, '\n'), chainRunLogFilePerm)
}

// appendChainRunLogLine writes one record as a single line. The file is opened per call rather
// than kept open: a run writes tens of records over hours, and a descriptor held per run would be
// a handle on every run there ever was for the life of the process.
func appendChainRunLogLine(path, text string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, chainRunLogFilePerm)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(text + "\n"); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// chainRunTurnOutcome is one prompt answered, as the log keeps it: what it was sent as, what
// it ran on, and what came back.
type ChainRunTurnOutcome struct {
	Prompt     string
	Agent      string
	Model      string
	Effort     string
	Permission string
	ExitCode   *int
	Stopped    bool
	Refusal    *agentfaults.TurnRefusal
	Fault      *agentfaults.TurnFault
}

// chainRunChainDecision is one handoff, as the log keeps it: the finished card, the next card
// where one was resolved, and which branch the chain took.
type ChainRunChainDecision struct {
	// Done is the card just finished, carrying what it says comes after it and the folder it ran
	// in.
	Done pkgBoards.FlowNode
	// NextID is the card the chain names — resolved where it is on the board, the raw id where it
	// is not — and ToFolder that card's folder, where there is one.
	NextID   string
	ToFolder string
	// From is the chat the handoff was offered, Forked the copy the next card was given, and Chat
	// the chat the next card goes in.
	From   string
	Forked string
	Chat   string
	// Holder is the run already playing the next card, where that is why the chain ends.
	Holder string
	// Decision is the branch taken: forked, own-chat, or where the chain ended.
	Decision string
}

// logNote files a sentence about the run: a notice it raised, or a lifecycle step it took. Called
// with the runner's lock released — the values it files were captured under it, because file I/O
// under it would stall every client being told where the runs stand.
func (r *ChainRunner) LogNote(run *ChainRun, flowNodeID, chat, level, text string) {
	if r == nil || r.runLogs == nil || run == nil {
		return
	}
	r.runLogs.Note(run.Id, flowNodeID, chat, level, text)
}

// logState files a move: the card, the chat and the state after it.
func (r *ChainRunner) LogState(run *ChainRun, flowNodeID, chat, state string) {
	if r == nil || r.runLogs == nil || run == nil {
		return
	}
	r.runLogs.State(run.Id, flowNodeID, chat, state)
}

// logTurn files one prompt answered.
func (r *ChainRunner) LogTurn(run *ChainRun, flowNodeID, chat string, outcome ChainRunTurnOutcome) {
	if r == nil || r.runLogs == nil || run == nil {
		return
	}
	r.runLogs.Turn(run.Id, flowNodeID, chat, outcome)
}

// logChain files one handoff: what the finished card says, and which branch the chain took.
func (r *ChainRunner) LogChain(run *ChainRun, flowNodeID string, decision ChainRunChainDecision) {
	if r == nil || r.runLogs == nil || run == nil {
		return
	}
	r.runLogs.Chain(run.Id, flowNodeID, decision)
}

// logWait files one wait: the state reported meanwhile, and the moment it ends at.
func (r *ChainRunner) LogWait(run *ChainRun, flowNodeID, chat, state string, until time.Time, reason string) {
	if r == nil || r.runLogs == nil || run == nil {
		return
	}
	r.runLogs.Wait(run.Id, flowNodeID, chat, state, until, reason)
}
