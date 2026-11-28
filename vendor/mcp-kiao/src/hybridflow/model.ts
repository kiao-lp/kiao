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
    /** DCMS link or context expression locating the task's working folder. */
    folder?: string;
    /** Which runner plays the task — a runner's id, or absent for wherever a Play is pressed. */
    runner?: string;
    extra?: Record<string, string>;
}

/** The card played next, and what becomes of the chat the card ran in. */
export interface BoardSuccess {
    /** Next card on the same board, for tasks and Schedulers. Empty when nothing follows. */
    flowNode?: string;
    /** Linked branches of a gateway. */
    flowNodes?: string[];
    /** Who gets the conversation: `end` (the default) or `continue`. */
    mode?: string;
    /** Whether the chat is shortened when the card ends well. Absent is false. */
    compact?: boolean;
}

export interface BoardGatewayRoute {
    condition: string;
    flowNode: string;
}

/** One card, flat over the two rows the store keeps it on. */
export interface BoardFlowNode {
    id: string;
    title: string;
    type: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    /** Empty, "json-schema", or another schema value's id on the same board. */
    valueType?: string;
    roleId?: string;
    people?: string[];
    description?: string;
    /** Task output schema value id, from any board. Empty disables schema selection. */
    outputType?: string;
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: BoardCriterion[];
    complexity?: number;
    settings?: BoardSettings;
    /** A Scheduler's datetime, `YYYY-MM-DDTHH:mm`, no zone. */
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    remainingPasses?: number;
    spot?: BoardSpot;
    status: string;
    /** Hides the card everywhere without deleting it. Absent is false. */
    archived?: boolean;
    chat?: string;
    onSuccess?: BoardSuccess;
    routes?: BoardGatewayRoute[];
    /** The run holding the card, or empty when it is free. Read-only. */
    run?: string;
    /** The workflow the card is grouped in, or absent for none. */
    workflow?: string;
    createdAt: string;
    updatedAt: string;
    /** What to send back as `ifMatch` to make the next write conditional. */
    revision: number;
    /** Last successful structured export. Read-only. */
    output?: unknown;
}

/** A group of cards with shared runtime values. */
export interface BoardWorkflow {
    id: string;
    name: string;
    values?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** A whole board: its metadata, cards and workflows — and the cursor it was read at. */
export interface BoardWhole {
    board: Board;
    flowNodes: BoardFlowNode[];
    workflows: BoardWorkflow[];
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
    valueType?: string;
    roleId?: string;
    people?: string[];
    description?: string;
    outputType?: string;
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: NewBoardCriterion[];
    complexity?: number;
    settings?: BoardSettings;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    spot?: BoardSpot;
    status?: string;
    /** Create the card hidden. Ordinary creates leave it absent. */
    archived?: boolean;
    onSuccess?: BoardSuccess;
    routes?: BoardGatewayRoute[];
    /** The workflow the card is grouped in — one of this board — or absent for none. */
    workflow?: string;
}

/** The fields a patch changes — every one of them optional, and nothing else moves. */
export interface BoardFlowNodePatch {
    title?: string;
    note?: string;
    value?: unknown;
    valueType?: string;
    roleId?: string;
    people?: string[];
    description?: string;
    outputType?: string;
    type?: string;
    tags?: string[];
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: NewBoardCriterion[];
    complexity?: number;
    /** Takes the estimation off, which a complexity of nil cannot say. */
    clearComplexity?: boolean;
    settings?: BoardSettings;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    resetPasses?: boolean;
    status?: string;
    /** Flip the boolean hide without deleting the card. */
    archived?: boolean;
    onSuccess?: BoardSuccess;
    routes?: BoardGatewayRoute[];
    spot?: BoardSpot;
    /** Takes the card off the board, which a spot of nil cannot say. */
    clearSpot?: boolean;
    /** Binds the flow node to a class version, or breaks the link with the empty string. */
    /** Groups the card in the workflow it names — one of this board — or takes it out with "". */
    workflow?: string;
}

/** One workflow to file, with the cards it groups. */
export interface NewBoardWorkflow {
    id?: string;
    name?: string;
    /** The cards the workflow groups: flow nodes of this board, each moved into this one. */
    flowNodes?: string[];
}

/** The same portable JSON used by the Dashboard clipboard. */
export interface BoardWorkflowClipboard {
    kind: 'kiao-workflow';
    version: 1;
    workflow: { name: string; values?: Record<string, unknown> };
    flowNodes: (NewBoardFlowNode & { id: string })[];
}

export interface BoardWorkflowWithFlowNodes {
    workflow: BoardWorkflow;
    flowNodes: BoardFlowNode[];
}

/** What changes about a workflow: its name, which is all it has. */
export interface BoardWorkflowPatch {
    name?: string;
}

/** One managed agent: the named definition of what plays a flow node. */
export interface BoardAgent {
    effort?: string;
    version?: string;
    published?: BoardAgentVersion;
    id: string;
    /** What the flow node editor shows. Unique across the store, however it is cased. */
    name: string;
    /** The engine the agent runs on: `claude`, `codex`, `muse` or `pi`. */
    harness: string;
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
    effort?: string;
    repository?: string;
    commit?: string;
    tag?: string;
    lockDigest?: string;
    agentId: string;
    version: string;
    name: string;
    harness: string;
    model: string;
    profileId?: string;
    description?: string;
    instructions?: string;
    publishedAt: string;
}

export type AgentReleaseBump = 'major' | 'minor' | 'patch';

/** One agent to file. The id is minted by the service. */
export interface NewBoardAgent {
    repository?: string;
    effort?: string;
    name?: string;
    harness?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

/** What changes about an agent. */
export interface BoardAgentPatch {
    effort?: string;
    name?: string;
    harness?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

export interface AgentDeletionStatus {
    noRemote: boolean;
    dirty: boolean;
    unpushed: boolean;
    remoteUnavailable: boolean;
    confirmation: string;
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
    agent?: string;
    runner?: string;
    workflow?: string;
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

export interface BoardSchemaValue {
    id: string;
    title: string;
    value: unknown;
    boardSlug: string;
    boardName: string;
}
