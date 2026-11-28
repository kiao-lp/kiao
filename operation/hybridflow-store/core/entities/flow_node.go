package entities

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type FlowNodeType string

type PlayResult struct {
	Status   FlowNodeStatus
	Output   string
	Workflow *WorkflowUpdate
}

const (
	FlowNodeAI                    FlowNodeType = "ai"
	FlowNodeHuman                 FlowNodeType = "human"
	FlowNodeStart                 FlowNodeType = "start"
	FlowNodeShutdown              FlowNodeType = "shutdown"
	FlowNodeScheduler             FlowNodeType = "scheduler"
	FlowNodeBitbucketPRStatus     FlowNodeType = "bitbucket-pr-status"
	FlowNodeBitbucketCommitStatus FlowNodeType = "bitbucket-commit-status"
	FlowNodeGateway               FlowNodeType = "gateway"
	FlowNodeExclusiveGateway      FlowNodeType = "exclusive-gateway"
	FlowNodeLimiter               FlowNodeType = "limiter"
	FlowNodeNote                  FlowNodeType = "note"
	FlowNodeValue                 FlowNodeType = "value"
	FlowNodeRole                  FlowNodeType = "role"
)

const FlowNodeTypeDefault = FlowNodeHuman

var flowNodeTypes = map[FlowNodeType]bool{
	FlowNodeAI: true, FlowNodeHuman: true, FlowNodeStart: true, FlowNodeShutdown: true, FlowNodeScheduler: true,
	FlowNodeBitbucketPRStatus: true, FlowNodeBitbucketCommitStatus: true,
	FlowNodeGateway: true, FlowNodeExclusiveGateway: true, FlowNodeNote: true, FlowNodeValue: true,
	FlowNodeLimiter: true, FlowNodeRole: true,
}

// ReadFlowNodeType infers unknown/absent types from legacy settings:
// Agent or Model implies AI; otherwise Human.
func ReadFlowNodeType(said string, settings TaskSettings) FlowNodeType {
	t := FlowNodeType(strings.ToLower(strings.TrimSpace(said)))
	if flowNodeTypes[t] {
		return t
	}
	if settings.Agent != "" || settings.Model != "" {
		return FlowNodeAI
	}
	return FlowNodeTypeDefault
}

func (t FlowNodeType) IsTask() bool { return t == FlowNodeAI || t == FlowNodeHuman }

func (t FlowNodeType) ForHarness() bool { return t == FlowNodeAI }

func (t FlowNodeType) IsDisplay() bool {
	return t == FlowNodeNote || t == FlowNodeValue || t == FlowNodeRole
}

func (t FlowNodeType) AcceptsPredecessor() bool { return t != FlowNodeStart && !t.IsDisplay() }

func (t FlowNodeType) Splits() bool {
	return t == FlowNodeGateway || t == FlowNodeExclusiveGateway || t == FlowNodeLimiter
}

func (t FlowNodeType) Joins() bool { return t == FlowNodeGateway || t == FlowNodeExclusiveGateway }

func (t FlowNodeType) IsBitbucketEvent() bool {
	return t == FlowNodeBitbucketPRStatus || t == FlowNodeBitbucketCommitStatus
}

// RunsItself identifies flow nodes executed by the run without an agent turn.
func (t FlowNodeType) RunsItself() bool {
	return t == FlowNodeStart || t == FlowNodeShutdown || t == FlowNodeScheduler || t.IsBitbucketEvent() || t.Splits()
}

// Chains excludes Shutdown and display flow nodes. Gateways use Nexts instead of Next.
func (t FlowNodeType) Chains() bool { return t != FlowNodeShutdown && !t.IsDisplay() }

// HasTransition identifies flow nodes that own a conversation.
func (t FlowNodeType) HasTransition() bool { return t == FlowNodeAI }

// FlowNodeStatus includes waiting-refresh for a run held until the harness account's usage limit lifts.
// Blocked is user-controlled: no run sets or clears it, and it is not Held.
type FlowNodeStatus string

const (
	StatusDraft          FlowNodeStatus = "draft"
	StatusReady          FlowNodeStatus = "ready"
	StatusTodo           FlowNodeStatus = "todo"
	StatusBlocked        FlowNodeStatus = "blocked"
	StatusRunning        FlowNodeStatus = "running"
	StatusWaitingRefresh FlowNodeStatus = "waiting-refresh"
	StatusInterrupted    FlowNodeStatus = "interrupted"
	StatusDone           FlowNodeStatus = "done"
	StatusError          FlowNodeStatus = "error"
)

