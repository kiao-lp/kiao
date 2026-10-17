package hybridflowrunner

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"kiao/worker/internal/core"
	"math"
	"regexp"
	"strings"
	"time"
)

// Board reads tolerate malformed optional fields and supply missing node ids.
// Writes omit empty fields and preserve field order to match the editor.

// Absent status means ready. waiting-refresh retains a play while its usage limit
// is exhausted. blocked is user-owned: runs neither set nor clear it.
const (
	flowNodeStatusDraft          = "draft"
	flowNodeStatusReady          = "ready"
	flowNodeStatusBlocked        = "blocked"
	flowNodeStatusRunning        = "running"
	flowNodeStatusWaitingRefresh = "waiting-refresh"
	flowNodeStatusInterrupted    = "interrupted"
	flowNodeStatusDone           = "done"
	flowNodeStatusError          = "error"
)

// Shutdown, Scheduler and Gateway are run-owned steps without turns or conversations.
// Absent type is inferred from legacy settings; see flowNodeTypeOf.
const (
	flowNodeTypeAI        = "ai"
	flowNodeTypeHuman     = "human"
	flowNodeTypeShutdown  = "shutdown"
	flowNodeTypeScheduler = "scheduler"
	flowNodeTypeGateway   = "gateway"
)

// Transition mode controls whether the successor receives a fork of the conversation.
// Absent mode means end, except on legacy chains; see readTransition.
const (
	transitionContinue = "continue"
	transitionEnd      = "end"
	// Read-only legacy spelling for continue with Compact enabled.
	legacyTransitionCompact = "compact"
)

// AI nodes require Agent, Effort, Permission and Folder; none defaults here.
type flowNodeSettings struct {
	// Agent is a managed agent id resolved at each play (chain_agents.go).
	// Legacy cards may name an engine here and supply Model.
	Agent string `json:"agent,omitempty"`
	// Model is the legacy engine/model setting: read, never written.
	Model      string `json:"model,omitempty"`
	Effort     string `json:"effort,omitempty"`
	Permission string `json:"permission,omitempty"`
	Folder     string `json:"folder,omitempty"`
	// Runner pins a runner id; empty uses the runner where Play is pressed.
	// It does not affect playability.
	Runner string `json:"runner,omitempty"`
}

func (s flowNodeSettings) playable() bool {
	return s.Agent != "" && s.Effort != "" && s.Permission != "" && s.Folder != ""
}

func (s flowNodeSettings) empty() bool {
	return s.Agent == "" && s.Model == "" && s.Effort == "" && s.Permission == "" && s.Folder == "" &&
		s.Runner == ""
}

// folder returns the store-relative working directory; explicit / means store root.
func (s flowNodeSettings) folder() string {
	folder := strings.TrimSpace(s.Folder)
	if folder == "/" {
		return ""
	}
	return strings.Trim(folder, "/")
}

// flowNodeSuccess selects successors and conversation handling independently.
// Conversation handling also applies to cards without successors.
type flowNodeSuccess struct {
	FlowNode string
	// FlowNodes are Gateway-only parallel successors, in card order.
	FlowNodes []string
	Mode      string
	// Compact sends /compact as a separate turn after success, before any fork.
	Compact bool
}

func (s flowNodeSuccess) carriesChat() bool {
	return s.Mode == transitionContinue
}

// An empty mode means end for values constructed without unmarshalling.
func (s flowNodeSuccess) says() bool {
	return s.FlowNode != "" || len(s.FlowNodes) > 0 ||
		(s.Mode != "" && s.Mode != transitionEnd) || s.Compact
}

