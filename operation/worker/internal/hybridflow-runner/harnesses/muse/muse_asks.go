package muse

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museAsks owns pending requests and decision command IDs. mu serializes relay
// updates with Answer; it is released before RPC or event delivery. Published
// HarnessAsk values are immutable so the consumer can read them without this lock.
type museAsks struct {
	mu      sync.Mutex
	pending map[string]*MuseAsk
}

// museAsk is one thing the turn is parked on: an approval to decide, or a question to answer. It is
// the driver's copy of what the hub holds as a claudePermission — the HarnessAsk that was emitted,
// and whatever answering it needs that the hub does not carry.
type MuseAsk struct {
	Ask *harnessapi.HarnessAsk
	// approvalID and requirement are the approval this ask decides: the id, and the
	// currentRequirementId verbatim — the multi-stage race guard a decision has to echo.
	ApprovalID  string
	Requirement any
	Choices     []MuseChoice
	// userInputID and questions are the prompt this ask answers: the id, and one entry per
	// question in the order asked, with what answering it needs — the question's own id, whether
	// several options may be chosen, and the labels an answer is matched against.
	UserInputID string
	questions   []MuseQuestion
	// answered is set once the hub has answered; decidedBy holds the command ids the answers went
	// out under. A settlement decided by one of those is the answer landing, and anything else —
	// the judge, a timeout, another client — is a withdrawal.
	Answered  bool
	DecidedBy map[string]bool
}

// museChoice is one way an approval may be decided, as the host offered it.
type MuseChoice struct {
	ChoiceID        string
	Decision        string
	Scope           string
	acceptsFeedback bool
}

// museQuestion is one question of a user-input prompt.
type MuseQuestion struct {
	Id       string
	Multiple bool
	Labels   []string
}

// isQuestion reports whether this ask is a question to answer rather than a call to allow.
func (ask *MuseAsk) isQuestion() bool { return ask.UserInputID != "" }

// museApprovalAnswer allows or denies one tool call. The choice is always the call's own: an allow
// answers the once-scoped approval, never the session-scoped one — "don't ask again this session"
// is broader than any card the hub shows, and answering it on the user's behalf would silence asks
// the user has not seen yet.
func museApprovalAnswer(ask *MuseAsk, decision harnessapi.AskDecision) (museAnswer, error) {
	choice := MuseChoiceFor(ask.Choices, decision.Allow)
	if choice == nil {
		outcome := "allowed"
		if !decision.Allow {
			outcome = "denied"
		}
		return museAnswer{}, fmt.Errorf("Muse offered no way for that call to be %s", outcome)
	}
	commandID := MspCommandID()
	params := map[string]any{
		"commandId":  commandID,
		"approvalId": ask.ApprovalID, "choiceId": choice.ChoiceID,
		"requirementId": ask.Requirement,
	}
	if !decision.Allow && choice.acceptsFeedback && strings.TrimSpace(decision.Message) != "" {
		params["feedback"] = decision.Message
	}
	return museAnswer{method: "approval/decide", params: params, failure: "decision"}, nil
}

// museChoiceFor is the choice an allow or a deny takes: the once-scoped one of that outcome,
// falling back to any choice of it. A scope the vocabulary has moved past is still a scope the
// host offered, so anything beats nothing — except a policy amendment, which rewrites the rules
// rather than deciding the call and is never taken on the user's behalf.
func MuseChoiceFor(choices []MuseChoice, allow bool) *MuseChoice {
	want := "denied"
	if allow {
		want = "approved"
	}
	var fallback *MuseChoice
	for i := range choices {
		choice := &choices[i]
		if choice.Decision != want {
			continue
		}
		if choice.Scope == "once" {
			return choice
		}
		if fallback == nil {
			fallback = choice
		}
	}
	return fallback
}

