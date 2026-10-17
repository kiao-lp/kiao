// Package httpapi is the HTTP adapter: the core's services published as a JSON API.
//
// The DTOs are **the wire, and not the entities**. They are written out rather than shared with
// core/entities for the reason every hexagonal boundary is: the wire is a contract with clients
// that are deployed separately from this binary — Dashboard in a browser cache, worker on the
// same machine but built at another time — so a field renamed in the domain must be a deliberate
// act on the wire and not a consequence.
//
// The field names are camelCase, which is what `reference/npm/kiao-worker` types are written in and
// what every other DCMS payload uses.
package httpapi

import (
	"encoding/json"
	"time"

	"kiao/hybridflow-store/core/entities"
)

// BoardDto is a board in a listing: what it is called, where it lives, and nothing on it.
type BoardDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Slug is the handle a URL carries. `/dashboard/boards/<slug>` is the board's address.
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Revision  int64     `json:"revision"`
	Archived  bool      `json:"archived"`
}

func boardDto(board entities.Board) BoardDto {
	return BoardDto{
		ID: board.ID, Name: board.Name, Slug: board.Slug,
		CreatedAt: board.CreatedAt, UpdatedAt: board.UpdatedAt,
		Revision: board.Revision, Archived: board.Archived(),
	}
}

// SettingsDto is what a turn is run with.
type SettingsDto struct {
	Agent      string `json:"agent,omitempty"`
	Model      string `json:"model,omitempty"`
	Effort     string `json:"effort,omitempty"`
	Permission string `json:"permission,omitempty"`
	Folder     string `json:"folder,omitempty"`
	// Runner is which runner plays the task — a runner's id, or absent for wherever a Play is
	// pressed. A pin rather than a setting a turn is run with, but one the task says beside them.
	Runner string            `json:"runner,omitempty"`
	Extra  map[string]string `json:"extra,omitempty"`
}

// SuccessDto is the card played next, and what becomes of the chat the card ran in: who gets it,
// and whether it is shortened first.
type SuccessDto struct {
	FlowNode string `json:"flowNode,omitempty"`
	// FlowNodes are the cards a Gateway starts when it fires, in the order the card lists them.
	// A Gateway's alone, and absent on every other kind.
	FlowNodes []string `json:"flowNodes,omitempty"`
	Mode      string   `json:"mode,omitempty"`
	// Compact is absent for false, which is what every client that has never heard of it says.
	Compact bool `json:"compact,omitempty"`
}