// A bare string names a successor and continues the chat. Legacy chat is read
// only beside a named successor; compact applies even without a successor.
func (s *flowNodeSuccess) UnmarshalJSON(data []byte) error {
	var named string
	if err := json.Unmarshal(data, &named); err == nil {
		*s = flowNodeSuccess{FlowNode: strings.TrimSpace(named), Mode: transitionContinue}
		return nil
	}
	var raw struct {
		FlowNode  string   `json:"flowNode"`
		FlowNodes []string `json:"flowNodes"`
		Mode      string   `json:"mode"`
		Chat      string   `json:"chat"`
		Compact   bool     `json:"compact"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		*s = flowNodeSuccess{Mode: transitionEnd}
		return nil
	}
	flowNode := strings.TrimSpace(raw.FlowNode)
	mode, compact := readTransition(raw.Mode, raw.Chat, flowNode != "")
	*s = flowNodeSuccess{FlowNode: flowNode, FlowNodes: readFlowNodes(raw.FlowNodes), Mode: mode, Compact: compact || raw.Compact}
	return nil
}

func readFlowNodes(raw []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, entry := range raw {
		if id := strings.TrimSpace(entry); id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// readTransition prefers mode, then legacy chat, then the legacy chain default.
func readTransition(mode, chat string, chained bool) (string, bool) {
	switch said := strings.TrimSpace(mode); said {
	case transitionContinue, transitionEnd:
		return said, false
	case legacyTransitionCompact:
		return transitionContinue, true
	case "":
	default:
		// Unknown explicit modes (including legacy shutdown) end the chat;
		// do not fall through to the legacy continuation default.
		return transitionEnd, false
	}
	if !chained {
		return transitionEnd, false
	}
	switch strings.TrimSpace(chat) {
	case transitionContinue, transitionEnd:
		return strings.TrimSpace(chat), false
	case legacyTransitionCompact:
		return transitionContinue, true
	}
	// Legacy chains without a mode continued the chat.
	return transitionContinue, false
}

// Always write mode: omitting end on a chain would read back as legacy continue.
func (s flowNodeSuccess) MarshalJSON() ([]byte, error) {
	fields := orderedFields{}
	if s.FlowNode != "" {
		fields = append(fields, orderedField{"flowNode", jsonOf(s.FlowNode)})
	}
	if len(s.FlowNodes) > 0 {
		fields = append(fields, orderedField{"flowNodes", jsonOf(s.FlowNodes)})
	}
	mode := s.Mode
	if mode == "" {
		mode = transitionEnd
	}
	fields = append(fields, orderedField{"mode", jsonOf(mode)})
	if s.Compact {
		fields = append(fields, orderedField{"compact", jsonOf(true)})
	}
	return fields.MarshalJSON()
}

// flowNodeSpot uses pixels right and down from the canvas top left.
type flowNodeSpot struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type successCriterion struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

var taskComplexities = map[int]bool{1: true, 2: true, 3: true, 5: true, 8: true, 13: true, 21: true}

func readComplexity(raw json.RawMessage) *int {
	var said int
	if len(raw) == 0 || json.Unmarshal(raw, &said) != nil || !taskComplexities[said] {
		return nil
	}
	return &said
}

func readCriteria(raw json.RawMessage) []successCriterion {
	if len(raw) == 0 {
		return nil
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	var out []successCriterion
	for _, entry := range entries {
		var criterion struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(entry, &criterion); err != nil {
			continue
		}
		if text := strings.TrimSpace(criterion.Text); text != "" {
			out = append(out, successCriterion{ID: strings.TrimSpace(criterion.ID), Text: text})
		}
	}
	return out
}

// flowNode is keyed by stable ID so edits during a turn still receive that turn's status.
type flowNode struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Empty Type means human and is omitted when encoded.
	Type string
	// Tags are labels, not tag ids; preserved for the board, unused by the runner.
	Tags []string
	// Body is the prompt description; play preserves it and stores responses in Chat.
	Body string `json:"body,omitempty"`
	// Criteria accompany the prompt when present.
	Criteria []successCriterion
	// Complexity is optional Fibonacci estimation, never sent in the prompt.
	Complexity *int
	Settings   flowNodeSettings
	// At is a Scheduler wall clock (YYYY-MM-DDTHH:mm), parsed in this process's location.
	At       string
	Duration string
	// Spot is preserved for the board; nil means unplaced.
	Spot *flowNodeSpot
	// Status is empty for ready.
	Status string
	// Archived hides the card everywhere without deleting it. The runner never plays it
	// and never follows a link to or from it.
	Archived bool `json:"archived,omitempty"`
	// Chat is written as soon as the conversation exists, so running work can be opened.
	Chat string
	// Run identifies the owning run; empty means free. It distinguishes live ownership
	// from a stale card left by a departed run.
	Run       string
	OnSuccess flowNodeSuccess
}

// UnmarshalJSON normalizes unknown statuses to ready and supplies missing ids.
func (t *flowNode) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID         string           `json:"id"`
		Title      string           `json:"title"`
		Type       string           `json:"type"`
		Tags       []string         `json:"tags"`
		Body       string           `json:"body"`
		Criteria   json.RawMessage  `json:"criteria"`
		Complexity json.RawMessage  `json:"complexity"`
		Settings   flowNodeSettings `json:"settings"`
		At         string           `json:"at"`
		Duration   string           `json:"duration"`
		Spot       json.RawMessage  `json:"spot"`
		Status     string           `json:"status"`
		Archived   bool             `json:"archived"`
		Chat       string           `json:"chat"`
		Run        string           `json:"run"`
		OnSuccess  flowNodeSuccess  `json:"onSuccess"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	flowNodeType := flowNodeTypeOf(raw.Type, raw.Settings)
	success := raw.OnSuccess
	if success.Mode == "" {
		// Absent onSuccess bypasses its UnmarshalJSON, so supply its default here.
		success.Mode = transitionEnd
	}
	// Match editor capabilities: only AI cards have chats; shutdown has no successor.
	if flowNodeType != flowNodeTypeAI {
		success.Mode, success.Compact = transitionEnd, false
	}
	if flowNodeType == flowNodeTypeShutdown {
		success.FlowNode = ""
	}
	if flowNodeType == flowNodeTypeGateway {
		success.FlowNode = ""
	} else {
		success.FlowNodes = nil
	}
	status := strings.TrimSpace(raw.Status)
	switch status {
	case flowNodeStatusDraft, flowNodeStatusBlocked, flowNodeStatusRunning,
		flowNodeStatusWaitingRefresh, flowNodeStatusInterrupted, flowNodeStatusDone,
		flowNodeStatusError:
	default:
		status = ""
	}
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = newFlowNodeID()
	}
	var criteria []successCriterion
	var complexity *int
	if flowNodeType != flowNodeTypeShutdown && flowNodeType != flowNodeTypeScheduler {
		criteria, complexity = readCriteria(raw.Criteria), readComplexity(raw.Complexity)
	}
	*t = flowNode{
		ID:         id,
		Title:      raw.Title,
		Type:       flowNodeType,
		Tags:       readTags(raw.Tags),
		Body:       raw.Body,
		Criteria:   criteria,
		Complexity: complexity,
		Settings:   raw.Settings,
		At:         readSchedule(raw.At),
		Duration:   readDuration(raw.Duration),
		Spot:       readSpot(raw.Spot),
		Status:     status,
		Archived:   raw.Archived,
		Chat:       strings.TrimSpace(raw.Chat),
		Run:        strings.TrimSpace(raw.Run),
		OnSuccess:  success,
	}
	return nil
}

