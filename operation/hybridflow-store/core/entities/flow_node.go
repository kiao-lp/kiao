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

// Gateway waits for all incoming branches, then starts all outgoing branches.
type FlowNodeType string

const (
	FlowNodeAI        FlowNodeType = "ai"
	FlowNodeHuman     FlowNodeType = "human"
	FlowNodeShutdown  FlowNodeType = "shutdown"
	FlowNodeScheduler FlowNodeType = "scheduler"
	FlowNodeGateway   FlowNodeType = "gateway"
	FlowNodeNote      FlowNodeType = "note"
	FlowNodeValue     FlowNodeType = "value"
)

const FlowNodeTypeDefault = FlowNodeHuman

var flowNodeTypes = map[FlowNodeType]bool{
	FlowNodeAI: true, FlowNodeHuman: true, FlowNodeShutdown: true, FlowNodeScheduler: true,
	FlowNodeGateway: true, FlowNodeNote: true, FlowNodeValue: true,
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

func (t FlowNodeType) ForAgent() bool { return t == FlowNodeAI }

func (t FlowNodeType) IsDisplay() bool { return t == FlowNodeNote || t == FlowNodeValue }

// RunsItself identifies cards executed by the run without an agent turn.
func (t FlowNodeType) RunsItself() bool {
	return t == FlowNodeShutdown || t == FlowNodeScheduler || t == FlowNodeGateway
}

// Chains excludes Shutdown and display cards. Gateways use Nexts instead of Next.
func (t FlowNodeType) Chains() bool { return t != FlowNodeShutdown && !t.IsDisplay() }

// HasTransition identifies cards that own a conversation.
func (t FlowNodeType) HasTransition() bool { return t == FlowNodeAI }

// FlowNodeStatus includes waiting-refresh for a run held until agent usage limits lift.
// Blocked is user-controlled: no run sets or clears it, and it is not Held.
// StartPlay and ClaimFlowNode accept only ready cards.
type FlowNodeStatus string

const (
	StatusDraft          FlowNodeStatus = "draft"
	StatusReady          FlowNodeStatus = "ready"
	StatusBlocked        FlowNodeStatus = "blocked"
	StatusRunning        FlowNodeStatus = "running"
	StatusWaitingRefresh FlowNodeStatus = "waiting-refresh"
	StatusInterrupted    FlowNodeStatus = "interrupted"
	StatusDone           FlowNodeStatus = "done"
	StatusError          FlowNodeStatus = "error"
)

const FlowNodeStatusDefault = StatusReady

var flowNodeStatuses = map[FlowNodeStatus]bool{
	StatusDraft: true, StatusReady: true, StatusBlocked: true, StatusRunning: true,
	StatusWaitingRefresh: true, StatusInterrupted: true, StatusDone: true, StatusError: true,
}

func ReadFlowNodeStatus(said string) FlowNodeStatus {
	s := FlowNodeStatus(strings.TrimSpace(said))
	if flowNodeStatuses[s] {
		return s
	}
	return FlowNodeStatusDefault
}

// Held prevents another run from taking the card, including while usage limits refresh.
func (s FlowNodeStatus) Held() bool { return s == StatusRunning || s == StatusWaitingRefresh }

func NextFor(next string, t FlowNodeType) string {
	if !t.Chains() || t == FlowNodeGateway {
		return ""
	}
	return next
}

// NextsFor keeps ordered, unique, nonempty Gateway successors.
// The service validates that they belong to the board.
func NextsFor(nexts []string, t FlowNodeType) []string {
	if t != FlowNodeGateway {
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

// Schedules are local wall-clock datetimes in the operator's zone, not instants,
// to preserve the intended time across daylight-saving changes.
var scheduleShape = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$`)

func ReadSchedule(said string) string {
	said = strings.TrimSpace(said)
	if !scheduleShape.MatchString(said) {
		return ""
	}
	return said[:16]
}

// FlowNode is updated field by field so independent edits need not rewrite the board.
type FlowNode struct {
	ID      string
	BoardID string
	// Title is empty on note cards.
	Title string
	Type  FlowNodeType
	// Note holds markdown on note cards.
	Note string
	// Value holds canonical JSON text on value cards.
	Value string
	// Tags are ordered labels, not instance-specific IDs, so pasted cards retain their meaning.
	Tags []string
	// Task is present only for AI and Human cards.
	Task *Task
	// ScheduledAt is normalized by ReadSchedule; empty for non-Scheduler cards.
	ScheduledAt string
	Duration    string
	Spot        *Spot
	Status      FlowNodeStatus
	// Archived hides the card everywhere without deleting it. It is a boolean
	// flip, never a file, and chains to or from an archived card are hidden too.
	Archived bool
	// Next is the successor after success; empty for Shutdown and Gateway cards.
	Next string
	// Nexts are ordered branches a Gateway starts in parallel; empty for other kinds.
	Nexts []string
	// RunID is empty when free. Conditional claims ensure only one run holds the card.
	RunID     string
	ClaimedAt time.Time
	// ClassVersionID identifies the source version; clearing it detaches without changing content.
	ClassVersionID string
	// ClassRef is resolved on read; nil if no version is named or the version was deleted.
	ClassRef *ClassRef
	// WorkflowID groups the card in at most one workflow; empty means ungrouped.
	WorkflowID string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	// Revision increments on every card write, including Task changes.
	// Optimistic conflicts are per card; Task has no separate revision.
	Revision int64
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
	// ErrFlowNodeEmptyPrompt also ends a chain on a card that has already run.
	ErrFlowNodeEmptyPrompt = errors.New("flow node has nothing to send")
)

func (t *FlowNode) Prompt() string {
	if t.Task == nil {
		return ""
	}
	return t.Task.Prompt(t.Title)
}

// Runnable checks type requirements, not status: play additionally requires ready.
// AI needs four settings and a prompt; Scheduler needs a duration or datetime; Human cannot run.
// An archived card is never runnable: it is hidden everywhere, and its chains are hidden too.
func (t *FlowNode) Runnable() error {
	if t.Archived {
		return fmt.Errorf("%w: an archived card is hidden and cannot be played", ErrFlowNodeNotRunnable)
	}
	switch t.Type {
	case FlowNodeAI:
		if !t.Settings().Complete() {
			return fmt.Errorf("%w: an AI card names an agent, an effort, a permission mode and a folder", ErrFlowNodeNotRunnable)
		}
		if t.Prompt() == "" {
			return ErrFlowNodeEmptyPrompt
		}
	case FlowNodeScheduler:
		if ReadSchedule(t.ScheduledAt) == "" && ReadDuration(t.Duration) == "" {
			return fmt.Errorf("%w: a Scheduler names a duration or the datetime it waits for", ErrFlowNodeNotRunnable)
		}
	case FlowNodeShutdown:
	case FlowNodeGateway:
		// Gateway branches are defined on the board.
	case FlowNodeNote, FlowNodeValue:
		return fmt.Errorf("%w: a display card is never played", ErrFlowNodeNotRunnable)
	default:
		return fmt.Errorf("%w: a Human card is nobody's to play", ErrFlowNodeNotRunnable)
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
