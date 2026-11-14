package entities

import "strings"

// TaskSettings has no defaults: AI tasks require Agent, Effort, Permission and Folder.
// Agent is a managed agent ID; Human tasks also use Folder.
type TaskSettings struct {
	Agent string
	// Model supports legacy boards with an engine in Agent; read only, never written.
	Model      string
	Effort     string
	Permission string
	// Folder is a store-root link with a leading slash.
	Folder string
	// Runner pins play to a runner ID; empty allows play wherever requested.
	// The runner enforces the pin at play time; it does not affect Runnable.
	Runner string
	// Extra preserves unknown settings when importing boards from newer instances.
	Extra map[string]string
}

func (s TaskSettings) Complete() bool {
	return s.Agent != "" && s.Effort != "" && s.Permission != "" && s.Folder != ""
}

func (s TaskSettings) Empty() bool {
	return s.Agent == "" && s.Model == "" && s.Effort == "" && s.Permission == "" && s.Folder == "" &&
		s.Runner == ""
}

// TransitionMode controls whether the successor receives a conversation fork; absent means end.
type TransitionMode string

const (
	TransitionContinue TransitionMode = "continue"
	TransitionEnd      TransitionMode = "end"
	// LegacyTransitionCompact is read only: continue with Compact enabled.
	LegacyTransitionCompact TransitionMode = "compact"
)

const TransitionModeDefault = TransitionEnd

var transitionModes = map[TransitionMode]bool{TransitionContinue: true, TransitionEnd: true}

// ReadTransitionMode also reports whether the legacy mode requested compaction.
func ReadTransitionMode(said string) (TransitionMode, bool) {
	m := TransitionMode(strings.TrimSpace(said))
	if m == LegacyTransitionCompact {
		return TransitionContinue, true
	}
	if transitionModes[m] {
		return m, false
	}
	return TransitionModeDefault, false
}

// CarriesChat reports whether the successor receives a conversation fork.
func (m TransitionMode) CarriesChat() bool { return m == TransitionContinue }

// Transition controls successful completion; both fields share onSuccess on the wire.
type Transition struct {
	Mode TransitionMode
	// Compact shortens this task's conversation before any fork, even without a successor.
	Compact bool
}

// For normalizes legacy/unknown modes and clears transitions on cards without conversations.
func (t Transition) For(f FlowNodeType) Transition {
	out := t
	if out.Mode == LegacyTransitionCompact {
		out.Mode, out.Compact = TransitionContinue, true
	}
	if !transitionModes[out.Mode] {
		out.Mode = TransitionModeDefault
	}
	if !f.HasTransition() {
		out.Mode, out.Compact = TransitionModeDefault, false
	}
	return out
}

// SuccessCriterion has a stable editing ID and prompt text.
type SuccessCriterion struct {
	ID   string
	Text string
}

var validComplexities = map[int]bool{1: true, 2: true, 3: true, 5: true, 8: true, 13: true, 21: true}

func Complexities() []int { return []int{1, 2, 3, 5, 8, 13, 21} }

func ReadComplexity(said *int) *int {
	if said == nil || !validComplexities[*said] {
		return nil
	}
	out := *said
	return &out
}

// ReadSuccessCriteria trims entries and drops empty texts, preserving order.
// The caller must mint missing IDs before storage.
func ReadSuccessCriteria(said []SuccessCriterion) []SuccessCriterion {
	out := make([]SuccessCriterion, 0, len(said))
	for _, criterion := range said {
		text := strings.TrimSpace(criterion.Text)
		if text == "" {
			continue
		}
		out = append(out, SuccessCriterion{ID: strings.TrimSpace(criterion.ID), Text: text})
	}
	return out
}

func CriteriaText(criteria []SuccessCriterion) []string {
	out := make([]string, 0, len(criteria))
	for _, criterion := range criteria {
		if text := strings.TrimSpace(criterion.Text); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func (k Task) HasContent(title string) bool {
	if strings.TrimSpace(title) != "" || strings.TrimSpace(k.Body) != "" {
		return true
	}
	return len(CriteriaText(k.Criteria)) > 0
}

// Task holds work for AI and Human flow nodes; other kinds have no Task.
type Task struct {
	// Body is the prompt description; play results stay in the conversation and never replace it.
	Body string
	// Criteria are sent with the prompt when present.
	Criteria []SuccessCriterion
	// Complexity is an optional Fibonacci estimate, never sent with the prompt.
	Complexity *int
	Settings   TaskSettings
	// ConversationID is reused on replay; empty means no conversation yet.
	ConversationID string
	Transition Transition
}

// Prompt uses the title only when Body is empty, and always includes nonempty criteria.
func (k Task) Prompt(title string) string {
	base := strings.TrimSpace(k.Body)
	if base == "" {
		base = strings.TrimSpace(title)
	}
	lines := CriteriaText(k.Criteria)
	if len(lines) == 0 {
		return base
	}
	criteria := "Success criteria:\n- " + strings.Join(lines, "\n- ")
	if base == "" {
		return criteria
	}
	return base + "\n\n" + criteria
}

func (k Task) For(t FlowNodeType) Task {
	out := k
	out.Transition = out.Transition.For(t)
	return out
}