// museQuestionAnswer answers every question of a user-input prompt. An answer that names one of the
// question's own options goes back as the selection; anything else goes back as free text, which
// is what the tool reads the CLI's own "Other" as. A question left blank is answered with no text
// rather than skipped — the model is told it was not answered — and a card of nothing but blanks
// is declined outright, which is how a dismissal reads to the model.
func museQuestionAnswer(ask *MuseAsk, decision harnessapi.AskDecision) museAnswer {
	// The hub hands back the input it was given with the answers filed under "answers", keyed by
	// question text — the map the tool reads.
	updated, _ := decision.Input.(map[string]any)
	answers, _ := updated["answers"].(map[string]any)
	entries := make([]map[string]any, 0, len(ask.questions))
	blanks := 0
	for i, question := range ask.questions {
		text := ""
		if key := museQuestionKey(ask, i); key != "" && answers != nil {
			text, _ = answers[key].(string)
		}
		if strings.TrimSpace(text) == "" {
			blanks++
		}
		entry := map[string]any{"questionId": question.Id}
		switch selected := MuseSelectedLabels(question, text); {
		case len(selected) > 1 || (len(selected) == 1 && question.Multiple):
			entry["selectedLabels"] = selected
		case len(selected) == 1:
			entry["selectedLabel"] = selected[0]
		default:
			entry["freeText"] = text
		}
		entries = append(entries, entry)
	}
	params := map[string]any{"commandId": MspCommandID(), "userInputId": ask.UserInputID}
	if blanks == len(entries) {
		params["reason"] = "The user dismissed the question."
		return museAnswer{method: "userInput/cancel", params: params, failure: "dismissal"}
	}
	params["answers"] = entries
	return museAnswer{method: "userInput/answer", params: params, failure: "answers"}
}

// museQuestionKey is the answers-map key of one question: the question's text exactly as asked,
// which is what the hub files the answer under.
func museQuestionKey(ask *MuseAsk, index int) string {
	if index < 0 || index >= len(ask.Ask.QuestionKeys) {
		return ""
	}
	return ask.Ask.QuestionKeys[index]
}

// museSelectedLabels reads an answer against one question's options: the labels it names, in the
// order it names them. A multi-select answer carries its labels comma-separated, which is the form
// the hub writes; a single answer that is not one of its options is not a selection at all.
func MuseSelectedLabels(question MuseQuestion, answer string) []string {
	labels := map[string]bool{}
	for _, label := range question.Labels {
		labels[label] = true
	}
	var selected []string
	if question.Multiple {
		for _, part := range strings.Split(answer, ",") {
			if trimmed := strings.TrimSpace(part); labels[trimmed] {
				selected = append(selected, trimmed)
			}
		}
		return selected
	}
	if trimmed := strings.TrimSpace(answer); labels[trimmed] {
		return []string{trimmed}
	}
	return nil
}

// parked reports whether the turn is waiting on something only a person can answer: an ask
// the hub has not decided yet. A decided one is the host's to settle, and a settled one is gone —
// neither holds the idle wait.
func (a *museAsks) parked() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, ask := range a.pending {
		if !ask.Answered {
			return true
		}
	}
	return false
}

// unseen counts the pending asks nobody was shown: the ones the hub does not hold. An
// entry naming no id cannot match anything held and counts as unseen — the conservative
// side, since an unmatched settlement is a wait and a matched one nobody saw is a stall.
func (a *museAsks) unseen(parked []sessionAsk) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	unseen := 0
	for _, ask := range parked {
		if ask.id == "" {
			unseen++
			continue
		}
		if _, ok := a.pending[ask.id]; !ok {
			unseen++
		}
	}
	return unseen
}

const MuseAskApprovalPrefix = "apv-"

const MuseAskQuestionPrefix = "inq-"

// approvalAsked turns one approval request into an ask. The tool input travels twice, as on the
// Claude side: verbatim for the allow to echo, and rendered for the person deciding.
func (d *MuseDriver) approvalAsked(params map[string]any) (harnessapi.HarnessEvent, bool) {
	if !d.host.ownsTurn(params) {
		return harnessapi.HarnessEvent{}, false
	}
	approvalID := pkgProtocol.AsString(params["approvalId"])
	if approvalID == "" {
		harnessapi.LogClaudeWS.Warn("muse approval without an id",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn)
		return harnessapi.HarnessEvent{}, false
	}
	input := museRawArgs(params)
	subject, _ := params["subject"].(map[string]any)
	ask := &harnessapi.HarnessAsk{
		ID:           MuseAskApprovalPrefix + approvalID,
		Tool:         pkgProtocol.OrDefault(pkgProtocol.AsString(params["toolName"]), "tool"),
		Description:  pkgProtocol.CutRunes(MuseSubjectLine(subject), 200),
		ToolUseID:    pkgProtocol.AsString(params["itemId"]),
		Input:        input,
		InputSummary: pkgProtocol.PermissionInputSummary(input),
	}
	d.asks.put(&MuseAsk{
		Ask:         ask,
		ApprovalID:  approvalID,
		Requirement: params["currentRequirementId"],
		Choices:     museChoices(params),
	})
	return harnessapi.HarnessEvent{Kind: harnessapi.EventAsk, Ask: ask}, true
}