const FlowNodeStatusDefault = StatusReady

var flowNodeStatuses = map[FlowNodeStatus]bool{
	StatusDraft: true, StatusReady: true, StatusTodo: true, StatusBlocked: true, StatusRunning: true,
	StatusWaitingRefresh: true, StatusInterrupted: true, StatusDone: true, StatusError: true,
}

func ReadFlowNodeStatus(said string) FlowNodeStatus {
	s := FlowNodeStatus(strings.TrimSpace(said))
	if flowNodeStatuses[s] {
		return s
	}
	return FlowNodeStatusDefault
}

// Held prevents another run from taking the flow node, including while usage limits refresh.
func (s FlowNodeStatus) Held() bool { return s == StatusRunning || s == StatusWaitingRefresh }

// Playable reports whether a free execution flow node can start a new run.
func (s FlowNodeStatus) Playable() bool { return s == StatusReady || s == StatusDone }

func (s FlowNodeStatus) CanClaim(kind FlowNodeType, alreadyHeld bool) bool {
	if alreadyHeld {
		return s == StatusReady || s.Held()
	}
	return s.Playable() || (kind == FlowNodeAI && s == StatusInterrupted)
}

func NextFor(next string, t FlowNodeType) string {
	if !t.Chains() || t.Splits() {
		return ""
	}
	return next
}

