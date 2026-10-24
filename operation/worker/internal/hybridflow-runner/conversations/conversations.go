package conversations

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	idgen "kiao/worker/internal/core/ids"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/agents/protocol"
	"kiao/worker/internal/hybridflow-runner/boards"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// ConversationsDirName is exported for adoption of the previous state layout.
const ConversationsDirName = "conversations"

const metaFileName = "meta.json"

const transcriptFileName = "transcript.jsonl"

// Readers accept any parseable schema version; conversations are display caches.
const conversationSchemaVersion = 1

// Transcripts contain verbatim prompts and replies; keep them private to the service user.
const conversationDirPerm = 0o700

const conversationFilePerm = 0o600

// Compact to compactTargetBytes by dropping oldest records. This only trims display
// history; the CLI session retains the model's memory.
const maxTranscriptBytes = 8 << 20

const compactTargetBytes = 4 << 20

const maxRecordChars = 256 * 1024

// Bound slices as well as text: compaction must retain even an oversized newest record.
const MaxRecordTools = 500

const maxRecordAsks = 100

const maxRecordBriefingChars = 16 * 1024

// Bound the registry without automatically deleting conversations.
const maxConversations = 500

const maxTitleRunes = 60

// Also the unnamed sentinel: only this title is replaced by the first prompt.
const DefaultConversationTitle = "New conversation"

const RoleUser = "user"

const RoleAssistant = "assistant"

const RoleNotice = "notice"

// Validate client-supplied IDs before filepath.Join to prevent traversal.
// Creation millis order directories; random hex separates simultaneous creations.
// create retries collisions rather than trusting the random suffix.
var ConversationIDRe = regexp.MustCompile(`^conv-[0-9]{13,}-[0-9a-f]{4}$`)

const conversationIDAttempts = 8