// museRawArgs is an approval's tool input: the verbatim argument JSON parsed where it parses, and
// the raw string where it does not — the same forgiving reading a toolCall item's args get.
func museRawArgs(params map[string]any) any {
	raw, _ := params["rawArgs"].(string)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	return parsed
}

// museSubjectLine is what the host says the approval is about, in one line: the command for a
// shell call, the path for a file access, the endpoint for a network call. It is the sentence the
// card is read by, so it names the target rather than the kind.
func MuseSubjectLine(subject map[string]any) string {
	switch pkgProtocol.AsString(subject["kind"]) {
	case "shell", "process":
		return pkgProtocol.OrDefault(pkgProtocol.AsString(subject["command"]), pkgProtocol.AsString(subject["kind"]))
	case "fileAccess":
		path := pkgProtocol.AsString(subject["path"])
		if access := pkgProtocol.AsString(subject["access"]); access != "" && path != "" {
			return access + " " + path
		}
		return pkgProtocol.OrDefault(path, "file access")
	case "network":
		host := pkgProtocol.AsString(subject["host"])
		if protocol := pkgProtocol.AsString(subject["protocol"]); protocol != "" && host != "" {
			return protocol + "://" + host
		}
		return pkgProtocol.OrDefault(host, "network access")
	case "tool":
		return pkgProtocol.OrDefault(pkgProtocol.AsString(subject["toolName"]), "tool call")
	default:
		if target := pkgProtocol.AsString(subject["target"]); target != "" {
			return target
		}
		return pkgProtocol.AsString(subject["kind"])
	}
}

// museChoices reads the ways an approval may be decided. A choice without an id is dropped — there
// would be nothing to send back — and an ask left with none still parks the turn: the card shows
// the call, and answering it says the host offered no way through.
func museChoices(params map[string]any) []MuseChoice {
	raw, _ := params["availableChoices"].([]any)
	choices := make([]MuseChoice, 0, len(raw))
	for _, entry := range raw {
		offered, _ := entry.(map[string]any)
		id := pkgProtocol.AsString(offered["choiceId"])
		if id == "" {
			continue
		}
		accepts, _ := offered["acceptsFeedback"].(bool)
		choices = append(choices, MuseChoice{
			ChoiceID:        id,
			Decision:        pkgProtocol.AsString(offered["decision"]),
			Scope:           pkgProtocol.AsString(offered["scope"]),
			acceptsFeedback: accepts,
		})
	}
	return choices
}