// NextsFor keeps ordered, unique, nonempty Gateway successors.
// The service validates that they belong to the board.
func NextsFor(nexts []string, t FlowNodeType) []string {
	if !t.Splits() {
		return nil
	}
	var out []string
	seen := map[string]bool{}
	for _, next := range nexts {
		if id := strings.TrimSpace(next); id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// Spot is a canvas position; a nil *Spot means unplaced.
type Spot struct{ X, Y int }

// Size is a card's resized dimensions. H zero keeps the card's natural height.
type Size struct{ W, H int }

// Schedules are local wall-clock datetimes in the operator's zone, not instants,
// to preserve the intended time across daylight-saving changes.
var scheduleShape = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$`)

func ReadSchedule(said string) string {
	said = strings.TrimSpace(said)
	if nodeContextReference.MatchString(said) {
		return said
	}
	if !scheduleShape.MatchString(said) {
		return ""
	}
	return said[:16]
}

// FlowNode is independently versioned and updated field by field.
type FlowNode struct {
	ID      string
	BoardID string
	// Title is empty on note flow nodes.
	Title string
	Type  FlowNodeType
	// Note holds markdown on note flow nodes.
	Note string
	// Value holds canonical JSON text on value flow nodes.
	Value string
	// ValueType is "", ValueTypeJSONSchema, or the id of a value flow node typed as JSON Schema.
	ValueType string
	// RoleID is the board-local reference key, independent of the flow node ID and title.
	RoleID      string
	RoleKind    RoleKind
	People      []string
	Description string
	// OutputType names a JSON Schema value from any board; Output is the last successful export.
	OutputType string
	Output     string
	// Tags are ordered labels, not instance-specific IDs, so pasted flow nodes retain their meaning.
	Tags []string
	// Task is present only for AI and Human flow nodes.
	Task *Task
	// ScheduledAt is normalized by ReadSchedule; empty for non-Scheduler flow nodes.
	ScheduledAt string
	Duration    string

	PullRequestID     string
	PullRequestStatus string
	CommitID          string
	CommitStatus      string
	MaxPasses         int
	RemainingPasses   int

	Spot   *Spot
	Size   *Size
	Status FlowNodeStatus
	// Archived retains the record while excluding the flow node from the canvas and playback.
	Archived bool
	// Next is the successor after success; empty for Shutdown and Gateway flow nodes.
	Next string
	// Nexts are the linked branches of a gateway.
	Nexts []string
	// Routes are evaluated in order by an exclusive gateway.
	Routes []Route
	// RunID is empty when free. Conditional claims ensure only one run holds the flow node.
	RunID     string
	ClaimedAt time.Time
	// Completion orders successful results across flow nodes for parallel gateway replays.
	Completion int64
	// WorkflowID groups the flow node in at most one workflow; empty means ungrouped.
	WorkflowID string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	// Revision increments on every flow node write, including Task changes.
	// Optimistic conflicts are per flow node; Task has no separate revision.
	Revision int64
}

type SchemaValue struct {
	ID        string
	Title     string
	Value     string
	BoardSlug string
	BoardName string
}

func (t *FlowNode) Settings() TaskSettings {
	if t.Task == nil {
		return TaskSettings{}
	}
	return t.Task.Settings
}

func (t *FlowNode) ConversationID() string {
	if t.Task == nil {
		return ""
	}
	return t.Task.ConversationID
}

var (
	ErrFlowNodeNotRunnable = errors.New("flow node cannot be played")
	ErrFlowNodeHeld        = errors.New("flow node is already being played")
	ErrGatewayWaiting      = Conflictf("the gateway is waiting for its incoming branches")
	// ErrFlowNodeEmptyPrompt also ends a chain on a flow node that has already run.
	ErrFlowNodeEmptyPrompt = errors.New("flow node has nothing to send")
)

func (t *FlowNode) Prompt() string {
	if t.Task == nil {
		return ""
	}
	return t.Task.Prompt(t.Title)
}

// Runnable checks type requirements. Play also checks the flow node's status.
// An archived flow node is never runnable: it is hidden everywhere, and its chains are hidden too.
func (t *FlowNode) Runnable() error {
	if t.Archived {
		return fmt.Errorf("%w: an archived flow node is hidden and cannot be played", ErrFlowNodeNotRunnable)
	}
	switch t.Type {
	case FlowNodeAI:
		if !t.Settings().Complete() {
			return fmt.Errorf("%w: an AI flow node names an agent, an effort, a permission mode and a folder", ErrFlowNodeNotRunnable)
		}
		if t.Prompt() == "" {
			return ErrFlowNodeEmptyPrompt
		}
	case FlowNodeScheduler:
		if ReadSchedule(t.ScheduledAt) == "" && ReadDuration(t.Duration) == "" {
			return fmt.Errorf("%w: a Scheduler names a duration or the datetime it waits for", ErrFlowNodeNotRunnable)
		}
	case FlowNodeBitbucketPRStatus:
		if t.PullRequestID == "" || t.PullRequestStatus == "" {
			return fmt.Errorf("%w: a Bitbucket PR Status flow node needs a pull request ID and a target status", ErrFlowNodeNotRunnable)
		}
	case FlowNodeBitbucketCommitStatus:
		if t.CommitID == "" || t.CommitStatus == "" {
			return fmt.Errorf("%w: a Bitbucket Commit Status flow node needs a commit ID and a target status", ErrFlowNodeNotRunnable)
		}
	case FlowNodeStart, FlowNodeShutdown, FlowNodeGateway, FlowNodeExclusiveGateway, FlowNodeLimiter:
	case FlowNodeNote, FlowNodeValue, FlowNodeRole:
		return fmt.Errorf("%w: a display flow node is never played", ErrFlowNodeNotRunnable)
	default:
		return fmt.Errorf("%w: a Human flow node is nobody's to play", ErrFlowNodeNotRunnable)
	}
	return nil
}

func ReadTags(said []string) []string {
	out := make([]string, 0, len(said))
	seen := map[string]bool{}
	for _, entry := range said {
		label := strings.Join(strings.Fields(entry), " ")
		if label == "" || seen[strings.ToLower(label)] {
			continue
		}
		seen[strings.ToLower(label)] = true
		out = append(out, label)
	}
	return out
}

const ValueTypeJSONSchema = "json-schema"

func ReadValueType(said string) string {
	said = strings.TrimSpace(said)
	if said == "" || said == ValueTypeJSONSchema || ValidID(said) {
		return said
	}
	return ""
}

func (t *FlowNode) IsSchemaValue() bool {
	return t.Type == FlowNodeValue && t.ValueType == ValueTypeJSONSchema
}

func ReadValueJSON(raw string) (string, error) {
	said := strings.TrimSpace(raw)
	if said == "" {
		return "{}", nil
	}
	if !json.Valid([]byte(said)) {
		return "", Invalidf("value must be valid JSON")
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, []byte(said)); err != nil {
		return "", Invalidf("value must be valid JSON")
	}
	return buf.String(), nil
}

func FormatValueJSON(raw string) string {
	said := strings.TrimSpace(raw)
	if said == "" {
		return "{}"
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, []byte(said), "", "  "); err != nil {
		return said
	}
	return buf.String()
}

// Validate client-minted IDs before they can cause a database cast failure.
var uuidShape = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func ValidID(id string) bool { return uuidShape.MatchString(strings.TrimSpace(id)) }