// Unknown or absent type falls back to legacy agent/model inference.
func flowNodeTypeOf(said string, settings flowNodeSettings) string {
	switch strings.ToLower(strings.TrimSpace(said)) {
	case flowNodeTypeAI:
		return flowNodeTypeAI
	case flowNodeTypeHuman:
		return flowNodeTypeHuman
	case flowNodeTypeShutdown:
		return flowNodeTypeShutdown
	case flowNodeTypeScheduler:
		return flowNodeTypeScheduler
	case flowNodeTypeGateway:
		return flowNodeTypeGateway
	}
	if settings.Agent != "" || settings.Model != "" {
		return flowNodeTypeAI
	}
	return flowNodeTypeHuman
}

func readTags(raw []string) []string {
	var tags []string
	for _, entry := range raw {
		label := strings.Join(strings.Fields(entry), " ")
		if label == "" {
			continue
		}
		seen := false
		for _, held := range tags {
			if strings.EqualFold(held, label) {
				seen = true
				break
			}
		}
		if !seen {
			tags = append(tags, label)
		}
	}
	return tags
}

// Read spot separately so malformed coordinates leave one card unplaced
// rather than rejecting the entire board.
func readSpot(raw json.RawMessage) *flowNodeSpot {
	if len(raw) == 0 {
		return nil
	}
	var spot flowNodeSpot
	if err := json.Unmarshal(raw, &spot); err != nil {
		return nil
	}
	if math.IsNaN(spot.X) || math.IsNaN(spot.Y) || math.IsInf(spot.X, 0) || math.IsInf(spot.Y, 0) {
		return nil
	}
	return &flowNodeSpot{X: math.Round(spot.X), Y: math.Round(spot.Y)}
}

