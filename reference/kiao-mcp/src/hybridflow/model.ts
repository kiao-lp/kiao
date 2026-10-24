// Wire types for the boards proxy (POST/GET /hybridflow-runner/boards… on worker), which forwards
// to the hybridflow-store verbatim. Canonical source: the store's DTOs in
// operation/hybridflow-store/adapters/httpapi/dto.go — the field names the board owns,
// so either side reads the same.

/** A board as a listing names it: what it is called, where it lives, nothing on it. */
export interface Board {
    id: string;
    name: string;
    /** The handle a URL carries — what the card tools take. A rename does not move it. */
    slug: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    archived: boolean;
}

/** What changes about a board: its name, whether it is put away. */
export interface BoardPatch {
    name?: string;
    archive?: boolean;
}

/** One success criterion: what the work is done when, under the id the editor gave it. */
export interface BoardCriterion {
    id: string;
    text: string;
}

/** One success criterion to write. The service mints the id where none is sent. */
export interface NewBoardCriterion {
    id?: string;
    text: string;
}

/** Where a card sits on the board, in pixels from the top left of the canvas. */
export interface BoardSpot {
    x: number;
    y: number;
}

/** What a turn is run with. A whole replacement: the set a form submits together. */
export interface BoardSettings {
    /** Which agent plays the card — a managed agent's id. */
    agent?: string;
    /** Read and never written: what a card from before managed agents says. */
    model?: string;
    effort?: string;
    permission?: string;
    /** The folder the turn runs in, as a link from the store root with a leading slash. */
    folder?: string;
    /** Which runner plays the task — a runner's id, or absent for wherever a Play is pressed. */
    runner?: string;
    extra?: Record<string, string>;
}

/** The card played next, and what becomes of the chat the card ran in. */
export interface BoardSuccess {
    /** Id of the card played next. Empty when nothing follows. Never on a shutdown or a gateway. */
    flowNode?: string;
    /** The cards a gateway starts when it fires. A gateway's alone. */
    flowNodes?: string[];
    /** Who gets the conversation: `end` (the default) or `continue`. */
    mode?: string;
    /** Whether the chat is shortened when the card ends well. Absent is false. */
    compact?: boolean;
}

/** What a flow node says about the class version it was made from. Read-only. */
export interface BoardClassRef {
    classId: string;
    classTitle: string;
    versionId: string;
    versionNumber: number;
}

/** One card, flat over the two rows the store keeps it on. */
export interface BoardFlowNode {
    id: string;
    title: string;
    type: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    body?: string;
    criteria?: BoardCriterion[];
    complexity?: number;
    settings?: BoardSettings;
    /** A Scheduler's datetime, `YYYY-MM-DDTHH:mm`, no zone. */
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: BoardSpot;
    status: string;
    /** Hides the card everywhere without deleting it. Absent is false. */
    archived?: boolean;
    chat?: string;
    onSuccess?: BoardSuccess;
    /** The run holding the card, or empty when it is free. Read-only. */
    run?: string;
    /** The class version the flow node was instantiated from. Read-only; patch `classVersion` to move it. */
    classVersion?: BoardClassRef;
    /** The workflow the card is grouped in, or absent for none. */
    workflow?: string;
    createdAt: string;
    updatedAt: string;
    /** What to send back as `ifMatch` to make the next write conditional. */
    revision: number;
}