// settleApproval withdraws an ask the host settled without the hub: the judge approved it, a
// timeout denied it, another client decided it. A settlement of the hub's own decision is the
// answer landing, and is stepped over — the card is already gone.
func (a *museAsks) settleApproval(params map[string]any) (harnessapi.HarnessEvent, bool) {
	approvalID := pkgProtocol.AsString(params["approvalId"])
	if approvalID == "" {
		return harnessapi.HarnessEvent{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	ask, ok := a.pending[MuseAskApprovalPrefix+approvalID]
	if !ok || ask.isQuestion() {
		return harnessapi.HarnessEvent{}, false
	}
	if decided := pkgProtocol.AsString(params["decidedByCommandId"]); decided != "" && ask.DecidedBy[decided] {
		return harnessapi.HarnessEvent{}, false
	}
	delete(a.pending, ask.Ask.ID)
	return harnessapi.HarnessEvent{Kind: harnessapi.EventWithdraw, AskID: ask.Ask.ID}, true
}

// updateApproval refreshes a pending approval: a further stage named a new requirement, and the
// next decision echoes that one rather than the one the ask opened with. An ask the hub has
// already answered is re-emitted rather than only refreshed — the card went down with the answer,
// and the turn is about to park again with nothing on screen.
func (a *museAsks) updateApproval(params map[string]any) (harnessapi.HarnessEvent, bool) {
	approvalID := pkgProtocol.AsString(params["approvalId"])
	if approvalID == "" {
		return harnessapi.HarnessEvent{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	ask, ok := a.pending[MuseAskApprovalPrefix+approvalID]
	if !ok || ask.isQuestion() {
		return harnessapi.HarnessEvent{}, false
	}
	ask.Requirement = params["currentRequirementId"]
	ask.Choices = museChoices(params)
	if subject, ok := params["subject"].(map[string]any); ok {
		updated := *ask.Ask
		updated.Description = pkgProtocol.CutRunes(MuseSubjectLine(subject), 200)
		ask.Ask = &updated
	}
	if !ask.Answered {
		return harnessapi.HarnessEvent{}, false
	}
	ask.Answered = false
	return harnessapi.HarnessEvent{Kind: harnessapi.EventAsk, Ask: ask.Ask}, true
}

// questionAsked turns one user-input prompt into an ask carrying Questions, which is what makes
// the hub give it frames of its own and withhold every shortcut a permission has. A prompt no card
// could render — a question with nothing to ask — is declined on the spot rather than parked on:
// refusing it leaves the turn where a dismissal leaves it, and the failure says why.
func (d *MuseDriver) questionAsked(params map[string]any) (harnessapi.HarnessEvent, bool) {
	if !d.host.ownsTurn(params) {
		return harnessapi.HarnessEvent{}, false
	}
	userInputID := pkgProtocol.AsString(params["userInputId"])
	raw, _ := params["questions"].([]any)
	if userInputID == "" || len(raw) == 0 {
		harnessapi.LogClaudeWS.Warn("muse question prompt without an id or a question",
			"conversation", d.Run.Conversation, "turn", d.Run.Turn)
		return harnessapi.HarnessEvent{}, false
	}
	questions, keys, asked := museQuestions(raw)
	if len(questions) == 0 {
		state := d.host.snapshot()
		conn, sessionID := state.conn, state.sessionID
		if conn != nil && sessionID != "" {
			_, _ = conn.Call("userInput/cancel", map[string]any{
				"commandId": MspCommandID(), "sessionId": sessionID,
				"userInputId": userInputID,
				"reason":      "The question had nothing to ask.",
			})
		}
		return harnessapi.HarnessEvent{Kind: harnessapi.EventFailure,
			Message: "Muse asked a question with nothing to ask; it was dismissed."}, true
	}
	ask := &harnessapi.HarnessAsk{
		ID:           MuseAskQuestionPrefix + userInputID,
		Tool:         pkgProtocol.OrDefault(pkgProtocol.AsString(params["toolName"]), "question"),
		ToolUseID:    pkgProtocol.AsString(params["itemId"]),
		Input:        map[string]any{"userInputId": userInputID},
		Questions:    questions,
		QuestionKeys: keys,
	}
	d.asks.put(&MuseAsk{Ask: ask, UserInputID: userInputID, questions: asked})
	return harnessapi.HarnessEvent{Kind: harnessapi.EventAsk, Ask: ask}, true
}

// museQuestions reads a user-input prompt into the question list an ask carries, or nothing when
// no card could render it. The bounds are the panel's own (driver_claude.go): the card it lands
// in is the same card, and a malformed or enormous ask is cut to something renderable rather than
// refused — except a question with nothing to ask, which cannot be answered and drops the whole
// prompt rather than shifting every answer after it onto the wrong question.
func museQuestions(raw []any) (questions []map[string]any, keys []string, asked []MuseQuestion) {
	for _, entry := range raw {
		if len(questions) == harnessapi.MaxQuestions {
			break
		}
		question, _ := entry.(map[string]any)
		key := pkgProtocol.AsString(question["question"])
		if key == "" {
			return nil, nil, nil
		}
		selection, _ := question["selection"].(map[string]any)
		multiple := pkgProtocol.AsString(selection["mode"]) == "multiple"
		entry := map[string]any{
			"question": pkgProtocol.CutRunes(key, harnessapi.MaxQuestionChars),
			"options":  museQuestionOptions(question["options"]),
		}
		if header := pkgProtocol.CutRunes(pkgProtocol.AsString(question["header"]), harnessapi.MaxQuestionChars); header != "" {
			entry["header"] = header
		}
		if multiple {
			entry["multiSelect"] = true
		}
		questions = append(questions, entry)
		keys = append(keys, key)
		asked = append(asked, MuseQuestion{
			Id: pkgProtocol.AsString(question["id"]), Multiple: multiple,
			Labels: museOptionLabels(question["options"]),
		})
	}
	return questions, keys, asked
}

// museQuestionOptions reads one question's choices. An option with no label is dropped — there
// would be nothing to click and nothing to send back — and a question left with none is still a
// question: the client offers the free-text answer it always offers.
func museQuestionOptions(raw any) []map[string]any {
	entries, _ := raw.([]any)
	options := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if len(options) == harnessapi.MaxQuestionOptions {
			break
		}
		offered, _ := entry.(map[string]any)
		label := pkgProtocol.CutRunes(pkgProtocol.AsString(offered["label"]), harnessapi.MaxQuestionChars)
		if label == "" {
			continue
		}
		option := map[string]any{"label": label}
		if description := pkgProtocol.CutRunes(pkgProtocol.AsString(offered["description"]), harnessapi.MaxQuestionChars); description != "" {
			option["description"] = description
		}
		preview, _ := offered["preview"].(map[string]any)
		if content := pkgProtocol.CutRunes(pkgProtocol.AsString(preview["content"]), pkgProtocol.MaxPermissionInputChars); content != "" {
			option["preview"] = content
		}
		options = append(options, option)
	}
	return options
}

// museOptionLabels is the labels an answer is matched against: the full text, uncut — a label the
// panel trimmed is still answered under the name the tool knows it by.
func museOptionLabels(raw any) []string {
	entries, _ := raw.([]any)
	var labels []string
	for _, entry := range entries {
		offered, _ := entry.(map[string]any)
		if label := pkgProtocol.AsString(offered["label"]); label != "" {
			labels = append(labels, label)
		}
	}
	return labels
}

// settleQuestion withdraws a prompt the host settled without the hub: interrupted, timed out, or
// decided by another client. A settlement of the hub's own answers is the answer landing, and is
// stepped over — the card is already gone.
func (a *museAsks) settleQuestion(params map[string]any) (harnessapi.HarnessEvent, bool) {
	userInputID := pkgProtocol.AsString(params["userInputId"])
	if userInputID == "" {
		return harnessapi.HarnessEvent{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	ask, ok := a.pending[MuseAskQuestionPrefix+userInputID]
	if !ok || !ask.isQuestion() {
		return harnessapi.HarnessEvent{}, false
	}
	if decided := pkgProtocol.AsString(params["decidedByCommandId"]); decided != "" && ask.DecidedBy[decided] {
		return harnessapi.HarnessEvent{}, false
	}
	delete(a.pending, ask.Ask.ID)
	return harnessapi.HarnessEvent{Kind: harnessapi.EventWithdraw, AskID: ask.Ask.ID}, true
}

// museAnswer is a detached command, ready for I/O after the store lock is released.
type museAnswer struct {
	method  string
	params  map[string]any
	failure string
}

func (a *museAsks) contains(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.pending[id]
	return ok
}

func (a *museAsks) put(ask *MuseAsk) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending == nil {
		a.pending = map[string]*MuseAsk{}
	}
	a.pending[ask.Ask.ID] = ask
}

// prepare captures the current stage and records the decision before sending it.
// An immediate settlement can therefore recognize our command, and a stage update
// after preparation reopens the card without changing the command in flight.
func (a *museAsks) prepare(id string, decision harnessapi.AskDecision) (museAnswer, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	ask, ok := a.pending[id]
	if !ok {
		return museAnswer{}, errors.New("Muse is waiting for nothing by that name")
	}
	var answer museAnswer
	if ask.isQuestion() {
		answer = museQuestionAnswer(ask, decision)
	} else {
		var err error
		answer, err = museApprovalAnswer(ask, decision)
		if err != nil {
			return museAnswer{}, err
		}
	}
	ask.Answered = true
	if ask.DecidedBy == nil {
		ask.DecidedBy = map[string]bool{}
	}
	ask.DecidedBy[answer.params["commandId"].(string)] = true
	return answer, nil
}