// CriterionDto is one success criterion: what the work is done when, under the id the editor
// gave it.
type CriterionDto struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// SpotDto is where a card sits on the board.
type SpotDto struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// FlowNodeDto is one card, under the field names the board owns — `type`, `tags`, `body`,
// `settings`, `at`, `spot`, `status`, `chat`, `onSuccess`.
//
// **It stays flat over the two tables a card is.** `body`, `settings`, `chat` and half of
// `onSuccess` are the card's **task** — the half only an AI or a Human one has — and that split is
// this service's own: one card is one thing to edit, to play and to make a write conditional on, so
// it is one object here.
type FlowNodeDto struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Type  string   `json:"type"`
	Tags  []string `json:"tags,omitempty"`
	Body  string   `json:"body,omitempty"`
	// Criteria are what the work being done means, sent with the prompt whenever present.
	Criteria []CriterionDto `json:"criteria,omitempty"`
	// Complexity is the task's estimation in the Fibonacci suite, absent for none.
	Complexity *int         `json:"complexity,omitempty"`
	Settings   *SettingsDto `json:"settings,omitempty"`
	// At is a Scheduler's datetime, as the card writes it.
	At       string   `json:"at,omitempty"`
	Duration string   `json:"duration,omitempty"`
	Spot     *SpotDto `json:"spot,omitempty"`
	Status   string   `json:"status"`
	// Archived hides the card everywhere without deleting it. Absent is false,
	// which is what every client that has never heard of it says.
	Archived  bool        `json:"archived,omitempty"`
	Chat      string      `json:"chat,omitempty"`
	OnSuccess *SuccessDto `json:"onSuccess,omitempty"`
	// Run is the run holding the card, or empty when it is free. It is on the wire because a board
	// draws a spinner over a held card and a second client must not offer a Play on it.
	Run string `json:"run,omitempty"`
	// ClassVersion is the class version the flow node was instantiated from, or absent for a
	// flow node made by hand.
	ClassVersion *ClassRefDto `json:"classVersion,omitempty"`
	// Workflow is the workflow the card is grouped in, or absent for none.
	Workflow  string    `json:"workflow,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// Revision is what a client sends back in `If-Match` to make its next write conditional. A
	// client that sends none is saying "whatever it says now", which is what a run's status write
	// means and what a person's rename does not.
	Revision int64 `json:"revision"`
}

// flowNodeDto **flattens the task back into the card**, and that is what the wire is. One
// definition of what a card is, shared by a database, two services and a browser, in the board's
// own shape; a `task` object inside it would be a client rewrite for a split none of them have any
// use for — the editor edits one card, the runner plays one card, and the two rows are one card
// here too. Which fields live on which row is this service's business, and the wire is where that
// stops being anybody else's.
func flowNodeDto(flowNode entities.FlowNode) FlowNodeDto {
	dto := FlowNodeDto{
		ID: flowNode.ID, Title: flowNode.Title, Type: string(flowNode.Type),
		Tags: flowNode.Tags, At: flowNode.ScheduledAt, Duration: flowNode.Duration, Status: string(flowNode.Status),
		Archived:  flowNode.Archived,
		Run:       flowNode.RunID,
		Workflow:  flowNode.WorkflowID,
		CreatedAt: flowNode.CreatedAt, UpdatedAt: flowNode.UpdatedAt, Revision: flowNode.Revision,
	}
	transition := entities.Transition{Mode: entities.TransitionModeDefault}
	if task := flowNode.Task; task != nil {
		dto.Body, dto.Chat, transition = task.Body, task.ConversationID, task.Transition
		dto.Criteria = criteriaDto(task.Criteria)
		dto.Complexity = task.Complexity
		if !task.Settings.Empty() {
			dto.Settings = &SettingsDto{
				Agent: task.Settings.Agent, Model: task.Settings.Model, Effort: task.Settings.Effort,
				Permission: task.Settings.Permission, Folder: task.Settings.Folder,
				Runner: task.Settings.Runner, Extra: task.Settings.Extra,
			}
		}
	}
	if flowNode.Spot != nil {
		dto.Spot = &SpotDto{X: flowNode.Spot.X, Y: flowNode.Spot.Y}
	}
	if flowNode.Next != "" || len(flowNode.Nexts) > 0 ||
		transition.Mode != entities.TransitionModeDefault || transition.Compact {
		dto.OnSuccess = &SuccessDto{
			FlowNode: flowNode.Next, FlowNodes: flowNode.Nexts,
			Mode: string(transition.Mode), Compact: transition.Compact,
		}
	}
	if ref := flowNode.ClassRef; ref != nil {
		dto.ClassVersion = &ClassRefDto{
			ClassID: ref.ClassID, ClassTitle: ref.ClassTitle,
			VersionID: ref.VersionID, VersionNumber: ref.VersionNumber,
		}
	}
	return dto
}

// ClassVersionDto is one version of a node class: the words, under a successive number.
type ClassVersionDto struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Body   string `json:"body,omitempty"`
	// Criteria are what done means for an instance made from this version.
	Criteria []CriterionDto `json:"criteria,omitempty"`
	// Template is whether the body is a template: one the instantiation fills in rather than
	// copies. Absent is a description, which is what every client that has never heard of it says.
	Template bool `json:"template,omitempty"`
	// Agent is the default agent: the managed agent an instance made from this version is
	// played by at first. Absent is none — and every version of a class that is no AI one.
	Agent string `json:"agent,omitempty"`
	// Status is draft or published. Only a draft may be changed; only the latest version that
	// is not a draft is used when the class is instantiated.
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Revision  int64     `json:"revision"`
}

func classVersionDto(version entities.FlowNodeClassVersion) ClassVersionDto {
	return ClassVersionDto{
		ID: version.ID, Number: version.Number, Body: version.Body,
		Criteria: criteriaDto(version.Criteria), Template: version.IsTemplate, Agent: version.Agent,
		Status:    string(version.Status),
		CreatedAt: version.CreatedAt, UpdatedAt: version.UpdatedAt, Revision: version.Revision,
	}
}

// FlowNodeClassDto is one node class: the reusable card, with its succession beneath it. The
// shape echoes the flow node's own — `type`, `tags`, `at`, `spot`, `onSuccess` — because the
// editor draws one beside the other; what it never carries is what a class is never asked: no
// folder, no effort, no chat, no body and no success criteria of its own.
type FlowNodeClassDto struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Instantiable is whether the class is offered in the Instantiate menu. Absent is off.
	Instantiable bool     `json:"instantiable,omitempty"`
	Type         string   `json:"type"`
	Tags         []string `json:"tags,omitempty"`
	// At is a Scheduler's preset datetime, as the class writes it.
	At       string   `json:"at,omitempty"`
	Duration string   `json:"duration,omitempty"`
	Spot     *SpotDto `json:"spot,omitempty"`
	// OnSuccess names the class after this one — a class, never a version or a simple flow
	// node — and, on an AI class, what becomes of an instance's chat.
	OnSuccess *SuccessDto `json:"onSuccess,omitempty"`
	// Permission and Runner are how an AI instance's turn answers its tool calls and where it
	// is pinned. Asked of an AI class and of no other kind.
	Permission string `json:"permission,omitempty"`
	Runner     string `json:"runner,omitempty"`
	// Note is what the class editor keeps beside the reusable card. Asked of every kind of
	// class and copied to no instance.
	Note string `json:"note,omitempty"`
	// WorkflowClass is the workflow class the class is grouped in, or absent for none.
	WorkflowClass string `json:"workflowClass,omitempty"`
	// Versions are the succession, oldest first.
	Versions  []ClassVersionDto `json:"versions"`
	CreatedAt time.Time         `json:"createdAt"`
	UpdatedAt time.Time         `json:"updatedAt"`
	// Revision is what a client sends back in `If-Match` to make its next write conditional —
	// the class's own, not its versions': a version carries a revision of its own.
	Revision int64 `json:"revision"`
}

func flowNodeClassDto(class entities.FlowNodeClass, versions []entities.FlowNodeClassVersion) FlowNodeClassDto {
	dto := FlowNodeClassDto{
		ID: class.ID, Title: class.Title, Instantiable: class.Instantiable,
		Type: string(class.Type),
		Tags: class.Tags, At: class.ScheduledAt, Duration: class.Duration,
		Permission: class.Permission, Runner: class.Runner, Note: class.Note,
		WorkflowClass: class.WorkflowClassID,
		Versions:      []ClassVersionDto{},
		CreatedAt:     class.CreatedAt, UpdatedAt: class.UpdatedAt, Revision: class.Revision,
	}
	for _, version := range versions {
		dto.Versions = append(dto.Versions, classVersionDto(version))
	}
	if class.Spot != nil {
		dto.Spot = &SpotDto{X: class.Spot.X, Y: class.Spot.Y}
	}
	if class.Next != "" || class.Transition.Mode != entities.TransitionModeDefault || class.Transition.Compact {
		dto.OnSuccess = &SuccessDto{
			FlowNode: class.Next, Mode: string(class.Transition.Mode), Compact: class.Transition.Compact,
		}
	}
	return dto
}

// ListedClassDto is one class for the instantiate menu: the class and the board it is filed on.
type ListedClassDto struct {
	FlowNodeClassDto
	// BoardSlug and BoardName name the board the class is filed on: the menu groups by them.
	BoardSlug string `json:"boardSlug"`
	BoardName string `json:"boardName"`
}

// ListedWorkflowClassDto is one workflow class for the instantiate menu: the rectangle and
// the board it is filed on.
type ListedWorkflowClassDto struct {
	WorkflowClassDto
	// BoardSlug and BoardName name the board the workflow class is filed on.
	BoardSlug string `json:"boardSlug"`
	BoardName string `json:"boardName"`
}

// ClassRefDto is what a flow node says about the class version it was made from: the class and
// the version, resolved at the read.
type ClassRefDto struct {
	ClassID       string `json:"classId"`
	ClassTitle    string `json:"classTitle"`
	VersionID     string `json:"versionId"`
	VersionNumber int    `json:"versionNumber"`
}

// BoardDetailDto is a whole board: the board's own row, its cards and its classes. One call,
// because a board is drawn all at once.
type BoardDetailDto struct {
	Board     BoardDto      `json:"board"`
	FlowNodes []FlowNodeDto `json:"flowNodes"`
	// FlowNodeClasses are the board's node classes, beside its cards.
	FlowNodeClasses []FlowNodeClassDto `json:"flowNodeClasses"`
	// Workflows are the board's workflows: the names round the sets of cards.
	Workflows []WorkflowDto `json:"workflows"`
	// WorkflowClasses are the board's workflow classes: the names round the sets of classes.
	WorkflowClasses []WorkflowClassDto `json:"workflowClasses"`
	// Cursor is the change-log sequence number this board was read at. A client holds it and asks
	// `GET /changes?since=<cursor>` — so there is no window between the read and the watch in which
	// a change could be missed.
	Cursor int64 `json:"cursor"`
}

// NewBoardRequestDto creates a board.
type NewBoardRequestDto struct {
	Name string `json:"name"`
}

// BoardPatchDto changes the board itself.
type BoardPatchDto struct {
	Name    *string `json:"name,omitempty"`
	Archive *bool   `json:"archive,omitempty"`
}

// criteriaDto is the criteria a task holds, as the wire carries them: the pair the editor
// added, in the order the task holds them. Empty is absent, which is what every client that has
// never heard of them says.
func criteriaDto(criteria []entities.SuccessCriterion) []CriterionDto {
	out := make([]CriterionDto, 0, len(criteria))
	for _, criterion := range criteria {
		out = append(out, CriterionDto{ID: criterion.ID, Text: criterion.Text})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// criteriaOf reads the criteria a request describes. Minting a missing id is the service's, so
// what arrives here is carried as said.
func criteriaOf(dtos []CriterionDto) []entities.SuccessCriterion {
	out := make([]entities.SuccessCriterion, 0, len(dtos))
	for _, dto := range dtos {
		out = append(out, entities.SuccessCriterion{ID: dto.ID, Text: dto.Text})
	}
	return out
}

// NewFlowNodeDto is one card to create. `id` is the identity the client minted, and it is honoured:
// the editor makes a card in the browser so that it is drawn the instant it is typed, and pasted
// cards keep the chains among them. Absent, one is minted here.
type NewFlowNodeDto struct {
	ID         string         `json:"id,omitempty"`
	Title      string         `json:"title"`
	Type       string         `json:"type,omitempty"`
	Tags       []string       `json:"tags,omitempty"`
	Body       string         `json:"body,omitempty"`
	Criteria   []CriterionDto `json:"criteria,omitempty"`
	Complexity *int           `json:"complexity,omitempty"`
	Settings   *SettingsDto   `json:"settings,omitempty"`
	At         string         `json:"at,omitempty"`
	Duration   string         `json:"duration,omitempty"`
	Spot       *SpotDto       `json:"spot,omitempty"`
	Status     string         `json:"status,omitempty"`
	Archived   bool           `json:"archived,omitempty"`
	Chat       string         `json:"chat,omitempty"`
	// OnSuccess may name a card that is being created in the same call — which a pasted chain is —
	// so it is applied after every card in the request exists.
	OnSuccess *SuccessDto `json:"onSuccess,omitempty"`
	// Workflow is the workflow the card is grouped in — one of this board — or absent for
	// none. What a card made inside a rectangle says.
	Workflow string `json:"workflow,omitempty"`
}

// NewFlowNodesRequestDto creates cards. Several because a paste of six cards is one gesture.
type NewFlowNodesRequestDto struct {
	FlowNodes []NewFlowNodeDto `json:"flowNodes"`
}

// FlowNodePatchDto changes the fields it names and no others — which is the whole concurrency story
// on the wire. A run sends `{"status": "done"}`; the person typing sends `{"title": "…"}`.
//
// The field that can be *cleared* needs saying twice, because JSON has no way to tell an absent
// key from one set to nothing once null is taken: `clearSpot` takes a card off the board's face.
type FlowNodePatchDto struct {
	Title    *string         `json:"title,omitempty"`
	Type     *string         `json:"type,omitempty"`
	Tags     *[]string       `json:"tags,omitempty"`
	Body     *string         `json:"body,omitempty"`
	Criteria *[]CriterionDto `json:"criteria,omitempty"`
	// Complexity replaces the task's estimation; ClearComplexity takes it off, which a
	// Complexity of nil cannot say.
	Complexity      *int         `json:"complexity,omitempty"`
	ClearComplexity bool         `json:"clearComplexity,omitempty"`
	Settings        *SettingsDto `json:"settings,omitempty"`
	At              *string      `json:"at,omitempty"`
	Duration        *string      `json:"duration,omitempty"`
	Status          *string      `json:"status,omitempty"`
	Archived        *bool        `json:"archived,omitempty"`
	OnSuccess       *SuccessDto  `json:"onSuccess,omitempty"`
	Chat            *string      `json:"chat,omitempty"`
	Spot            *SpotDto     `json:"spot,omitempty"`
	ClearSpot       bool         `json:"clearSpot,omitempty"`
	// ClassVersion binds the flow node to a class version, or breaks the link with the empty
	// string.
	ClassVersion *string `json:"classVersion,omitempty"`
	// Workflow groups the flow node in the workflow it names — one of this board — or takes
	// it out with the empty string.
	Workflow *string `json:"workflow,omitempty"`
}

// NewFlowNodeClassDto is one class to create, with its first version's words beside it. `id`
// is honoured like a card's.
type NewFlowNodeClassDto struct {
	ID    string `json:"id,omitempty"`
	Title string `json:"title"`
	// Instantiable offers the class in the Instantiate menu. Absent is off.
	Instantiable bool           `json:"instantiable,omitempty"`
	Type         string         `json:"type,omitempty"`
	Tags         []string       `json:"tags,omitempty"`
	Body         string         `json:"body,omitempty"`
	Criteria     []CriterionDto `json:"criteria,omitempty"`
	Template     bool           `json:"template,omitempty"`
	// Agent is the first version's default agent. Asked of an AI class's versions and of no
	// other kind.
	Agent      string   `json:"agent,omitempty"`
	At         string   `json:"at,omitempty"`
	Duration   string   `json:"duration,omitempty"`
	Spot       *SpotDto `json:"spot,omitempty"`
	Permission string   `json:"permission,omitempty"`
	Runner     string   `json:"runner,omitempty"`
	Note       string   `json:"note,omitempty"`
	// OnSuccess names the class after this one — a class, never a version or a simple flow
	// node — and, on an AI class, what becomes of an instance's chat.
	OnSuccess *SuccessDto `json:"onSuccess,omitempty"`
	// Published freezes the first version at creation, which is what a class converted from a
	// written task says.
	Published bool `json:"published,omitempty"`
	// WorkflowClass is the workflow class the class is grouped in — one of this board — or
	// absent for none. What a class made inside a rectangle says.
	WorkflowClass string `json:"workflowClass,omitempty"`
}

// FlowNodeClassPatchDto changes the fields it names and no others — the class's own fields,
// never its versions': a new description is a new version, not a patch.
type FlowNodeClassPatchDto struct {
	Title        *string     `json:"title,omitempty"`
	Instantiable *bool       `json:"instantiable,omitempty"`
	Type         *string     `json:"type,omitempty"`
	Tags         *[]string   `json:"tags,omitempty"`
	At           *string     `json:"at,omitempty"`
	Duration     *string     `json:"duration,omitempty"`
	OnSuccess    *SuccessDto `json:"onSuccess,omitempty"`
	Permission   *string     `json:"permission,omitempty"`
	Runner       *string     `json:"runner,omitempty"`
	Note         *string     `json:"note,omitempty"`
	Spot         *SpotDto    `json:"spot,omitempty"`
	ClearSpot    bool        `json:"clearSpot,omitempty"`
	// WorkflowClass groups the class in the workflow class it names — one of this board —
	// or takes it out with the empty string.
	WorkflowClass *string `json:"workflowClass,omitempty"`
}

// DeleteFlowNodeClassesRequestDto removes classes and their versions.
type DeleteFlowNodeClassesRequestDto struct {
	FlowNodeClasses []string `json:"flowNodeClasses"`
}

// WorkflowDto is one workflow: a name round a set of cards. The members say which one they
// are in — there is no list here, because the cards are the board's own to read.
type WorkflowDto struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Revision  int64     `json:"revision"`
}

func workflowDto(workflow entities.Workflow) WorkflowDto {
	return WorkflowDto{
		ID: workflow.ID, Name: workflow.Name,
		CreatedAt: workflow.CreatedAt, UpdatedAt: workflow.UpdatedAt, Revision: workflow.Revision,
	}
}

// WorkflowClassDto is one workflow class: a name round a set of node classes.
type WorkflowClassDto struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Revision  int64     `json:"revision"`
}

func workflowClassDto(workflow entities.WorkflowClass) WorkflowClassDto {
	return WorkflowClassDto{
		ID: workflow.ID, Name: workflow.Name,
		CreatedAt: workflow.CreatedAt, UpdatedAt: workflow.UpdatedAt, Revision: workflow.Revision,
	}
}

// NewWorkflowRequestDto files a workflow with the cards it groups. `id` is honoured like a
// card's: the editor draws the rectangle the instant it is made.
type NewWorkflowRequestDto struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
	// FlowNodes are the cards the workflow groups: flow nodes of this board, each moved into
	// this one.
	FlowNodes []string `json:"flowNodes,omitempty"`
}

// WorkflowPatchDto renames the workflow. Its members are untouched.
type WorkflowPatchDto struct {
	Name *string `json:"name,omitempty"`
}

// DeleteWorkflowsRequestDto removes workflows. Their cards are ungrouped and left where they
// are.
type DeleteWorkflowsRequestDto struct {
	Workflows []string `json:"workflows"`
}

// NewWorkflowClassRequestDto files a workflow class with the classes it groups.
type NewWorkflowClassRequestDto struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
	// Classes are the node classes the workflow class groups: classes of this board.
	Classes []string `json:"classes,omitempty"`
}

// WorkflowClassPatchDto renames the workflow class. Its members are untouched.
type WorkflowClassPatchDto struct {
	Name *string `json:"name,omitempty"`
}

// DeleteWorkflowClassesRequestDto removes workflow classes. Their classes are ungrouped and
// left where they are.
type DeleteWorkflowClassesRequestDto struct {
	WorkflowClasses []string `json:"workflowClasses"`
}

// NewClassVersionDto is one version to be filed under its class.
type NewClassVersionDto struct {
	Body string `json:"body,omitempty"`
	// Criteria are what done means for an instance made from this version.
	Criteria []CriterionDto `json:"criteria,omitempty"`
	// Template says the body's words are a template to fill in on instantiation. A version
	// copied from another starts as its source said, unless this says otherwise.
	Template *bool `json:"template,omitempty"`
	// Agent is the default agent. A version copied from another starts as its source said,
	// unless this names one. Asked of an AI class's versions and of no other kind.
	Agent string `json:"agent,omitempty"`
	// From names a version to copy the words from — the usual way a second version starts.
	// Empty is a blank draft.
	From string `json:"from,omitempty"`
}

// ClassVersionPatchDto changes what a draft says, whether it is a template, its default agent,
// or publishes it. A published version is refused whatever is sent.
type ClassVersionPatchDto struct {
	Body     *string         `json:"body,omitempty"`
	Criteria *[]CriterionDto `json:"criteria,omitempty"`
	Template *bool           `json:"template,omitempty"`
	Agent    *string         `json:"agent,omitempty"`
	Status   *string         `json:"status,omitempty"`
}

// InstantiateRequestDto instantiates a class onto a board: the class named and all its
// successors, each from its latest published version.
type InstantiateRequestDto struct {
	// Spot is where the head lands. The rest arrive unplaced, and the view lays them out.
	Spot *SpotDto `json:"spot,omitempty"`
	// Bodies names the instantiated templates, by class id: what the flow node of that class
	// is asked instead of its version's body. A class not named is asked its version's words,
	// and a class named that is not instantiated is passed over.
	Bodies map[string]string `json:"bodies,omitempty"`
}

// ChainRequestDto links a card to the one played after it; an empty target takes the link off.
// On a Gateway the target is added to its branches, and an empty one takes them all off.
type ChainRequestDto struct {
	FlowNode string `json:"flowNode"`
}

// DeleteFlowNodesRequestDto removes cards.
type DeleteFlowNodesRequestDto struct {
	FlowNodes []string `json:"flowNodes"`
}

// PlayRequestDto takes a card for a run.
type PlayRequestDto struct {
	Run string `json:"run"`
}

// PlayedRequestDto hands a card back with what the play ended on.
type PlayedRequestDto struct {
	Run    string `json:"run"`
	Status string `json:"status"`
}

// ChangeDto is one thing that happened.
type ChangeDto struct {
	Seq      int64     `json:"seq"`
	At       time.Time `json:"at"`
	Scope    string    `json:"scope"`
	Kind     string    `json:"kind"`
	Board    string    `json:"board,omitempty"`
	FlowNode string    `json:"flowNode,omitempty"`
	// FlowNodeClass is set for a change to a node class or one of its versions.
	FlowNodeClass string `json:"flowNodeClass,omitempty"`
	Agent         string `json:"agent,omitempty"`
	Runner        string `json:"runner,omitempty"`
	// Workflow is set for a change to a workflow, WorkflowClass for a change to a workflow
	// class.
	Workflow      string `json:"workflow,omitempty"`
	WorkflowClass string `json:"workflowClass,omitempty"`
	Actor         string `json:"actor,omitempty"`
	Revision      int64  `json:"revision,omitempty"`
}

// AgentDto is one managed agent: the named definition of what plays a flow node.
type AgentDto struct {
	ID string `json:"id"`
	// Name is what the flow node editor shows in its select and what the panel lists.
	Name string `json:"name"`
	// Platform is the engine the agent runs on: claude, codex, muse or opencode.
	Platform string `json:"platform"`
	// Model is the model the agent runs on, or empty for the CLI's own default.
	Model string `json:"model,omitempty"`
	// Description helps choose the agent for a task; it is never sent to its turns.
	Description string `json:"description,omitempty"`
	// Instructions are the standing orders the agent's turns are given, beside the prompt.
	Instructions string    `json:"instructions,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Revision     int64     `json:"revision"`
}

