package hybridflowrunner

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Each <StatePath>/conversations/<id> holds atomically replaced meta.json and
// append-only transcript.jsonl. Streaming stays in memory until the turn settles.
// Liveness belongs to ClaudeHub, not this display-history store.

const (
	// ConversationsDirName is exported for adoption of the previous state layout.
	ConversationsDirName = "conversations"
	metaFileName         = "meta.json"
	transcriptFileName   = "transcript.jsonl"

	// Readers accept any parseable schema version; conversations are display caches.
	conversationSchemaVersion = 1

	// Transcripts contain verbatim prompts and replies; keep them private to the service user.
	conversationDirPerm  = 0o700
	conversationFilePerm = 0o600

	// Compact to compactTargetBytes by dropping oldest records. This only trims display
	// history; the CLI session retains the model's memory.
	maxTranscriptBytes = 8 << 20
	compactTargetBytes = 4 << 20

	maxRecordChars = 256 * 1024
	// Bound slices as well as text: compaction must retain even an oversized newest record.
	maxRecordTools = 500
	maxRecordAsks = 100
	maxRecordBriefingChars = 16 * 1024
	maxBlockResultChars = 8 * 1024
	truncationMarker = "\n\n…[reply truncated by worker]"

	// Bound the registry without automatically deleting conversations.
	maxConversations = 500
	maxTitleRunes    = 60

	// Also the unnamed sentinel: only this title is replaced by the first prompt.
	defaultConversationTitle = "New conversation"

	// Match the hub's per-turn fallbacks for the default agent.
	defaultConversationModel  = "opus"
	defaultConversationEffort = "max"
)

// Notices are service-generated display records, never sent to the model.
const (
	roleUser      = "user"
	roleAssistant = "assistant"
	roleNotice    = "notice"
)

// Fixed-width UTC milliseconds permit chronological string comparison.
// RFC3339Nano trims zeros, so ".1Z" would sort after ".10001Z".
const conversationTimeFormat = "2006-01-02T15:04:05.000Z07:00"

func nowConversationTime() string { return time.Now().UTC().Format(conversationTimeFormat) }

// Validate client-supplied IDs before filepath.Join to prevent traversal.
// Creation millis order directories; random hex separates simultaneous creations.
// create retries collisions rather than trusting the random suffix.
var conversationIDRe = regexp.MustCompile(`^conv-[0-9]{13,}-[0-9a-f]{4}$`)

const conversationIDAttempts = 8

func newConversationID() string { return "conv-" + core.NowMillisStr() + "-" + core.RandID()[:4] }

