/** operation/hybridflow-store wire contracts. */

export interface BoardSummary {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    archived: boolean;
}

export interface SettingsDto {

    agent?: string;
    /** Legacy engine model; read-only. */
    model?: string;
    effort?: string;
    permission?: string;
    folder?: string;

    runner?: string;
    /** Preserve unknown settings from newer instances without interpreting them. */
    extra?: Record<string, string>;
}

export interface SuccessDto {
    flowNode?: string;
    /** Ordered branches, for Gateways only. */
    flowNodes?: string[];
    mode?: string;

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
    valueType?: string;
    outputType?: string;
    body?: string;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    spot?: SpotDto;
    status: string;
    /** Hides the card everywhere without deleting it. */
    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
    run?: string;

    classVersion?: ClassRefDto;
    workflow?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    output?: unknown;
}

export interface ClassVersionDto {
    id: string;
    number: number;
    body?: string;
    criteria?: CriterionDto[];

    template?: boolean;
    /** Managed agent id; AI versions only. */
    agent?: string;
    /** draft or published; only drafts are editable. */
    status: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

/** Reusable card; body and criteria belong to its versions. */
export interface FlowNodeClassDto {
    id: string;
    title: string;

    instantiable?: boolean;
    type: string;
    tags?: string[];
    at?: string;

    duration?: string;
    spot?: SpotDto;
    /** Successor class (never a version or node), plus AI instance chat handling. */
    onSuccess?: SuccessDto;
    /** AI-only tool permission mode. */
    permission?: string;
    /** AI-only runner id; absent means wherever Play is pressed. */
    runner?: string;
    note?: string;
    versions: ClassVersionDto[];
    workflowClass?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface NewFlowNodeClassDto {
    id?: string;
    title: string;

    instantiable?: boolean;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;
    /** First version's default agent; AI only. */
    agent?: string;
    at?: string;

    duration?: string;
    spot?: SpotDto;
    permission?: string;
    runner?: string;
    note?: string;
    onSuccess?: SuccessDto;

    published?: boolean;

    workflowClass?: string;
}

/** Updates supplied class fields only; body changes require a new version. */
export interface FlowNodeClassPatchDto {
    title?: string;
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    at?: string;

    duration?: string;
    onSuccess?: SuccessDto;
    permission?: string;
    runner?: string;
    note?: string;
    spot?: SpotDto;
    clearSpot?: boolean;
    workflowClass?: string;
}

export interface NewClassVersionDto {
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;

    agent?: string;
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
    flowNodes?: string[];
}

export interface WorkflowPatchDto {
    name?: string;
}

export interface NewWorkflowClassDto {
    id?: string;
    name?: string;
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
    /** Read sequence; send as since to watch without a gap after this snapshot. */
    cursor: number;
}

export interface FlowNodePatchDto {
    title?: string;
    note?: string;
    value?: unknown;
    valueType?: string;
    outputType?: string;
    output?: unknown;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: CriterionDto[];
    complexity?: number;
    clearComplexity?: boolean;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    status?: string;
    /** Flip the boolean hide without deleting the card. */
    archived?: boolean;
    onSuccess?: SuccessDto;
    chat?: string;
    spot?: SpotDto;
    clearSpot?: boolean;
    classVersion?: string;
    workflow?: string;
}

/** The service honours client-minted ids for optimistic creation and pasted chains. */
export interface NewFlowNodeDto {
    id?: string;
    title: string;
    type?: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    valueType?: string;
    outputType?: string;
    body?: string;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    spot?: SpotDto;
    status?: string;

    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
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
    actor?: string;
    revision?: number;
}

/** Named by settings. agent using its id. */
export interface AgentDto {
	archived?: boolean;
	published?: AgentVersionDto;
    id: string;
    name: string;
    harness: string;
    model?: string;
    profileId?: string;
    /** Selection guidance for tasks, never sent to the agent's turns. */
    description?: string;
    instructions?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface AgentVersionDto {
    agentId: string;
    version: number;
    name: string;
    harness: string;
    model: string;
    profileId?: string;
    description?: string;
    instructions?: string;
    publishedAt: string;
}

/** Agent id is generated server-side. */
export interface NewAgentDto {
    name: string;
    harness: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

export interface AgentPatchDto {
    archived?: boolean;
    name?: string;
    harness?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

/** settings. runner references the runner id. */
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
 * Summed AI usage reports.
 * Cache and reasoning tokens are subsets of input/output, never additional spend.
 */
export interface FlowNodeUsageTotalsDto {
    reports: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    costUsdMicros?: number;
}

export interface ChangesDto {
    changes: ChangeDto[];
    cursor: number;
    more: boolean;
}

export interface SchemaValueDto {
    id: string;
    title: string;
    value: unknown;
    boardSlug: string;
    boardName: string;
}