func agentDto(agent entities.Agent) AgentDto {
	return AgentDto{
		ID: agent.ID, Name: agent.Name, Platform: string(agent.Platform),
		Model: agent.Model, Instructions: agent.Instructions,
		Description: agent.Description,
		CreatedAt:   agent.CreatedAt, UpdatedAt: agent.UpdatedAt, Revision: agent.Revision,
	}
}

// NewAgentRequestDto files an agent. The id is minted by the service: nothing draws an agent
// before it exists, so unlike a card's it is never the client's to choose.
type NewAgentRequestDto struct {
	Name         string `json:"name"`
	Platform     string `json:"platform"`
	Model        string `json:"model,omitempty"`
	Description  string `json:"description,omitempty"`
	Instructions string `json:"instructions,omitempty"`
}

// AgentPatchDto changes the fields it names and no others.
type AgentPatchDto struct {
	Name         *string `json:"name,omitempty"`
	Platform     *string `json:"platform,omitempty"`
	Model        *string `json:"model,omitempty"`
	Description  *string `json:"description,omitempty"`
	Instructions *string `json:"instructions,omitempty"`
}

// RunnerDto is one runner: a machine that plays cards.
type RunnerDto struct {
	ID string `json:"id"`
	// Name is what the task editor shows in its select and what the panel lists.
	Name string `json:"name"`
	// LastSeen is when the runner last said it was alive, or absent for one that never has.
	LastSeen  *time.Time `json:"lastSeen,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	Revision  int64      `json:"revision"`
}

func runnerDto(runner entities.Runner) RunnerDto {
	return RunnerDto{
		ID: runner.ID, Name: runner.Name, LastSeen: runner.LastSeen,
		CreatedAt: runner.CreatedAt, UpdatedAt: runner.UpdatedAt, Revision: runner.Revision,
	}
}

// NewRunnerRequestDto files a runner. The id is minted by the service: nothing draws a runner
// before it exists, so unlike a card's it is never the client's to choose.
type NewRunnerRequestDto struct {
	Name string `json:"name"`
}

// RunnerPatchDto changes the fields it names and no others.
type RunnerPatchDto struct {
	Name *string `json:"name,omitempty"`
}

// ChangesDto is what the watch endpoint answers: what happened, and where the client now stands.
type ChangesDto struct {
	Changes []ChangeDto `json:"changes"`
	// Cursor is what to send as `since` next time. It is the latest the log holds and not the last
	// change in the page, so a client whose page was truncated knows to ask again at once.
	Cursor int64 `json:"cursor"`
	// More says the page was truncated.
	More bool `json:"more"`
}

// SettleRunResponseDto reports what a restart freed.
type SettleRunResponseDto struct {
	Settled int `json:"settled"`
}

// SchemaDto is the schema's history: every migration this database has run, in order. It is served
// because "which version is that instance on?" is a question asked of a running service, not of a
// binary somebody has to find first.
type SchemaDto struct {
	Version    int            `json:"version"`
	Migrations []MigrationDto `json:"migrations"`
}

// MigrationDto is one line of the ledger.
type MigrationDto struct {
	Version    int       `json:"version"`
	Name       string    `json:"name"`
	Checksum   string    `json:"checksum"`
	AppliedAt  time.Time `json:"appliedAt"`
	DurationMs int       `json:"durationMs"`
}

// RecordUsageRequestDto files what a turn — or a play — cost, on an AI card.
//
// The id is the reporter's to mint: a spool replay re-sends the same row, and the second
// insert lands on nothing. Empty is minted here, which a replay then cannot name again.
type RecordUsageRequestDto struct {
	ID               string          `json:"id,omitempty"`
	Run              string          `json:"run,omitempty"`
	Model            string          `json:"model,omitempty"`
	ReportedAt       *time.Time      `json:"reportedAt,omitempty"`
	InputTokens      int64           `json:"inputTokens,omitempty"`
	OutputTokens     int64           `json:"outputTokens,omitempty"`
	CacheReadTokens  int64           `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64           `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64           `json:"reasoningTokens,omitempty"`
	CostUsdMicros    *int64          `json:"costUsdMicros,omitempty"`
	Extra            json.RawMessage `json:"extra,omitempty"`
}

// TaskUsageDto is one filed report, as the store holds it.
type TaskUsageDto struct {
	ID               string          `json:"id"`
	Run              string          `json:"run,omitempty"`
	Model            string          `json:"model,omitempty"`
	ReportedAt       time.Time       `json:"reportedAt"`
	InputTokens      int64           `json:"inputTokens"`
	OutputTokens     int64           `json:"outputTokens"`
	CacheReadTokens  int64           `json:"cacheReadTokens"`
	CacheWriteTokens int64           `json:"cacheWriteTokens"`
	ReasoningTokens  int64           `json:"reasoningTokens"`
	CostUsdMicros    *int64          `json:"costUsdMicros,omitempty"`
	Extra            json.RawMessage `json:"extra,omitempty"`
}

func taskUsageDto(usage entities.TaskUsage) TaskUsageDto {
	return TaskUsageDto{
		ID: usage.ID, Run: usage.RunID, Model: usage.Model, ReportedAt: usage.ReportedAt,
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
		CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
		ReasoningTokens: usage.ReasoningTokens, CostUsdMicros: usage.CostUsdMicros,
		Extra: usage.Extra,
	}
}

// UsageTotalsDto is what one card spent, whole: the sums of its reports. The cost is absent
// where no report priced itself — unknown, never zero.
type UsageTotalsDto struct {
	Reports          int64  `json:"reports"`
	InputTokens      int64  `json:"inputTokens"`
	OutputTokens     int64  `json:"outputTokens"`
	CacheReadTokens  int64  `json:"cacheReadTokens"`
	CacheWriteTokens int64  `json:"cacheWriteTokens"`
	ReasoningTokens  int64  `json:"reasoningTokens"`
	CostUsdMicros    *int64 `json:"costUsdMicros,omitempty"`
}

func usageTotalsDto(totals entities.TaskUsageTotals) UsageTotalsDto {
	return UsageTotalsDto{
		Reports:     totals.Reports,
		InputTokens: totals.InputTokens, OutputTokens: totals.OutputTokens,
		CacheReadTokens: totals.CacheReadTokens, CacheWriteTokens: totals.CacheWriteTokens,
		ReasoningTokens: totals.ReasoningTokens, CostUsdMicros: totals.CostUsdMicros,
	}
}