// conversationMeta is meta.json; wire fields mirror AgentConversationDto in agent-types.ts.
type conversationMeta struct {
	SchemaVersion  int    `json:"schemaVersion"`
	ID             string `json:"id"`
	Title          string `json:"title"`
	TitleSetByUser bool   `json:"titleSetByUser"`
	// Folder is relative to RootPath ("" means root) and immutable: it determines
	// both the CLI cwd and the slug owning its session transcript.
	Folder string `json:"folder"`
	// Agent is immutable because sessions cannot move between engines; changing it requires
	// forking. Empty selects the default agent.
	Agent          string `json:"agent,omitempty"`
	Owner          string `json:"owner"`
	Model          string `json:"model"`
	Effort         string `json:"effort"`
	PermissionMode string `json:"permissionMode"`
	Thinking       bool   `json:"thinking"`
	// SessionID resumes the CLI session; empty starts a fresh one.
	SessionID   string `json:"sessionId"`
	SessionLost bool   `json:"sessionLost"`
	// ForkPending borrows the source SessionID until --fork-session yields a new one,
	// preventing two conversations from writing the same session. Clear on resume refusal too.
	ForkPending bool `json:"forkPending,omitempty"`
	// ForkAnchor selects the message at which to branch: Claude's --resume-session-at UUID
	// or Muse's MSP turn ID. Empty means session end; set and cleared with ForkPending.
	ForkAnchor string `json:"forkAnchor,omitempty"`
	// Fork provenance survives compaction of the matching notice.
	// ForkedFromMessage is empty for a whole-conversation fork.
	ForkedFrom        string `json:"forkedFrom,omitempty"`
	ForkedFromMessage string `json:"forkedFromMessage,omitempty"`
	Archived          bool   `json:"archived"`
	Pinned       bool   `json:"pinned"`
	MessageCount int    `json:"messageCount"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	// RunningAt marks a spawned, unsettled turn for startup recovery only;
	// clients get liveness from the in-memory turn registry.
	RunningAt string `json:"runningAt"`
	// RunningTurn lets startup settle the turn after its in-memory job is lost.
	RunningTurn  string `json:"runningTurn,omitempty"`
	LastExitCode *int   `json:"lastExitCode"`
	// TraceStream enables unbounded raw protocol capture for subsequent turn traces.
	// Other trace records are always written; existing traces are unaffected.
	TraceStream bool `json:"traceStream,omitempty"`
}

// conversationTool matches the socket tool_use name/summary pair.
type conversationTool struct {
	Name  string `json:"name"`
	Input string `json:"input,omitempty"`
}

// conversationBlock preserves reply order and matches socket sync blocks, adding timing.
type conversationBlock struct {
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
	// Input is the display summary; Detail is the full tool input.
	Name   string `json:"name,omitempty"`
	Input  string `json:"input,omitempty"`
	Detail string `json:"detail,omitempty"`
	// ToolUseID joins the agent's call ID to its result and permission ask.
	ToolUseID string `json:"toolUseId,omitempty"`
	// Empty Result means no reported outcome, including older records without outcome capture.
	Result string `json:"result,omitempty"`
	IsError bool `json:"isError,omitempty"`
	// Nil ExitCode means the agent reported no exit status.
	ExitCode *int `json:"exitCode,omitempty"`
	// At orders betweens within replies and anchors tool durations.
	At string `json:"at,omitempty"`
	// DurationMs is agent-reported or measured from call to result; zero means unmeasured.
	DurationMs int64 `json:"durationMs,omitempty"`
	// Subagent holds child activity; Text holds the parent's summary. Nil on other block kinds.
	Subagent *conversationSubagent `json:"subagent,omitempty"`
}

// conversationRecord is one transcript.jsonl line. Current assistant records use Blocks
// exclusively; legacy records use Text/Tools, whose ordering cannot be reconstructed.
// Text also carries user prompts and notices.
type conversationRecord struct {
	ID   string `json:"id"`
	Role string `json:"role"`
	Text string `json:"text"`
	At   string `json:"at"`
	// TurnID joins prompt, betweens, reply and logs. Empty for unowned records
	// (such as notices) and legacy records without turn IDs.
	TurnID string `json:"turnId,omitempty"`
	// Between marks input to a running turn. Records remain prompt, betweens, reply;
	// AfterBlocks locates betweens within the single reply record.
	Between bool `json:"between,omitempty"`
	// AfterBlocks counts reply blocks at arrival; nil means the landing position is unknown.
	AfterBlocks    *int                `json:"afterBlocks,omitempty"`
	Blocks         []conversationBlock `json:"blocks,omitempty"`
	Tools          []conversationTool  `json:"tools,omitempty"`
	Model          string              `json:"model,omitempty"`
	Effort         string              `json:"effort,omitempty"`
	PermissionMode string              `json:"permissionMode,omitempty"`
	ExitCode       *int                `json:"exitCode,omitempty"`
	Interrupted    bool                `json:"interrupted,omitempty"`
	Truncated      bool                `json:"truncated,omitempty"`
	// StartedAt/FinishedAt bracket the turn; At is record-write time.
	// FirstBlockMs measures time to the first reply block.
	StartedAt    string `json:"startedAt,omitempty"`
	FinishedAt   string `json:"finishedAt,omitempty"`
	DurationMs   int64  `json:"durationMs,omitempty"`
	FirstBlockMs int64  `json:"firstBlockMs,omitempty"`
	// EndReason is the agent's explanation or the CLI's final failure block; empty if none.
	EndReason string `json:"endReason,omitempty"`
	// Terminal preserves Muse's completed/cancelled/failed status, from which ExitCode is synthesized.
	Terminal string `json:"terminal,omitempty"`
	// Nil Usage means unknown, not free.
	Usage *conversationUsage `json:"usage,omitempty"`
	// Asks preserves permission/question decisions in ask order.
	Asks []conversationAsk `json:"asks,omitempty"`
	// ComposedPrompt includes attachment/image paths; user prompts only, excluding betweens.
	ComposedPrompt string `json:"composedPrompt,omitempty"`
	// SystemPrompt is the rendering briefing plus managed-agent instructions; user prompts only.
	SystemPrompt string `json:"systemPrompt,omitempty"`
	// Instructions holds managed-agent standing orders separately; empty outside board plays.
	Instructions string `json:"instructions,omitempty"`
	// PlayedBy is the managed agent ID; AgentRef is the card's agent ID or legacy engine name.
	// Both prompt and reply carry these; chat turns leave them empty.
	PlayedBy string `json:"playedBy,omitempty"`
	AgentRef string `json:"agentRef,omitempty"`
	// RunID, FlowNodeID and Board link back to the board play.
	RunID      string `json:"runId,omitempty"`
	FlowNodeID string `json:"flowNodeId,omitempty"`
	Board      string `json:"board,omitempty"`
	// Fork notice provenance uses stable IDs; ForkFromMessage is empty for a whole fork.
	ForkFrom        string `json:"forkFrom,omitempty"`
	ForkFromMessage string `json:"forkFromMessage,omitempty"`
	// SessionAnchor is the last CLI message UUID of an assistant turn, if captured.
	// Display-history cuts do not affect model memory: --resume-session-at uses this anchor
	// to cut the actual session. UUIDs remain valid across --fork-session.
	SessionAnchor string `json:"sessionAnchor,omitempty"`
	// User attachment metadata is stored in full: it must remain readable after the
	// attached files are swept after a month.
	Attachments []conversationAttachment `json:"attachments,omitempty"`
}

type conversationAttachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType,omitempty"`
}