func (t flowNode) MarshalJSON() ([]byte, error) {
	fields := orderedFields{{"id", jsonOf(t.ID)}}
	fields = append(fields, orderedField{"title", jsonOf(t.Title)})
	if t.Type != "" && t.Type != flowNodeTypeHuman {
		fields = append(fields, orderedField{"type", jsonOf(t.Type)})
	}
	if len(t.Tags) > 0 {
		fields = append(fields, orderedField{"tags", jsonOf(t.Tags)})
	}
	if t.Body != "" {
		fields = append(fields, orderedField{"body", jsonOf(t.Body)})
	}
	if len(t.Criteria) > 0 {
		fields = append(fields, orderedField{"criteria", jsonOf(t.Criteria)})
	}
	if t.Complexity != nil {
		fields = append(fields, orderedField{"complexity", jsonOf(t.Complexity)})
	}
	if !t.Settings.empty() {
		fields = append(fields, orderedField{"settings", jsonOf(t.Settings)})
	}
	if t.At != "" {
		fields = append(fields, orderedField{"at", jsonOf(t.At)})
	}
	if t.Duration != "" {
		fields = append(fields, orderedField{"duration", jsonOf(t.Duration)})
	}
	if t.Spot != nil {
		fields = append(fields, orderedField{"spot", jsonOf(t.Spot)})
	}
	if t.Status != "" {
		fields = append(fields, orderedField{"status", jsonOf(t.Status)})
	}
	if t.Archived {
		fields = append(fields, orderedField{"archived", jsonOf(true)})
	}
	if t.Chat != "" {
		fields = append(fields, orderedField{"chat", jsonOf(t.Chat)})
	}
	if t.Run != "" {
		fields = append(fields, orderedField{"run", jsonOf(t.Run)})
	}
	if t.OnSuccess.says() {
		fields = append(fields, orderedField{"onSuccess", jsonOf(t.OnSuccess)})
	}
	return fields.MarshalJSON()
}

type boardContent struct {
	FlowNodes []flowNode `json:"flowNodes"`
}

func (b *boardContent) flowNode(id string) *flowNode {
	if id == "" {
		return nil
	}
	for i := range b.FlowNodes {
		if b.FlowNodes[i].ID == id {
			return &b.FlowNodes[i]
		}
	}
	return nil
}

// predecessorsOf includes both single successors and Gateway branches, in board order.
// Archived cards are never predecessors and never have predecessors shown: their links are hidden.
func (b *boardContent) predecessorsOf(id string) []flowNode {
	if target := b.flowNode(id); target == nil || target.Archived {
		return nil
	}
	var out []flowNode
	for _, flowNode := range b.FlowNodes {
		if flowNode.ID == id || flowNode.Archived {
			continue
		}
		if flowNode.OnSuccess.FlowNode == id {
			out = append(out, flowNode)
			continue
		}
		for _, next := range flowNode.OnSuccess.FlowNodes {
			if next == id {
				out = append(out, flowNode)
				break
			}
		}
	}
	return out
}

// successorsOf preserves successor order and omits missing cards, ending those chains.
 // Archived successors end the chain too: their link is hidden and never followed.
func (b *boardContent) successorsOf(card flowNode) []flowNode {
	if card.Archived {
		return nil
	}
	var out []flowNode
	for _, id := range successorIDs(card) {
		if next := b.flowNode(id); next != nil && !next.Archived {
			out = append(out, *next)
		}
	}
	return out
}

func successorIDs(card flowNode) []string {
	if card.isGateway() {
		return card.OnSuccess.FlowNodes
	}
	if card.OnSuccess.FlowNode != "" {
		return []string{card.OnSuccess.FlowNode}
	}
	return nil
}

func (b *boardContent) setStatus(id, status string) bool {
	flowNode := b.flowNode(id)
	if flowNode == nil {
		return false
	}
	if status == flowNodeStatusReady {
		status = ""
	}
	if flowNode.Status == status {
		return false
	}
	flowNode.Status = status
	return true
}

func (b *boardContent) setChat(id, chat string) bool {
	flowNode := b.flowNode(id)
	if flowNode == nil || flowNode.Chat == chat {
		return false
	}
	flowNode.Chat = chat
	return true
}

// start is called before sending the prompt, once per play rather than per retry.
// Returning from waiting-refresh uses reopen within the same play.
func (b *boardContent) start(id string) bool {
	return b.setStatus(id, flowNodeStatusRunning)
}

func (b *boardContent) hold(id string) bool {
	return b.setStatus(id, flowNodeStatusWaitingRefresh)
}

func (b *boardContent) reopen(id string) bool {
	return b.setStatus(id, flowNodeStatusRunning)
}

// complete requires an answered turn; errors use fail and user stops use interrupt.
func (b *boardContent) complete(id string) bool {
	return b.setStatus(id, flowNodeStatusDone)
}

func (b *boardContent) interrupt(id string) bool {
	return b.setStatus(id, flowNodeStatusInterrupted)
}

func (b *boardContent) fail(id string) bool {
	return b.setStatus(id, flowNodeStatusError)
}

// flowNodePrompt sends the description, falling back to the title, plus criteria.
// Renaming a card with a description must not change its prompt.
func flowNodePrompt(flowNode flowNode) string {
	base := strings.TrimSpace(flowNode.Body)
	if base == "" {
		base = strings.TrimSpace(flowNode.Title)
	}
	var lines []string
	for _, criterion := range flowNode.Criteria {
		if text := strings.TrimSpace(criterion.Text); text != "" {
			lines = append(lines, text)
		}
	}
	if len(lines) == 0 {
		return base
	}
	criteria := "Success criteria:\n- " + strings.Join(lines, "\n- ")
	if base == "" {
		return criteria
	}
	return base + "\n\n" + criteria
}

