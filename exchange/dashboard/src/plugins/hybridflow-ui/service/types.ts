/**
 * `operation/hybridflow-store` wire contracts. Card fields are read unchanged by
 * `boardContent.ts`. Revisions are sent in `If-Match` for conditional writes;
 * patch DTOs update only supplied fields. Cursors resume the change feed.
 */

export interface BoardSummary {
    id: string;
    name: string;
    /** Stable URL handle, retained across renames. */
    slug: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    archived: boolean;
}

export interface SettingsDto {
    /** Managed agent id, or a legacy engine name. */
    agent?: string;
    /** Legacy engine model; read-only. */
    model?: string;
    effort?: string;
    permission?: string;
    folder?: string;
    /** Runner id; absent means wherever Play is pressed. */
    runner?: string;
    /** Preserve unknown settings from newer instances without interpreting them. */
    extra?: Record<string, string>;
}

export interface SuccessDto {
    flowNode?: string;
    /** Ordered branches, for Gateways only. */
    flowNodes?: string[];
    mode?: string;
    /** Compact the chat on success; absent means false. */
    compact?: boolean;
}

export interface SpotDto {
    x: number;
    y: number;
}

export interface CriterionDto {
    id: string;
    text: string;
}

export interface FlowNodeDto {
    id: string;
    title: string;
    type: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    body?: string;
    /** Sent with the prompt whenever present. */
    criteria?: CriterionDto[];
    /** Fibonacci estimate; absent means none. */
    complexity?: number;
    settings?: SettingsDto;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: SpotDto;
    status: string;
    /** Hides the card everywhere without deleting it. Absent is false. */
    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
    /** Run holding the card; absent when free. */
    run?: string;
    /** Source class version; absent for manually created nodes. */
    classVersion?: ClassRefDto;
    workflow?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface ClassVersionDto {
    id: string;
    number: number;
    body?: string;
    criteria?: CriterionDto[];
    /** Instantiate the body as a template instead of copying it. */
    template?: boolean;
    /** Managed agent id; AI versions only. Absent means none. */
    agent?: string;
    /** `draft` or `published`; only drafts are editable. */
    status: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** Reusable card; body and criteria belong to its versions. */
export interface FlowNodeClassDto {
    id: string;
    title: string;
    /** Offered in the Instantiate menu; absent means off. */
    instantiable?: boolean;
    type: string;
    tags?: string[];
    /** Scheduler preset datetime. */
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: SpotDto;
    /** Successor class (never a version or node), plus AI instance chat handling. */
    onSuccess?: SuccessDto;
    /** AI-only tool permission mode. */
    permission?: string;
    /** AI-only runner id; absent means wherever Play is pressed. */
    runner?: string;
    /** Editor note, supported for every class type. */
    note?: string;
    /** Oldest first. */
    versions: ClassVersionDto[];
    workflowClass?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface NewFlowNodeClassDto {
    id?: string;
    title: string;
    /** Offered in the Instantiate menu; absent means off. */
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;
    /** First version's default agent; AI only. */
    agent?: string;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: SpotDto;
    permission?: string;
    runner?: string;
    note?: string;
    onSuccess?: SuccessDto;
    /** Freeze the first version at creation, as for task-to-class conversion. */
    published?: boolean;
    /** Workflow class on this board; absent means none. */
    workflowClass?: string;
}

/** Updates supplied class fields only; body changes require a new version. */
export interface FlowNodeClassPatchDto {
    title?: string;
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    onSuccess?: SuccessDto;
    permission?: string;
    runner?: string;
    note?: string;
    spot?: SpotDto;
    /** Remove placement; omitting `spot` leaves it unchanged. */
    clearSpot?: boolean;
    /** Workflow class id; `''` removes membership. */
    workflowClass?: string;
}

export interface NewClassVersionDto {
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;
    /** Default agent; copied versions inherit the source value. */
    agent?: string;
    /** Source version to copy. */
    from?: string;
}

export interface ClassVersionPatchDto {
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;
    agent?: string;
    status?: string;
}

/** Instantiated body overrides keyed by class id, replacing version bodies. */
export type InstantiateBodies = Record<string, string>;

export interface ClassRefDto {
    classId: string;
    classTitle: string;
    versionId: string;
    versionNumber: number;
}

export interface ListedClassDto extends FlowNodeClassDto {
    /** Menu grouping board. */
    boardSlug: string;
    boardName: string;
}

export interface ListedWorkflowClassDto extends WorkflowClassDto {
    boardSlug: string;
    boardName: string;
}

export interface InstantiateWorkflowResult {
    workflow: WorkflowDto;
    flowNodes: FlowNodeDto[];
}

/** Workflow membership is stored on the member cards. */
export interface WorkflowDto {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface WorkflowClassDto {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface NewWorkflowDto {
    id?: string;
    name?: string;
    /** Member flow node ids from this board. */
    flowNodes?: string[];
}

export interface WorkflowPatchDto {
    name?: string;
}

export interface NewWorkflowClassDto {
    id?: string;
    name?: string;
    /** Member node class ids from this board. */
    classes?: string[];
}

export interface WorkflowClassPatchDto {
    name?: string;
}

export interface BoardDetailDto {
    board: BoardSummary;
    flowNodes: FlowNodeDto[];
    flowNodeClasses: FlowNodeClassDto[];
    workflows: WorkflowDto[];
    workflowClasses: WorkflowClassDto[];
    /** Read sequence; send as `since` to watch without a gap after this snapshot. */
    cursor: number;
}

export interface FlowNodePatchDto {
    title?: string;
    note?: string;
    value?: unknown;
    type?: string;
    tags?: string[];
    body?: string;
    /** Replaces the entire criteria list. */
    criteria?: CriterionDto[];
    complexity?: number;
    /** Remove complexity; omitting `complexity` leaves it unchanged. */
    clearComplexity?: boolean;
    settings?: SettingsDto;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    status?: string;
    /** Flip the boolean hide without deleting the card. */
    archived?: boolean;
    onSuccess?: SuccessDto;
    chat?: string;
    spot?: SpotDto;
    /** Remove placement; omitting `spot` leaves it unchanged. */
    clearSpot?: boolean;
    /** Class version id; `''` breaks the link. */
    classVersion?: string;
    /** Workflow id; `''` removes membership. */
    workflow?: string;
}

/**
 * The service honours client-minted ids for optimistic creation and pasted chains.
 * Omit `id` to generate it server-side.
 */
export interface NewFlowNodeDto {
    id?: string;
    title: string;
    type?: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    body?: string;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;
    /** Positive scheduler wait from play, such as 30s, 15m or 1h30m; alternative to at. */
    duration?: string;
    spot?: SpotDto;
    status?: string;
    /** Create the card hidden. Ordinary creates leave it absent. */
    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
    /** Workflow on this board; absent means none. */
    workflow?: string;
}

export interface ChangeDto {
    seq: number;
    at: string;
    scope: 'board' | 'flowNode' | 'flowNodeClass' | 'workflow' | 'workflowClass' | 'agent' | 'runner';
    kind: 'created' | 'updated' | 'deleted';
    board?: string;
    flowNode?: string;
    flowNodeClass?: string;
    agent?: string;
    runner?: string;
    workflow?: string;
    workflowClass?: string;
    /** Display attribution: person or run. */
    actor?: string;
    revision?: number;
}

/**
 * Named by `settings.agent` using its id. Effort, permission and folder remain
 * per-node settings rather than part of the managed agent.
 */
export interface AgentDto {
	archived?: boolean;
	published?: AgentVersionDto;
    id: string;
    name: string;
    /** Engine: claude, codex, muse or opencode. */
    platform: string;
    /** Absent uses the CLI default. */
    model?: string;
    profileId?: string;
    /** Selection guidance for tasks, never sent to the agent's turns. */
    description?: string;
    /** Standing instructions supplied alongside the prompt. */
    instructions?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface AgentVersionDto {
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

/** Agent id is generated server-side. */
export interface NewAgentDto {
    name: string;
    platform: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

export interface AgentPatchDto {
    archived?: boolean;
    name?: string;
    platform?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

/**
 * `settings.runner` references the runner id. Pinned tasks are refused elsewhere;
 * unpinned tasks run wherever Play is pressed.
 */
export interface RunnerDto {
    id: string;
    name: string;
    /** Last heartbeat; absent if never seen. */
    lastSeen?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** Runner id is generated server-side. */
export interface NewRunnerDto {
    name: string;
}

export interface RunnerPatchDto {
    name?: string;
}

/**
 * Summed AI usage reports. Cache and reasoning tokens are subsets of input/output,
 * never additional spend. Absent cost means unknown, not zero.
 */
export interface FlowNodeUsageTotalsDto {
    reports: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    /** Millionths of a dollar; absent means unknown. */
    costUsdMicros?: number;
}

export interface ChangesDto {
    changes: ChangeDto[];
    /** Send as `since` on the next request. */
    cursor: number;
    /** Truncated page; request the next immediately. */
    more: boolean;
}