// Wire values shared with socket permission_resolved outcomes.
const (
	askOutcomeAllow     = "allow"
	askOutcomeDeny      = "deny"
	askOutcomeCancelled = "cancelled"
)

// conversationAsk snapshots a resolved AgentAsk with its decision.
type conversationAsk struct {
	// Unique for the life of the turn.
	ID string `json:"id"`
	Tool        string `json:"tool"`
	DisplayName string `json:"displayName,omitempty"`
	Description string `json:"description,omitempty"`
	// Input is the rendered summary the person decided on, not the verbatim tool object.
	Input string `json:"input,omitempty"`
	// Answers is keyed by full question text; a missing entry means unanswered.
	Questions []map[string]any  `json:"questions,omitempty"`
	Answers   map[string]string `json:"answers,omitempty"`
	// Cancelled means the agent withdrew the ask or the turn ended with it pending.
	Outcome string `json:"outcome"`
	// DecidedBy names the user or resolver: countdown (manualLive), bypass (mode),
	// agent (withdrawn), stop or end (pending at settlement).
	DecidedBy string `json:"decidedBy,omitempty"`
	At        string `json:"at,omitempty"`
}

// conversationUsage stores the agent's reported figures with their accounting scope.
type conversationUsage struct {
	InputTokens      int64   `json:"inputTokens,omitempty"`
	OutputTokens     int64   `json:"outputTokens,omitempty"`
	CacheReadTokens  int64   `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64   `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64   `json:"reasoningTokens,omitempty"`
	TotalCostUSD     float64 `json:"totalCostUSD,omitempty"`
	// Scope is turn; legacy session totals remain readable but are no longer written.
	Scope string `json:"scope,omitempty"`
}

// blockText excludes thinking but includes delegation summaries.
// Falls back to Text for legacy records without blocks.
func (rec conversationRecord) blockText() string {
	if len(rec.Blocks) == 0 {
		return rec.Text
	}
	var sb strings.Builder
	for _, block := range rec.Blocks {
		if block.Kind == blockKindText || block.Kind == blockKindSubagent {
			sb.WriteString(block.Text)
		}
	}
	return sb.String()
}

// blockTail isolates the final text or delegation summary: a CLI may append a failure
// notice after a long reply, and end-reason detection needs that notice alone.
func (rec conversationRecord) blockTail() string {
	if len(rec.Blocks) == 0 {
		return rec.Text
	}
	for i := len(rec.Blocks) - 1; i >= 0; i-- {
		if rec.Blocks[i].Kind == blockKindText || rec.Blocks[i].Kind == blockKindSubagent {
			return rec.Blocks[i].Text
		}
	}
	return ""
}

// blockTools includes child calls at their delegation's position; supports legacy Tools.
func (rec conversationRecord) blockTools() []conversationTool {
	if len(rec.Blocks) == 0 {
		return rec.Tools
	}
	tools := []conversationTool{}
	var collect func(blocks []conversationBlock)
	collect = func(blocks []conversationBlock) {
		for _, block := range blocks {
			if block.Kind == blockKindToolUse {
				tools = append(tools, conversationTool{Name: block.Name, Input: block.Input})
			}
			if block.Subagent != nil {
				collect(block.Subagent.Blocks)
			}
		}
	}
	collect(rec.Blocks)
	return tools
}

// conversationEntry serializes writes to one conversation's metadata and transcript.
type conversationEntry struct {
	mu   sync.Mutex
	meta conversationMeta
}

// ConversationStore owns the server-side conversation registry.
// Lock order: store.mu → entry.mu; never acquire the index lock under an entry lock.
// Conversation file I/O holds only that entry's lock.
type ConversationStore struct {
	dir string

	// Caps are injectable for tests; production leaves them fixed.
	maxConversations   int
	maxTranscriptBytes int64
	compactTarget      int64

	// Injectable for deterministic collision tests; fixed in production.
	newID func() string

	mu    sync.Mutex
	index map[string]*conversationEntry
}