func (t flowNode) hasPrompt() bool { return flowNodePrompt(t) != "" }

func (t flowNode) isAI() bool { return t.Type == flowNodeTypeAI }

// A Gateway joins all incoming branches before starting all outgoing branches.
func (t flowNode) isGateway() bool { return t.Type == flowNodeTypeGateway }

// runsItself identifies run-owned steps without a prompt, conversation or folder.
// AI and Human cards are the tasks (work done by an agent or person).
func (t flowNode) runsItself() bool {
	return t.Type == flowNodeTypeShutdown || t.Type == flowNodeTypeScheduler || t.Type == flowNodeTypeGateway
}

// runnable checks type requirements only; status separately determines when to play.
// Archived cards never run: they are hidden everywhere with their links.
func (t flowNode) runnable() bool {
	if t.Archived {
		return false
	}
	switch t.Type {
	case flowNodeTypeAI:
		return t.Settings.playable()
	case flowNodeTypeScheduler:
		return readSchedule(t.At) != "" || readDuration(t.Duration) != ""
	case flowNodeTypeShutdown:
		return true
	case flowNodeTypeGateway:
		return true
	}
	return false
}

// Only AI cards require a nonempty prompt; other types do not consume text.
func (t flowNode) hasWork() bool { return !t.isAI() || t.hasPrompt() }

// scheduledAt uses this machine's wall clock, even if the board is viewed elsewhere.
func (t flowNode) scheduledAt() (time.Time, bool) {
	if duration := readDuration(t.Duration); duration != "" {
		wait, _ := time.ParseDuration(duration)
		return time.Now().Add(wait), true
	}
	at := readSchedule(t.At)
	if at == "" {
		return time.Time{}, false
	}
	when, err := time.ParseInLocation(scheduleLayout, at, time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return when, true
}

// datetime-local format: minutes, without zone or seconds.
const scheduleLayout = "2006-01-02T15:04"

// readSchedule accepts local datetimes, dropping optional seconds; invalid means unplayable.
func readSchedule(raw string) string {
	said := strings.TrimSpace(raw)
	if _, err := time.ParseInLocation(scheduleLayout, said, time.Local); err == nil {
		return said
	}
	if when, err := time.ParseInLocation("2006-01-02T15:04:05", said, time.Local); err == nil {
		return when.Format(scheduleLayout)
	}
	return ""
}

// newUUID returns a v4 UUID, or false on random-source failure for caller-specific fallback.
func newUUID() (string, bool) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", false
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexed := hex.EncodeToString(b[:])
	return hexed[0:8] + "-" + hexed[8:12] + "-" + hexed[12:16] + "-" + hexed[16:20] + "-" + hexed[20:], true
}

// Use v4 UUIDs like the editor's crypto.randomUUID for boards copied across instances.
func newFlowNodeID() string {
	if id, ok := newUUID(); ok {
		return id
	}
	// IDs must remain unique: id-keyed operations collapse duplicate nodes.
	return "flow-node-" + core.NowMillisStr() + "-" + core.RandID()
}

// A stable usage report id makes spool replay idempotent. Empty lets the store
// mint an id that a replay cannot reuse.
func newUsageReportID() string {
	id, _ := newUUID()
	return id
}

type orderedField struct {
	key   string
	value json.RawMessage
}

// orderedFields preserves human-readable key order; a map would sort alphabetically.
type orderedFields []orderedField

func (f orderedFields) MarshalJSON() ([]byte, error) {
	var out bytes.Buffer
	out.WriteByte('{')
	for i, field := range f {
		if i > 0 {
			out.WriteByte(',')
		}
		key, err := json.Marshal(field.key)
		if err != nil {
			return nil, err
		}
		out.Write(key)
		out.WriteByte(':')
		out.Write(field.value)
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}

func jsonOf(v any) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return data
}

// Keep the accepted duration units aligned with the board and store.
var scheduleDurationShape = regexp.MustCompile(`^(?:[0-9]+(?:\.[0-9]+)?(?:ms|s|m|h))+$`)

func readDuration(raw string) string {
	said := strings.TrimSpace(raw)
	if !scheduleDurationShape.MatchString(said) {
		return ""
	}
	wait, err := time.ParseDuration(said)
	if err != nil || wait <= 0 {
		return ""
	}
	return said
}