/** One version of a node class: the words, under a successive number. */
export interface BoardClassVersion {
    id: string;
    number: number;
    body?: string;
    criteria?: BoardCriterion[];
    /** Whether the body is a template the instantiation fills in rather than copies. */
    template?: boolean;
    /** The default agent: a managed agent's id, or absent for none. */
    agent?: string;
    /** `draft` or `published`. Only a draft may be changed. */
    status: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** One node class: the reusable card, with its succession beneath it. */
export interface BoardFlowNodeClass {
    id: string;
    title: string;
    instantiable?: boolean;
    type: string;
    tags?: string[];
    /** A Scheduler's preset datetime, as the class writes it. */
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: BoardSpot;
    /** The class after this one — a class, never a version or a flow node. */
    onSuccess?: BoardSuccess;
    /** How an AI instance's turn answers its tool calls. Asked of an AI class alone. */
    permission?: string;
    /** Which runner plays an AI instance — a runner's id, or empty. Asked of an AI class alone. */
    runner?: string;
    /** What the class is for. Asked of every kind of class and copied to no instance. */
    note?: string;
    /** The workflow class the class is grouped in, or absent for none. */
    workflowClass?: string;
    /** The succession, oldest first. */
    versions: BoardClassVersion[];
    createdAt: string;
    updatedAt: string;
    /** The class's own revision — a version carries a revision of its own. */
    revision: number;
}

/** One class for the instantiate menu: the class and the board it is filed on. */
export interface BoardListedClass extends BoardFlowNodeClass {
    boardSlug: string;
    boardName: string;
}

/** One workflow: a name round a set of cards. */
export interface BoardWorkflow {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** One workflow class: a name round a set of node classes. */
export interface BoardWorkflowClass {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** One workflow class for the instantiate menu: the rectangle and the board it is filed on. */
export interface BoardListedWorkflowClass extends BoardWorkflowClass {
    boardSlug: string;
    boardName: string;
}

/** A whole board: its own row, its cards, its classes, its workflows — and the cursor it was read at. */
export interface BoardWhole {
    board: Board;
    flowNodes: BoardFlowNode[];
    flowNodeClasses: BoardFlowNodeClass[];
    workflows: BoardWorkflow[];
    workflowClasses: BoardWorkflowClass[];
    cursor: number;
}

/** One card to create. The service mints the id unless one is sent. */
export interface NewBoardFlowNode {
    id?: string;
    title?: string;
    type?: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    body?: string;
    criteria?: NewBoardCriterion[];
    complexity?: number;
    settings?: BoardSettings;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: BoardSpot;
    status?: string;
    /** Create the card hidden. Ordinary creates leave it absent. */
    archived?: boolean;
    onSuccess?: BoardSuccess;
    /** The workflow the card is grouped in — one of this board — or absent for none. */
    workflow?: string;
}

/** The fields a patch changes — every one of them optional, and nothing else moves. */
export interface BoardFlowNodePatch {
    title?: string;
    note?: string;
    value?: unknown;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: NewBoardCriterion[];
    complexity?: number;
    /** Takes the estimation off, which a complexity of nil cannot say. */
    clearComplexity?: boolean;
    settings?: BoardSettings;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    status?: string;
    /** Flip the boolean hide without deleting the card. */
    archived?: boolean;
    onSuccess?: BoardSuccess;
    spot?: BoardSpot;
    /** Takes the card off the board, which a spot of nil cannot say. */
    clearSpot?: boolean;
    /** Binds the flow node to a class version, or breaks the link with the empty string. */
    classVersion?: string;
    /** Groups the card in the workflow it names — one of this board — or takes it out with "". */
    workflow?: string;
}

/** One class to create, with its first version's words beside it. */
export interface NewBoardFlowNodeClass {
    id?: string;
    title: string;
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: NewBoardCriterion[];
    template?: boolean;
    /** The first version's default agent. Asked of an AI class's versions alone. */
    agent?: string;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: BoardSpot;
    permission?: string;
    runner?: string;
    note?: string;
    onSuccess?: BoardSuccess;
    /** Freezes the first version at creation. */
    published?: boolean;
    workflowClass?: string;
}

/** What changes about a class — its own fields, never its versions'. */
export interface BoardFlowNodeClassPatch {
    title?: string;
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    onSuccess?: BoardSuccess;
    permission?: string;
    runner?: string;
    note?: string;
    spot?: BoardSpot;
    clearSpot?: boolean;
    workflowClass?: string;
}

/** One version to be filed under its class. */
export interface NewBoardClassVersion {
    body?: string;
    criteria?: NewBoardCriterion[];
    template?: boolean;
    agent?: string;
    /** Names a version to copy the words from. Empty is a blank draft. */
    from?: string;
}

/** What changes about a draft: the words, the template box, the default agent, or publish it. */
export interface BoardClassVersionPatch {
    body?: string;
    criteria?: NewBoardCriterion[];
    template?: boolean;
    agent?: string;
    /** Publishing freezes the version; a published version is never drafted again. */
    status?: string;
}

/** What instantiating a class or a workflow class is asked: where the head lands, and what the
 * instantiated templates are asked instead of their version's body, by class id. */
export interface BoardInstantiateRequest {
    spot?: BoardSpot;
    bodies?: Record<string, string>;
}

/** One workflow to file, with the cards it groups. */
export interface NewBoardWorkflow {
    id?: string;
    name?: string;
    /** The cards the workflow groups: flow nodes of this board, each moved into this one. */
    flowNodes?: string[];
}

/** What changes about a workflow: its name, which is all it has. */
export interface BoardWorkflowPatch {
    name?: string;
}

/** One workflow class to file, with the classes it groups. */
export interface NewBoardWorkflowClass {
    id?: string;
    name?: string;
    /** The node classes the workflow class groups: classes of this board. */
    classes?: string[];
}

/** What changes about a workflow class: its name. */
export interface BoardWorkflowClassPatch {
    name?: string;
}

/** One managed agent: the named definition of what plays a flow node. */
export interface BoardAgent {
    archived?: boolean;
    published?: BoardAgentVersion;
    id: string;
    /** What the flow node editor shows. Unique across the store, however it is cased. */
    name: string;
    /** The engine the agent runs on: `claude`, `codex`, `muse` or `opencode`. */
    platform: string;
    /** The model the agent runs on, or empty for the CLI's own default. */
    model?: string;
    profileId?: string;
    /** Selection guidance for tasks, never sent to the agent's turns. */
    description?: string;
    /** Standing orders its turns are given, beside the prompt. */
    instructions?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface BoardAgentVersion {
    agentId: string;
    version: number;
    name: string;
    platform: string;
    model: string;
    profileId?: string;
    description?: string;
    instructions?: string;
    publishedAt: string;
}

/** One agent to file. The id is minted by the service. */
export interface NewBoardAgent {
    name: string;
    platform: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

/** What changes about an agent. */
export interface BoardAgentPatch {
    archived?: boolean;
    name?: string;
    platform?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

/** One runner: a machine that plays cards. */
export interface BoardRunner {
    id: string;
    name: string;
    /** When the runner last said it was alive, or absent for one that never has. */
    lastSeen?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** One runner to file. The id is minted by the service. */
export interface NewBoardRunner {
    name: string;
}

/** What changes about a runner. */
export interface BoardRunnerPatch {
    name?: string;
}

/** One thing that happened. */
export interface BoardChange {
    seq: number;
    at: string;
    scope: string;
    kind: string;
    board?: string;
    flowNode?: string;
    flowNodeClass?: string;
    agent?: string;
    runner?: string;
    workflow?: string;
    workflowClass?: string;
    actor?: string;
    revision?: number;
}

/** What the watch endpoint answers: what happened, and where the client now stands. */
export interface BoardChanges {
    changes: BoardChange[];
    /** What to send as `since` next time. */
    cursor: number;
    /** Whether the page was truncated — ask again at once. */
    more: boolean;
}

/** What one card spent, whole: the sums of its reports. */
export interface BoardUsageTotals {
    reports: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    /** Absent where no report priced itself — unknown, never zero. */
    costUsdMicros?: number;
}