// newConversationStore loads metadata only; transcripts are read on demand.
// Unreadable metadata is logged and skipped, leaving its directory for recovery.
func newConversationStore(dir string) (*ConversationStore, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, core.ErrEmptyStatePath
	}
	if err := os.MkdirAll(dir, conversationDirPerm); err != nil {
		return nil, fmt.Errorf("failed to create the conversation directory %s: %w", dir, err)
	}
	s := &ConversationStore{
		dir:                dir,
		maxConversations:   maxConversations,
		maxTranscriptBytes: maxTranscriptBytes,
		compactTarget:      compactTargetBytes,
		newID:              newConversationID,
		index:              map[string]*conversationEntry{},
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read the conversation directory %s: %w", dir, err)
	}
	for _, dirEntry := range entries {
		if !dirEntry.IsDir() || !conversationIDRe.MatchString(dirEntry.Name()) {
			continue
		}
		meta, err := readConversationMeta(filepath.Join(dir, dirEntry.Name(), metaFileName))
		if err != nil {
			logConv.Warn("skipping an unreadable conversation", "id", dirEntry.Name(), "error", err)
			continue
		}
		// The directory name is authoritative; trusting a mismatched file ID would break lookup.
		meta.ID = dirEntry.Name()
		s.index[meta.ID] = &conversationEntry{meta: meta}
	}
	logConv.Info("conversations loaded", "dir", dir, "count", len(s.index))
	return s, nil
}

// create mints directory IDs internally and holds the index lock across creation
// and persistence so concurrent requests cannot exceed the cap.
func (s *ConversationStore) create(meta conversationMeta) (conversationMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.index) >= s.maxConversations {
		return conversationMeta{}, &core.HTTPError{Status: http.StatusConflict, Msg: fmt.Sprintf(
			"There are already %d conversations; delete or archive some first.", s.maxConversations)}
	}

	id, err := s.mintLocked()
	if err != nil {
		return conversationMeta{}, err
	}
	meta.ID = id
	meta.SchemaVersion = conversationSchemaVersion
	meta.Folder = core.NormaliseVirtual(meta.Folder)
	meta.Title = normaliseTitle(meta.Title)
	meta.MessageCount = 0
	meta.RunningAt = ""
	now := nowConversationTime()
	meta.CreatedAt, meta.UpdatedAt = now, now

	if err := writeConversationMeta(s.metaPath(meta.ID), meta); err != nil {
		// Remove the incomplete directory so startup will not keep reporting unreadable metadata.
		_ = os.RemoveAll(s.convDir(meta.ID))
		return conversationMeta{}, err
	}
	s.index[meta.ID] = &conversationEntry{meta: meta}
	// Do not log the title: it may contain prompt text.
	logConv.Info("conversation created", "id", meta.ID, "folder", meta.Folder, "owner", meta.Owner)
	return meta, nil
}

// fork copies history before fromMessageID (empty copies everything), leaving that
// prompt available to edit and resend. The source is unchanged; ForkPending prevents
// the copy from writing the source's CLI session.
//
// Release source.mu before create takes store.mu to preserve lock order.
// The handler must reject a running source: a concurrent turn could put the copied
// history behind the session being branched.
func (s *ConversationStore) fork(sourceID, owner, fromMessageID string, onto forkTarget) (conversationMeta, error) {
	source, err := s.entry(sourceID)
	if err != nil {
		return conversationMeta{}, err
	}
	source.mu.Lock()
	sourceMeta := source.meta
	records, err := readTranscript(s.transcriptPath(sourceID))
	source.mu.Unlock()
	if err != nil {
		return conversationMeta{}, err
	}
	records, anchor, err := forkPoint(records, fromMessageID)
	if err != nil {
		return conversationMeta{}, err
	}
	// A session can be carried only on the same engine with branching support and,
	// for a partial fork, a captured anchor. Otherwise copy display history only;
	// the notice must disclose that the model will not remember it.
	changedAgent := resolvedAgent(onto.agent) != resolvedAgent(sourceMeta.Agent)
	sessionID := strings.TrimSpace(sourceMeta.SessionID)
	carriesSession := !changedAgent && onto.branches && sessionID != "" &&
		(fromMessageID == "" || anchor != "")
	if !carriesSession {
		sessionID, anchor = "", ""
	}

	// Preserve a source-derived fork title across its first prompt; unnamed sources stay unnamed.
	title, named := forkTitle(sourceMeta.Title), true
	if sourceMeta.Title == defaultConversationTitle {
		title, named = defaultConversationTitle, false
	}

	// Model, effort and permission modes are engine-specific; use target defaults on engine changes.
	model, effort, mode := sourceMeta.Model, sourceMeta.Effort, sourceMeta.PermissionMode
	if changedAgent {
		model, effort, mode = onto.model, onto.effort, onto.permissionMode
	}

	meta, err := s.create(conversationMeta{
		Title:          title,
		TitleSetByUser: named,
		Folder:         sourceMeta.Folder,
		Agent:          resolvedAgent(onto.agent),
		Owner:          owner,
		Model:          model,
		Effort:         effort,
		PermissionMode: mode,
		Thinking:       sourceMeta.Thinking,
		SessionID:      sessionID,
		SessionLost:    carriesSession && sourceMeta.SessionLost,
		ForkPending: carriesSession,
		ForkAnchor:  anchor,
		ForkedFrom:        sourceID,
		ForkedFromMessage: fromMessageID,
	})
	if err != nil {
		return conversationMeta{}, err
	}

	records = append(records, normaliseRecord(conversationRecord{
		Role: roleNotice, Text: forkNotice(sourceMeta.Title, carriesSession, onto.label),
		ForkFrom: sourceID, ForkFromMessage: fromMessageID,
	}))
	forked, err := s.seedTranscript(meta.ID, records)
	if err != nil {
		// Do not leave a fork holding a session whose copied history failed to persist.
		if delErr := s.delete(meta.ID); delErr != nil {
			logConv.Warn("cannot drop a fork that was not written", "id", meta.ID, "error", delErr)
		}
		return conversationMeta{}, err
	}
	logConv.Info("conversation forked", "id", forked.ID, "from", sourceID,
		"folder", forked.Folder, "agent", forked.Agent, "owner", owner,
		"messages", forked.MessageCount, "at", fromMessageID, "carries_session", carriesSession)
	return forked, nil
}