func newConversationID() string { return "conv-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4] }

// conversationMeta is meta.json; wire fields mirror AgentConversationDto in agent-types.ts.
type ConversationMeta struct {
	AgentVersion   *boards.ManagedAgentVersion `json:"agentVersion,omitempty"`
	ProfileID      string                      `json:"profileId,omitempty"`
	ContextPending bool                        `json:"contextPending,omitempty"`
	SchemaVersion  int                         `json:"schemaVersion"`
	ID             string                      `json:"id"`
	Title          string                      `json:"title"`
	TitleSetByUser bool                        `json:"titleSetByUser"`
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
	Pinned            bool   `json:"pinned"`
	MessageCount      int    `json:"messageCount"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
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
type ConversationBlock struct {
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
	// Input is the display summary; Detail is the full tool input.
	Name   string `json:"name,omitempty"`
	Input  string `json:"input,omitempty"`
	Detail string `json:"detail,omitempty"`
	// ToolUseID joins the agent's call ID to its result and permission ask.
	ToolUseID string `json:"toolUseId,omitempty"`
	// Empty Result means no reported outcome, including older records without outcome capture.
	Result  string `json:"result,omitempty"`
	IsError bool   `json:"isError,omitempty"`
	// Nil ExitCode means the agent reported no exit status.
	ExitCode *int `json:"exitCode,omitempty"`
	// At orders betweens within replies and anchors tool durations.
	At string `json:"at,omitempty"`
	// DurationMs is agent-reported or measured from call to result; zero means unmeasured.
	DurationMs int64 `json:"durationMs,omitempty"`
	// Subagent holds child activity; Text holds the parent's summary. Nil on other block kinds.
	Subagent *ConversationSubagent `json:"subagent,omitempty"`
}

// conversationRecord is one transcript.jsonl line. Current assistant records use Blocks
// exclusively; legacy records use Text/Tools, whose ordering cannot be reconstructed.
// Text also carries user prompts and notices.
type ConversationRecord struct {
	ProfileID string                        `json:"profileId,omitempty"`
	Execution *turntrace.AgentTurnExecution `json:"execution,omitempty"`
	Queue     []agentapi.AgentQueuedMessage `json:"queue,omitempty"`
	ID        string                        `json:"id"`
	Role      string                        `json:"role"`
	Text      string                        `json:"text"`
	At        string                        `json:"at"`
	// TurnID joins prompt, betweens, reply and logs. Empty for unowned records
	// (such as notices) and legacy records without turn IDs.
	TurnID string `json:"turnId,omitempty"`
	// Between marks input to a running turn. Records remain prompt, betweens, reply;
	// AfterBlocks locates betweens within the single reply record.
	Between bool `json:"between,omitempty"`
	// AfterBlocks counts reply blocks at arrival; nil means the landing position is unknown.
	AfterBlocks    *int                `json:"afterBlocks,omitempty"`
	Blocks         []ConversationBlock `json:"blocks,omitempty"`
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
	Usage *ConversationUsage `json:"usage,omitempty"`
	// Asks preserves permission/question decisions in ask order.
	Asks []ConversationAsk `json:"asks,omitempty"`
	// ComposedPrompt includes attachment/image paths; user prompts only, excluding betweens.
	ComposedPrompt string `json:"composedPrompt,omitempty"`
	// SystemPrompt is the rendering briefing plus managed-agent instructions; user prompts only.
	SystemPrompt string `json:"systemPrompt,omitempty"`
	// Instructions holds managed-agent standing orders separately; empty outside board plays.
	Instructions string `json:"instructions,omitempty"`
	// Published agent name and ID, or the legacy engine reference.
	// Both prompt and reply carry these; chat turns leave them empty.
	PlayedBy     string `json:"playedBy,omitempty"`
	AgentRef     string `json:"agentRef,omitempty"`
	AgentVersion int64  `json:"agentVersion,omitempty"`
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
	Attachments []ConversationAttachment `json:"attachments,omitempty"`
}

type ConversationAttachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MediaType string `json:"mediaType,omitempty"`
}

const AskOutcomeAllow = "allow"

const AskOutcomeDeny = "deny"

const AskOutcomeCancelled = "cancelled"

// conversationAsk snapshots a resolved AgentAsk with its decision.
type ConversationAsk struct {
	// Unique for the life of the turn.
	ID          string `json:"id"`
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
type ConversationUsage struct {
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
func (rec ConversationRecord) BlockText() string {
	if len(rec.Blocks) == 0 {
		return rec.Text
	}
	var sb strings.Builder
	for _, block := range rec.Blocks {
		if block.Kind == agentapi.BlockKindText || block.Kind == agentapi.BlockKindSubagent {
			sb.WriteString(block.Text)
		}
	}
	return sb.String()
}

// blockTail isolates the final text or delegation summary: a CLI may append a failure
// notice after a long reply, and end-reason detection needs that notice alone.
func (rec ConversationRecord) BlockTail() string {
	if len(rec.Blocks) == 0 {
		return rec.Text
	}
	for i := len(rec.Blocks) - 1; i >= 0; i-- {
		if rec.Blocks[i].Kind == agentapi.BlockKindText || rec.Blocks[i].Kind == agentapi.BlockKindSubagent {
			return rec.Blocks[i].Text
		}
	}
	return ""
}

// blockTools includes child calls at their delegation's position; supports legacy Tools.
func (rec ConversationRecord) BlockTools() []conversationTool {
	if len(rec.Blocks) == 0 {
		return rec.Tools
	}
	tools := []conversationTool{}
	var collect func(blocks []ConversationBlock)
	collect = func(blocks []ConversationBlock) {
		for _, block := range blocks {
			if block.Kind == agentapi.BlockKindToolUse {
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
	Mu   sync.Mutex
	meta ConversationMeta
}

// ConversationStore owns the server-side conversation registry.
// Lock order: store.mu → entry.mu; never acquire the index lock under an entry lock.
// Conversation file I/O holds only that entry's lock.
type ConversationStore struct {
	Dir string

	// Caps are injectable for tests; production leaves them fixed.
	MaxConversations   int
	maxTranscriptBytes int64
	compactTarget      int64

	// Injectable for deterministic collision tests; fixed in production.
	newID func() string

	mu    sync.Mutex
	index map[string]*conversationEntry
}

// newConversationStore loads metadata only; transcripts are read on demand.
// Unreadable metadata is logged and skipped, leaving its directory for recovery.
func NewConversationStore(dir string) (*ConversationStore, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, filesystem.ErrEmptyStatePath
	}
	if err := os.MkdirAll(dir, conversationDirPerm); err != nil {
		return nil, fmt.Errorf("failed to create the conversation directory %s: %w", dir, err)
	}
	s := &ConversationStore{
		Dir:                dir,
		MaxConversations:   maxConversations,
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
		if !dirEntry.IsDir() || !ConversationIDRe.MatchString(dirEntry.Name()) {
			continue
		}
		meta, err := readConversationMeta(filepath.Join(dir, dirEntry.Name(), metaFileName))
		if err != nil {
			turntrace.LogConv.Warn("skipping an unreadable conversation", "id", dirEntry.Name(), "error", err)
			continue
		}
		// The directory name is authoritative; trusting a mismatched file ID would break lookup.
		meta.ID = dirEntry.Name()
		s.index[meta.ID] = &conversationEntry{meta: meta}
	}
	turntrace.LogConv.Info("conversations loaded", "dir", dir, "count", len(s.index))
	return s, nil
}

// create mints directory IDs internally and holds the index lock across creation
// and persistence so concurrent requests cannot exceed the cap.
func (s *ConversationStore) Create(meta ConversationMeta) (ConversationMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.index) >= s.MaxConversations {
		return ConversationMeta{}, &httpkit.HTTPError{Status: http.StatusConflict, Msg: fmt.Sprintf(
			"There are already %d conversations; delete or archive some first.", s.MaxConversations)}
	}

	id, err := s.mintLocked()
	if err != nil {
		return ConversationMeta{}, err
	}
	meta.ID = id
	meta.SchemaVersion = conversationSchemaVersion
	meta.Folder = filesystem.NormaliseVirtual(meta.Folder)
	meta.Title = NormaliseTitle(meta.Title)
	meta.MessageCount = 0
	meta.RunningAt = ""
	now := protocol.NowConversationTime()
	meta.CreatedAt, meta.UpdatedAt = now, now

	if err := writeConversationMeta(s.metaPath(meta.ID), meta); err != nil {
		// Remove the incomplete directory so startup will not keep reporting unreadable metadata.
		_ = os.RemoveAll(s.ConvDir(meta.ID))
		return ConversationMeta{}, err
	}
	s.index[meta.ID] = &conversationEntry{meta: meta}
	// Do not log the title: it may contain prompt text.
	turntrace.LogConv.Info("conversation created", "id", meta.ID, "folder", meta.Folder, "owner", meta.Owner)
	return meta, nil
}

// fork copies history before fromMessageID (empty copies everything), leaving that
// prompt available to edit and resend. The source is unchanged; ForkPending prevents
// the copy from writing the source's CLI session.
//
// Release source.mu before create takes store.mu to preserve lock order.
// The handler must reject a running source: a concurrent turn could put the copied
// history behind the session being branched.
func (s *ConversationStore) Fork(sourceID, owner, fromMessageID string, onto ForkTarget) (ConversationMeta, error) {
	source, err := s.Entry(sourceID)
	if err != nil {
		return ConversationMeta{}, err
	}
	source.Mu.Lock()
	sourceMeta := source.meta
	records, err := readTranscript(s.transcriptPath(sourceID))
	source.Mu.Unlock()
	if err != nil {
		return ConversationMeta{}, err
	}
	records, anchor, err := forkPoint(records, fromMessageID)
	if err != nil {
		return ConversationMeta{}, err
	}
	// A session can be carried only on the same engine with branching support and,
	// for a partial fork, a captured anchor. Otherwise copy display history only;
	// the notice must disclose that the model will not remember it.
	changedAgent := agentapi.ResolvedAgent(onto.Agent) != agentapi.ResolvedAgent(sourceMeta.Agent)
	profileID := onto.ProfileID
	if profileID == "" && !changedAgent {
		profileID = sourceMeta.ProfileID
	}
	changedProfile := profileID != sourceMeta.ProfileID
	changedAgent = changedAgent || changedProfile
	sessionID := strings.TrimSpace(sourceMeta.SessionID)
	carriesSession := !changedAgent && onto.Branches && sessionID != "" &&
		(fromMessageID == "" || anchor != "")
	if !carriesSession {
		sessionID, anchor = "", ""
	}

	// Preserve a source-derived fork title across its first prompt; unnamed sources stay unnamed.
	title, named := forkTitle(sourceMeta.Title), true
	if sourceMeta.Title == DefaultConversationTitle {
		title, named = DefaultConversationTitle, false
	}

	// Model, effort and permission modes are engine-specific; use target defaults on engine changes.
	model, effort, mode := sourceMeta.Model, sourceMeta.Effort, sourceMeta.PermissionMode
	if changedAgent || onto.ReplaceVersion {
		model, effort, mode = onto.Model, onto.Effort, onto.PermissionMode
	}
	version := sourceMeta.AgentVersion
	if changedAgent || onto.ReplaceVersion {
		version = boards.ConfiguredAgentVersion(onto.AgentVersion, model, profileID)
	}

	meta, err := s.Create(ConversationMeta{
		AgentVersion:      version,
		Title:             title,
		TitleSetByUser:    named,
		Folder:            sourceMeta.Folder,
		Agent:             agentapi.ResolvedAgent(onto.Agent),
		ProfileID:         profileID,
		ContextPending:    agentapi.ResolvedAgent(onto.Agent) == agentapi.AgentPi && !carriesSession,
		Owner:             owner,
		Model:             model,
		Effort:            effort,
		PermissionMode:    mode,
		Thinking:          sourceMeta.Thinking,
		SessionID:         sessionID,
		SessionLost:       carriesSession && sourceMeta.SessionLost,
		ForkPending:       carriesSession,
		ForkAnchor:        anchor,
		ForkedFrom:        sourceID,
		ForkedFromMessage: fromMessageID,
	})
	if err != nil {
		return ConversationMeta{}, err
	}

	notice := forkNotice(sourceMeta.Title, carriesSession, onto.Label)
	if meta.ContextPending {
		notice = "Forked from “" + sourceMeta.Title + "”. A distinct Pi session will receive the copied transcript as context."
	}
	records = append(records, normaliseRecord(ConversationRecord{
		Role: RoleNotice, Text: notice,
		ForkFrom: sourceID, ForkFromMessage: fromMessageID,
	}))
	forked, err := s.seedTranscript(meta.ID, records)
	if err != nil {
		// Do not leave a fork holding a session whose copied history failed to persist.
		if delErr := s.Delete(meta.ID); delErr != nil {
			turntrace.LogConv.Warn("cannot drop a fork that was not written", "id", meta.ID, "error", delErr)
		}
		return ConversationMeta{}, err
	}
	turntrace.LogConv.Info("conversation forked", "id", forked.ID, "from", sourceID,
		"folder", forked.Folder, "agent", forked.Agent, "owner", owner,
		"messages", forked.MessageCount, "at", fromMessageID, "carries_session", carriesSession)
	return forked, nil
}

// forkPoint keeps records before fromMessageID and returns the last assistant anchor.
// Empty ID means no session cut, not the last recorded anchor. Unknown IDs return 404:
// silently copying everything could give the model more history than requested.
func forkPoint(records []ConversationRecord, fromMessageID string) ([]ConversationRecord, string, error) {
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
		return nil, "", &httpkit.HTTPError{Status: http.StatusNotFound,
			Msg: "That message is not in this conversation's transcript."}
	}
	kept := records[:at]
	for i := len(kept) - 1; i >= 0; i-- {
		if kept[i].Role == RoleAssistant && kept[i].SessionAnchor != "" {
			return kept, kept[i].SessionAnchor, nil
		}
	}
	return kept, "", nil
}

// Unknown IDs return os.ErrNotExist (404); malformed IDs return errBadConversationID (400).
func (s *ConversationStore) Get(id string) (ConversationMeta, error) {
	entry, err := s.Entry(id)
	if err != nil {
		return ConversationMeta{}, err
	}
	entry.Mu.Lock()
	defer entry.Mu.Unlock()
	return entry.meta, nil
}

func (s *ConversationStore) List(includeArchived bool) []ConversationMeta {
	s.mu.Lock()
	entries := make([]*conversationEntry, 0, len(s.index))
	for _, entry := range s.index {
		entries = append(entries, entry)
	}
	s.mu.Unlock()

	metas := make([]ConversationMeta, 0, len(entries))
	for _, entry := range entries {
		entry.Mu.Lock()
		meta := entry.meta
		entry.Mu.Unlock()
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

func (s *ConversationStore) Update(id string, mutate func(*ConversationMeta)) (ConversationMeta, error) {
	entry, err := s.Entry(id)
	if err != nil {
		return ConversationMeta{}, err
	}
	entry.Mu.Lock()
	defer entry.Mu.Unlock()
	return s.mutateLocked(entry, mutate)
}

// delete removes only our history; the CLI's own session file is retained.
func (s *ConversationStore) Delete(id string) error {
	if !ConversationIDRe.MatchString(id) {
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
	entry.Mu.Lock()
	defer entry.Mu.Unlock()
	if err := os.RemoveAll(s.ConvDir(id)); err != nil {
		return fmt.Errorf("failed to delete conversation %s: %w", id, err)
	}
	turntrace.LogConv.Info("conversation deleted", "id", id)
	return nil
}

func (s *ConversationStore) Messages(id string) ([]ConversationRecord, error) {
	entry, err := s.Entry(id)
	if err != nil {
		return nil, err
	}
	entry.Mu.Lock()
	defer entry.Mu.Unlock()
	return readTranscript(s.transcriptPath(id))
}

// appendAndUpdate appends and persists metadata under one entry lock at each turn boundary.
func (s *ConversationStore) AppendAndUpdate(id string, rec ConversationRecord,
	mutate func(*ConversationMeta)) (ConversationMeta, error) {
	entry, err := s.Entry(id)
	if err != nil {
		return ConversationMeta{}, err
	}
	entry.Mu.Lock()
	defer entry.Mu.Unlock()

	rec = normaliseRecord(rec)
	size, err := appendRecord(s.transcriptPath(id), rec)
	if err != nil {
		return ConversationMeta{}, err
	}

	// Compaction replaces dropped records with one notice; count what readers will receive.
	delta := 1
	if size > s.maxTranscriptBytes {
		dropped, err := s.compactLocked(id)
		if err != nil {
			// The record is already written; a compaction failure must not fail the turn boundary.
			turntrace.LogConv.Warn("cannot compact a transcript", "id", id, "error", err)
		} else if dropped > 0 {
			delta += 1 - dropped
		}
	}

	return s.mutateLocked(entry, func(meta *ConversationMeta) {
		meta.MessageCount += delta
		if meta.MessageCount < 0 {
			meta.MessageCount = 0
		}
		// Only the first prompt replaces the unnamed sentinel; betweens never name a conversation.
		if rec.Role == RoleUser && !rec.Between && !meta.TitleSetByUser && meta.Title == DefaultConversationTitle {
			meta.Title = conversationTitle(rec.Text)
		}
		if mutate != nil {
			mutate(meta)
		}
	})
}

// sweepInterrupted runs before the startup listener opens. The prompt was persisted
// before spawn, so every abandoned turn has a user record to settle.
func (s *ConversationStore) SweepInterrupted() int {
	s.mu.Lock()
	entries := make([]*conversationEntry, 0, len(s.index))
	for _, entry := range s.index {
		entries = append(entries, entry)
	}
	s.mu.Unlock()

	settled := 0
	for _, entry := range entries {
		entry.Mu.Lock()
		id, running, turn := entry.meta.ID, entry.meta.RunningAt != "", entry.meta.RunningTurn
		entry.Mu.Unlock()
		if !running {
			continue
		}
		// The lost reply cannot be reconstructed; Interrupted and EndReason explain the gap.
		_, err := s.AppendAndUpdate(id,
			ConversationRecord{Role: RoleAssistant, TurnID: turn, Interrupted: true, Queue: s.interruptedQueue(id, turn),
				EndReason: "The service restarted while this turn was running."},
			func(meta *ConversationMeta) { meta.RunningAt, meta.RunningTurn = "", "" })
		if err != nil {
			turntrace.LogConv.Warn("cannot settle an interrupted conversation", "id", id, "error", err)
			continue
		}
		settled++
	}
	return settled
}

// mintLocked uses Mkdir to detect collisions, including directories skipped at startup
// for unreadable metadata. Reusing one would overwrite its metadata and mix histories.
func (s *ConversationStore) mintLocked() (string, error) {
	for attempt := 0; attempt < conversationIDAttempts; attempt++ {
		id := s.newID()
		if _, taken := s.index[id]; taken {
			continue
		}
		err := os.Mkdir(s.ConvDir(id), conversationDirPerm)
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
func (s *ConversationStore) seedTranscript(id string, records []ConversationRecord) (ConversationMeta, error) {
	entry, err := s.Entry(id)
	if err != nil {
		return ConversationMeta{}, err
	}
	entry.Mu.Lock()
	defer entry.Mu.Unlock()
	if err := writeTranscript(s.transcriptPath(id), records); err != nil {
		return ConversationMeta{}, err
	}
	return s.mutateLocked(entry, func(meta *ConversationMeta) { meta.MessageCount = len(records) })
}

func (s *ConversationStore) ConvDir(id string) string { return filepath.Join(s.Dir, id) }

func (s *ConversationStore) metaPath(id string) string {
	return filepath.Join(s.ConvDir(id), metaFileName)
}

func (s *ConversationStore) transcriptPath(id string) string {
	return filepath.Join(s.ConvDir(id), transcriptFileName)
}

// entry validates IDs before any filepath.Join. Malformed input is not echoed in
// client-visible errors; unknown IDs are echoed only after validation.
func (s *ConversationStore) Entry(id string) (*conversationEntry, error) {
	if !ConversationIDRe.MatchString(id) {
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
	mutate func(*ConversationMeta)) (ConversationMeta, error) {
	meta := entry.meta
	meta.UpdatedAt = protocol.NowConversationTime()
	if mutate != nil {
		mutate(&meta)
	}
	meta.ID, meta.Folder, meta.CreatedAt = entry.meta.ID, entry.meta.Folder, entry.meta.CreatedAt
	meta.SchemaVersion = conversationSchemaVersion
	meta.Title = NormaliseTitle(meta.Title)

	if err := writeConversationMeta(s.metaPath(meta.ID), meta); err != nil {
		return ConversationMeta{}, err
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

	notice := normaliseRecord(ConversationRecord{Role: RoleNotice, Text: fmt.Sprintf(
		"%d earlier messages were trimmed from this transcript to keep it a manageable size. "+
			"The Claude session still has them.", dropped)})

	if err := writeTranscript(path, append([]ConversationRecord{notice}, records[dropped:]...)); err != nil {
		return 0, err
	}
	turntrace.LogConv.Info("transcript compacted", "id", id, "dropped", dropped, "kept", kept)
	return dropped, nil
}

func readConversationMeta(path string) (ConversationMeta, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ConversationMeta{}, err
	}
	var meta ConversationMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return ConversationMeta{}, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	return meta, nil
}

// writeConversationMeta replaces metadata atomically; a torn write could lose the conversation.
func writeConversationMeta(path string, meta ConversationMeta) error {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(path, append(data, '\n'), conversationFilePerm)
}

// appendRecord writes one JSON line, escaping embedded newlines. Open per call to avoid
// holding a descriptor per conversation. No fsync: a torn final line is skipped by the
// reader, losing at most that record; the CLI session holds continuation state.
func appendRecord(path string, rec ConversationRecord) (int64, error) {
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
func writeTranscript(path string, records []ConversationRecord) error {
	var buf bytes.Buffer
	for _, rec := range records {
		line, err := json.Marshal(rec)
		if err != nil {
			return err
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	return filesystem.WriteFileAtomic(path, buf.Bytes(), conversationFilePerm)
}

// readTranscript tolerates malformed lines because unsynced appends can leave a torn final line.
func readTranscript(path string) ([]ConversationRecord, error) {
	f, err := os.Open(path)
	if err != nil {
		// No transcript exists until the first prompt.
		if os.IsNotExist(err) {
			return []ConversationRecord{}, nil
		}
		return nil, err
	}
	defer f.Close()

	records := []ConversationRecord{}
	reader := bufio.NewReader(f)
	skipped := 0
	for {
		line, readErr := reader.ReadString('\n')
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			var rec ConversationRecord
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
		turntrace.LogConv.Warn("skipped transcript lines that do not parse", "file", path, "skipped", skipped)
	}
	return records, nil
}

// normaliseRecord enforces record caps on rune boundaries to preserve valid UTF-8.
func normaliseRecord(rec ConversationRecord) ConversationRecord {
	if rec.ID == "" {
		rec.ID = "msg-" + idgen.NowMillisStr() + "-" + idgen.RandID()[:4]
	}
	if rec.At == "" {
		rec.At = protocol.NowConversationTime()
	}
	if runes := []rune(rec.Text); len(runes) > maxRecordChars {
		rec.Text = string(runes[:maxRecordChars]) + protocol.TruncationMarker
		rec.Truncated = true
	}
	if capped, cut := protocol.CapRecordText(rec.ComposedPrompt, maxRecordChars); cut {
		rec.ComposedPrompt, rec.Truncated = capped, true
	}
	if capped, cut := protocol.CapRecordText(rec.SystemPrompt, maxRecordBriefingChars); cut {
		rec.SystemPrompt, rec.Truncated = capped, true
	}
	if capped, cut := protocol.CapRecordText(rec.Instructions, maxRecordBriefingChars); cut {
		rec.Instructions, rec.Truncated = capped, true
	}
	// Retain the newest tool calls and asks; Truncated discloses the missing history.
	if len(rec.Tools) > MaxRecordTools {
		rec.Tools = rec.Tools[len(rec.Tools)-MaxRecordTools:]
		rec.Truncated = true
	}
	if len(rec.Asks) > maxRecordAsks {
		rec.Asks = rec.Asks[len(rec.Asks)-maxRecordAsks:]
		rec.Truncated = true
	}
	return CapBlocks(rec)
}

// capBlocks retains the end of a turn under shared text/tool budgets.
// Child blocks consume the same budgets at their delegation's position.
func CapBlocks(rec ConversationRecord) ConversationRecord {
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

func capNestedResults(blocks []ConversationBlock, truncated *bool) {
	for i := range blocks {
		if capped, cut := protocol.CapRecordText(blocks[i].Result, protocol.MaxBlockResultChars); cut {
			blocks[i].Result, *truncated = capped, true
		}
		if sub := blocks[i].Subagent; sub != nil {
			capNestedResults(sub.Blocks, truncated)
		}
	}
}

// capBlockList spends shared budgets newest-first. Cap child lists in place and mark
// both the delegation and record truncated.
func capBlockList(blocks []ConversationBlock, chars, tools *int) ([]ConversationBlock, bool) {
	start, cut := 0, false
	for i := len(blocks) - 1; i >= 0; i-- {
		block := &blocks[i]
		if block.Kind == agentapi.BlockKindToolUse {
			if *tools == MaxRecordTools {
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
				block.Text = protocol.TruncationMarker + string(runes[len(runes)-room:])
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
		if line := protocol.CollapseWhitespace(candidate); line != "" {
			return truncateTitle(line)
		}
	}
	return DefaultConversationTitle
}

const forkTitleSuffix = " (fork)"

// Keep the fork suffix when truncating so the copy remains distinguishable from its source.
func forkTitle(sourceTitle string) string {
	base := protocol.CollapseWhitespace(sourceTitle)
	if base == "" {
		base = DefaultConversationTitle
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
		protocol.CollapseWhitespace(sourceTitle))
	if !carriesSession {
		notice += fmt.Sprintf(" %s was not given that history: it is here to be read, not remembered.",
			protocol.OrDefault(agentLabel, "The agent"))
	}
	return notice
}

// forkTarget carries the caller-resolved agent capabilities and engine-specific defaults.
type ForkTarget struct {
	AgentVersion   *boards.ManagedAgentVersion
	ReplaceVersion bool
	ProfileID      string
	// Empty selects the default agent.
	Agent string
	Label string
	// Without branching support, even same-agent forks retain only display history.
	Branches bool

	// Defaults apply only when the engine changes; same-engine forks retain source settings.
	Model, Effort, PermissionMode string
}

func NormaliseTitle(title string) string {
	if collapsed := protocol.CollapseWhitespace(title); collapsed != "" {
		return truncateTitle(collapsed)
	}
	return DefaultConversationTitle
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

// A running queue survives worker restart independently of the unfinished reply record.
// Startup cancels pending inputs: they were not delivered and must remain available to the user.
type conversationQueue struct {
	TurnID   string                        `json:"turnId"`
	Messages []agentapi.AgentQueuedMessage `json:"messages"`
}

func (s *ConversationStore) SaveQueue(id, turn string, messages []agentapi.AgentQueuedMessage) error {
	if _, err := s.Entry(id); err != nil {
		return err
	}
	body, err := json.Marshal(conversationQueue{TurnID: turn, Messages: messages})
	if err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(filepath.Join(s.ConvDir(id), "queue.json"), body, 0o600)
}

func (s *ConversationStore) interruptedQueue(id, turn string) []agentapi.AgentQueuedMessage {
	body, err := os.ReadFile(filepath.Join(s.ConvDir(id), "queue.json"))
	if err != nil {
		return nil
	}
	var queue conversationQueue
	if json.Unmarshal(body, &queue) != nil || queue.TurnID != turn {
		return nil
	}
	for i := range queue.Messages {
		if queue.Messages[i].State == "pending" {
			queue.Messages[i].State = "cancelled"
		}
	}
	return queue.Messages
}