// forkPoint keeps records before fromMessageID and returns the last assistant anchor.
// Empty ID means no session cut, not the last recorded anchor. Unknown IDs return 404:
// silently copying everything could give the model more history than requested.
func forkPoint(records []conversationRecord, fromMessageID string) ([]conversationRecord, string, error) {
	if fromMessageID == "" {
		return records, "", nil
	}
	at := -1
	for i, rec := range records {
		if rec.ID == fromMessageID {
			at = i
			break
		}
	}
	if at < 0 {
		return nil, "", &core.HTTPError{Status: http.StatusNotFound,
			Msg: "That message is not in this conversation's transcript."}
	}
	kept := records[:at]
	for i := len(kept) - 1; i >= 0; i-- {
		if kept[i].Role == roleAssistant && kept[i].SessionAnchor != "" {
			return kept, kept[i].SessionAnchor, nil
		}
	}
	return kept, "", nil
}

// Unknown IDs return os.ErrNotExist (404); malformed IDs return errBadConversationID (400).
func (s *ConversationStore) get(id string) (conversationMeta, error) {
	entry, err := s.entry(id)
	if err != nil {
		return conversationMeta{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return entry.meta, nil
}

func (s *ConversationStore) list(includeArchived bool) []conversationMeta {
	s.mu.Lock()
	entries := make([]*conversationEntry, 0, len(s.index))
	for _, entry := range s.index {
		entries = append(entries, entry)
	}
	s.mu.Unlock()

	metas := make([]conversationMeta, 0, len(entries))
	for _, entry := range entries {
		entry.mu.Lock()
		meta := entry.meta
		entry.mu.Unlock()
		if meta.Archived && !includeArchived {
			continue
		}
		metas = append(metas, meta)
	}
	// Fixed-width UTC sorts chronologically; IDs break timestamp ties for stable results.
	sort.Slice(metas, func(i, j int) bool {
		if metas[i].UpdatedAt != metas[j].UpdatedAt {
			return metas[i].UpdatedAt > metas[j].UpdatedAt
		}
		return metas[i].ID > metas[j].ID
	})
	return metas
}

func (s *ConversationStore) update(id string, mutate func(*conversationMeta)) (conversationMeta, error) {
	entry, err := s.entry(id)
	if err != nil {
		return conversationMeta{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return s.mutateLocked(entry, mutate)
}

// delete removes only our history; the CLI's own session file is retained.
func (s *ConversationStore) delete(id string) error {
	if !conversationIDRe.MatchString(id) {
		return errBadConversationID
	}
	s.mu.Lock()
	entry, known := s.index[id]
	delete(s.index, id)
	s.mu.Unlock()
	if !known {
		return fmt.Errorf("%w: conversation %s", os.ErrNotExist, id)
	}

	// Remove from the index before waiting for in-flight writes, then delete under entry.mu.
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if err := os.RemoveAll(s.convDir(id)); err != nil {
		return fmt.Errorf("failed to delete conversation %s: %w", id, err)
	}
	logConv.Info("conversation deleted", "id", id)
	return nil
}

func (s *ConversationStore) messages(id string) ([]conversationRecord, error) {
	entry, err := s.entry(id)
	if err != nil {
		return nil, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return readTranscript(s.transcriptPath(id))
}

// appendAndUpdate appends and persists metadata under one entry lock at each turn boundary.
func (s *ConversationStore) appendAndUpdate(id string, rec conversationRecord,
	mutate func(*conversationMeta)) (conversationMeta, error) {
	entry, err := s.entry(id)
	if err != nil {
		return conversationMeta{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()

	rec = normaliseRecord(rec)
	size, err := appendRecord(s.transcriptPath(id), rec)
	if err != nil {
		return conversationMeta{}, err
	}

	// Compaction replaces dropped records with one notice; count what readers will receive.
	delta := 1
	if size > s.maxTranscriptBytes {
		dropped, err := s.compactLocked(id)
		if err != nil {
			// The record is already written; a compaction failure must not fail the turn boundary.
			logConv.Warn("cannot compact a transcript", "id", id, "error", err)
		} else if dropped > 0 {
			delta += 1 - dropped
		}
	}

	return s.mutateLocked(entry, func(meta *conversationMeta) {
		meta.MessageCount += delta
		if meta.MessageCount < 0 {
			meta.MessageCount = 0
		}
		// Only the first prompt replaces the unnamed sentinel; betweens never name a conversation.
		if rec.Role == roleUser && !rec.Between && !meta.TitleSetByUser && meta.Title == defaultConversationTitle {
			meta.Title = conversationTitle(rec.Text)
		}
		if mutate != nil {
			mutate(meta)
		}
	})
}

// sweepInterrupted runs before the startup listener opens. The prompt was persisted
// before spawn, so every abandoned turn has a user record to settle.
func (s *ConversationStore) sweepInterrupted() int {
	s.mu.Lock()
	entries := make([]*conversationEntry, 0, len(s.index))
	for _, entry := range s.index {
		entries = append(entries, entry)
	}
	s.mu.Unlock()

	settled := 0
	for _, entry := range entries {
		entry.mu.Lock()
		id, running, turn := entry.meta.ID, entry.meta.RunningAt != "", entry.meta.RunningTurn
		entry.mu.Unlock()
		if !running {
			continue
		}
		// The lost reply cannot be reconstructed; Interrupted and EndReason explain the gap.
		_, err := s.appendAndUpdate(id,
			conversationRecord{Role: roleAssistant, TurnID: turn, Interrupted: true,
				EndReason: "The service restarted while this turn was running."},
			func(meta *conversationMeta) { meta.RunningAt, meta.RunningTurn = "", "" })
		if err != nil {
			logConv.Warn("cannot settle an interrupted conversation", "id", id, "error", err)
			continue
		}
		settled++
	}
	return settled
}

// *Locked methods require store.mu for mintLocked, entry.mu for all others.

// mintLocked uses Mkdir to detect collisions, including directories skipped at startup
// for unreadable metadata. Reusing one would overwrite its metadata and mix histories.
func (s *ConversationStore) mintLocked() (string, error) {
	for attempt := 0; attempt < conversationIDAttempts; attempt++ {
		id := s.newID()
		if _, taken := s.index[id]; taken {
			continue
		}
		err := os.Mkdir(s.convDir(id), conversationDirPerm)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", fmt.Errorf("failed to create conversation %s: %w", id, err)
		}
		return id, nil
	}
	return "", fmt.Errorf("failed to mint a free conversation id in %d attempts", conversationIDAttempts)
}

// seedTranscript writes a fork's initial history under entry.mu; other writes append or compact.
func (s *ConversationStore) seedTranscript(id string, records []conversationRecord) (conversationMeta, error) {
	entry, err := s.entry(id)
	if err != nil {
		return conversationMeta{}, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if err := writeTranscript(s.transcriptPath(id), records); err != nil {
		return conversationMeta{}, err
	}
	return s.mutateLocked(entry, func(meta *conversationMeta) { meta.MessageCount = len(records) })
}

func (s *ConversationStore) convDir(id string) string { return filepath.Join(s.dir, id) }
func (s *ConversationStore) metaPath(id string) string {
	return filepath.Join(s.convDir(id), metaFileName)
}

func (s *ConversationStore) transcriptPath(id string) string {
	return filepath.Join(s.convDir(id), transcriptFileName)
}

// entry validates IDs before any filepath.Join. Malformed input is not echoed in
// client-visible errors; unknown IDs are echoed only after validation.
func (s *ConversationStore) entry(id string) (*conversationEntry, error) {
	if !conversationIDRe.MatchString(id) {
		return nil, errBadConversationID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.index[id]
	if !ok {
		return nil, fmt.Errorf("%w: conversation %s", os.ErrNotExist, id)
	}
	return entry, nil
}

// mutateLocked persists a copy before updating memory, so failed writes leave both unchanged.
// Restore ID, cwd and creation time after mutation to preserve identity. UpdatedAt is
// stamped before mutation so callers can override it.
func (s *ConversationStore) mutateLocked(entry *conversationEntry,
	mutate func(*conversationMeta)) (conversationMeta, error) {
	meta := entry.meta
	meta.UpdatedAt = nowConversationTime()
	if mutate != nil {
		mutate(&meta)
	}
	meta.ID, meta.Folder, meta.CreatedAt = entry.meta.ID, entry.meta.Folder, entry.meta.CreatedAt
	meta.SchemaVersion = conversationSchemaVersion
	meta.Title = normaliseTitle(meta.Title)

	if err := writeConversationMeta(s.metaPath(meta.ID), meta); err != nil {
		return conversationMeta{}, err
	}
	entry.meta = meta
	return meta, nil
}

// compactLocked replaces oldest records with a notice and returns the dropped count.
// The megabyte threshold amortizes whole-file reads and rewrites.
func (s *ConversationStore) compactLocked(id string) (int, error) {
	path := s.transcriptPath(id)
	records, err := readTranscript(path)
	if err != nil {
		return 0, err
	}

	kept, size := 0, int64(0)
	for i := len(records) - 1; i >= 0; i-- {
		line, err := json.Marshal(records[i])
		if err != nil {
			return 0, err
		}
		if size+int64(len(line))+1 > s.compactTarget {
			break
		}
		size += int64(len(line)) + 1
		kept++
	}
	// Always retain the just-appended newest record, even when it alone exceeds the target.
	if kept == 0 && len(records) > 0 {
		kept = 1
	}
	dropped := len(records) - kept
	if dropped <= 0 {
		return 0, nil
	}

	notice := normaliseRecord(conversationRecord{Role: roleNotice, Text: fmt.Sprintf(
		"%d earlier messages were trimmed from this transcript to keep it a manageable size. "+
			"The Claude session still has them.", dropped)})

	if err := writeTranscript(path, append([]conversationRecord{notice}, records[dropped:]...)); err != nil {
		return 0, err
	}
	logConv.Info("transcript compacted", "id", id, "dropped", dropped, "kept", kept)
	return dropped, nil
}

func readConversationMeta(path string) (conversationMeta, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return conversationMeta{}, err
	}
	var meta conversationMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return conversationMeta{}, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	return meta, nil
}

// writeConversationMeta replaces metadata atomically; a torn write could lose the conversation.
func writeConversationMeta(path string, meta conversationMeta) error {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return core.WriteFileAtomic(path, append(data, '\n'), conversationFilePerm)
}

// appendRecord writes one JSON line, escaping embedded newlines. Open per call to avoid
// holding a descriptor per conversation. No fsync: a torn final line is skipped by the
// reader, losing at most that record; the CLI session holds continuation state.
func appendRecord(path string, rec conversationRecord) (int64, error) {
	data, err := json.Marshal(rec)
	if err != nil {
		return 0, err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, conversationFilePerm)
	if err != nil {
		return 0, fmt.Errorf("failed to open %s: %w", path, err)
	}
	if _, err := f.Write(append(data, '\n')); err != nil {
		f.Close()
		return 0, fmt.Errorf("failed to append to %s: %w", path, err)
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, fmt.Errorf("failed to append to %s: %w", path, err)
	}
	return info.Size(), nil
}

// writeTranscript atomically rewrites history for compaction or fork seeding:
// a torn append loses one record, but a torn rewrite could lose the whole transcript.
func writeTranscript(path string, records []conversationRecord) error {
	var buf bytes.Buffer
	for _, rec := range records {
		line, err := json.Marshal(rec)
		if err != nil {
			return err
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	return core.WriteFileAtomic(path, buf.Bytes(), conversationFilePerm)
}

// readTranscript tolerates malformed lines because unsynced appends can leave a torn final line.
func readTranscript(path string) ([]conversationRecord, error) {
	f, err := os.Open(path)
	if err != nil {
		// No transcript exists until the first prompt.
		if os.IsNotExist(err) {
			return []conversationRecord{}, nil
		}
		return nil, err
	}
	defer f.Close()

	records := []conversationRecord{}
	reader := bufio.NewReader(f)
	skipped := 0
	for {
		line, readErr := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			var rec conversationRecord
			if json.Unmarshal([]byte(trimmed), &rec) == nil {
				records = append(records, rec)
			} else {
				skipped++
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				return nil, readErr
			}
			break
		}
	}
	if skipped > 0 {
		logConv.Warn("skipped transcript lines that do not parse", "file", path, "skipped", skipped)
	}
	return records, nil
}

// normaliseRecord enforces record caps on rune boundaries to preserve valid UTF-8.
func normaliseRecord(rec conversationRecord) conversationRecord {
	if rec.ID == "" {
		rec.ID = "msg-" + core.NowMillisStr() + "-" + core.RandID()[:4]
	}
	if rec.At == "" {
		rec.At = nowConversationTime()
	}
	if runes := []rune(rec.Text); len(runes) > maxRecordChars {
		rec.Text = string(runes[:maxRecordChars]) + truncationMarker
		rec.Truncated = true
	}
	if capped, cut := capRecordText(rec.ComposedPrompt, maxRecordChars); cut {
		rec.ComposedPrompt, rec.Truncated = capped, true
	}
	if capped, cut := capRecordText(rec.SystemPrompt, maxRecordBriefingChars); cut {
		rec.SystemPrompt, rec.Truncated = capped, true
	}
	if capped, cut := capRecordText(rec.Instructions, maxRecordBriefingChars); cut {
		rec.Instructions, rec.Truncated = capped, true
	}
	// Retain the newest tool calls and asks; Truncated discloses the missing history.
	if len(rec.Tools) > maxRecordTools {
		rec.Tools = rec.Tools[len(rec.Tools)-maxRecordTools:]
		rec.Truncated = true
	}
	if len(rec.Asks) > maxRecordAsks {
		rec.Asks = rec.Asks[len(rec.Asks)-maxRecordAsks:]
		rec.Truncated = true
	}
	return capBlocks(rec)
}

func capRecordText(text string, max int) (string, bool) {
	if runes := []rune(text); len(runes) > max {
		return string(runes[:max]) + truncationMarker, true
	}
	return text, false
}

// capBlocks retains the end of a turn under shared text/tool budgets.
// Child blocks consume the same budgets at their delegation's position.
func capBlocks(rec conversationRecord) conversationRecord {
	if len(rec.Blocks) == 0 {
		return rec
	}
	// Bound tool outputs recursively, including results captured by child agents.
	capNestedResults(rec.Blocks, &rec.Truncated)
	chars, tools := 0, 0
	kept, cut := capBlockList(rec.Blocks, &chars, &tools)
	rec.Blocks = kept
	if cut {
		rec.Truncated = true
	}
	return rec
}

func capNestedResults(blocks []conversationBlock, truncated *bool) {
	for i := range blocks {
		if capped, cut := capRecordText(blocks[i].Result, maxBlockResultChars); cut {
			blocks[i].Result, *truncated = capped, true
		}
		if sub := blocks[i].Subagent; sub != nil {
			capNestedResults(sub.Blocks, truncated)
		}
	}
}

// capBlockList spends shared budgets newest-first. Cap child lists in place and mark
// both the delegation and record truncated.
func capBlockList(blocks []conversationBlock, chars, tools *int) ([]conversationBlock, bool) {
	start, cut := 0, false
	for i := len(blocks) - 1; i >= 0; i-- {
		block := &blocks[i]
		if block.Kind == blockKindToolUse {
			if *tools == maxRecordTools {
				start, cut = i+1, true
				break
			}
			*tools++
		}
		if sub := block.Subagent; sub != nil {
			kept, subCut := capBlockList(sub.Blocks, chars, tools)
			sub.Blocks = kept
			if subCut {
				sub.Truncated, cut = true, true
			}
		}
		runes := []rune(block.Text)
		if *chars+len(runes) > maxRecordChars {
			if room := maxRecordChars - *chars; room > 0 {
				block.Text = truncationMarker + string(runes[len(runes)-room:])
				start, cut = i, true
			} else {
				start, cut = i+1, true
			}
			break
		}
		*chars += len(runes)
		start = i
	}
	if cut {
		return blocks[start:], true
	}
	return blocks, false
}

func conversationTitle(prompt string) string {
	for _, candidate := range strings.Split(prompt, "\n") {
		if line := collapseWhitespace(candidate); line != "" {
			return truncateTitle(line)
		}
	}
	return defaultConversationTitle
}

const forkTitleSuffix = " (fork)"

// Keep the fork suffix when truncating so the copy remains distinguishable from its source.
func forkTitle(sourceTitle string) string {
	base := collapseWhitespace(sourceTitle)
	if base == "" {
		base = defaultConversationTitle
	}
	if room := maxTitleRunes - len([]rune(forkTitleSuffix)); len([]rune(base)) > room {
		base = strings.TrimRight(string([]rune(base)[:room-1]), " ") + "…"
	}
	return base + forkTitleSuffix
}

// forkNotice marks uncopied model context explicitly when only display history was retained.
func forkNotice(sourceTitle string, carriesSession bool, agentLabel string) string {
	notice := fmt.Sprintf("Forked from “%s”. Everything above happened there. From here the two "+
		"conversations go their own way, and neither can see what is said in the other.",
		collapseWhitespace(sourceTitle))
	if !carriesSession {
		notice += fmt.Sprintf(" %s was not given that history: it is here to be read, not remembered.",
			orDefault(agentLabel, "The agent"))
	}
	return notice
}

// forkTarget carries the caller-resolved agent capabilities and engine-specific defaults.
type forkTarget struct {
	// Empty selects the default agent.
	agent string
	label string
	// Without branching support, even same-agent forks retain only display history.
	branches bool

	// Defaults apply only when the engine changes; same-engine forks retain source settings.
	model, effort, permissionMode string
}

func normaliseTitle(title string) string {
	if collapsed := collapseWhitespace(title); collapsed != "" {
		return truncateTitle(collapsed)
	}
	return defaultConversationTitle
}

// Include the ellipsis in maxTitleRunes so normalization is idempotent.
func truncateTitle(line string) string {
	runes := []rune(line)
	if len(runes) <= maxTitleRunes {
		return line
	}
	cut := runes[:maxTitleRunes-1]
	// Prefer a word boundary only if it preserves more than half the title budget.
	for i := len(cut) - 1; i > maxTitleRunes/2; i-- {
		if cut[i] == ' ' {
			cut = cut[:i]
			break
		}
	}
	return strings.TrimRight(string(cut), " ") + "…"
}

func collapseWhitespace(s string) string { return strings.Join(strings.Fields(s), " ") }
