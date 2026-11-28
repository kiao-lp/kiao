import type { AgentVersionDto } from '../agentic-resources/types';
import type { AgentSelection } from '../flowNodeSettings';
import type { RoleFields } from '../flowNodeRole';
/** operation/hybridflow-store wire contracts. */

export interface BoardSummary {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    archived: boolean;
    folderId?: string;
}

export interface FolderDto {
    id: string;
    name: string;
}

export interface SettingsDto extends AgentSelection {
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

export interface GatewayRoute {
    condition: string;
    flowNode: string;
}

export interface SpotDto {
    x: number;
    y: number;
}

/** Resized dimensions; an absent height keeps the card's natural one. */
export interface SizeDto {
    w: number;
    h?: number;
}

export interface CriterionDto {
    id: string;
    text: string;
}

export interface FlowNodeDto extends RoleFields {
    id: string;
    title: string;
    type: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    valueType?: string;
    outputType?: string;
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    remainingPasses?: number;
    spot?: SpotDto;
    size?: SizeDto;
    status: string;
    /** Marks the flow node as archived. */
    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
    routes?: GatewayRoute[];
    run?: string;

    workflow?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    output?: unknown;
}

export interface WorkflowWithFlowNodesDto {
    workflow: WorkflowDto;
    flowNodes: FlowNodeDto[];
}

/** Member flow nodes store the workflow ID. */
export interface WorkflowDto {
    id: string;
    name: string;
    values?: Record<string, unknown>;
    workflowFolder?: string;
    files?: string[];
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface NewWorkflowDto {
    id?: string;
    name?: string;
    flowNodes?: string[];
    workflowFolder?: string;
    files?: string[];
}

export interface WorkflowPatchDto {
    name?: string;
    setValues?: Record<string, unknown>;
    removeValues?: string[];
    workflowFolder?: string;
    files?: string[];
}

export interface BoardDetailDto {
    board: BoardSummary;
    flowNodes: FlowNodeDto[];
    workflows: WorkflowDto[];
    /** Read sequence; send as since to watch without a gap after this snapshot. */
    cursor: number;
}

export interface FlowNodePatchDto extends RoleFields {
    title?: string;
    note?: string;
    value?: unknown;
    valueType?: string;
    outputType?: string;
    output?: unknown;
    type?: string;
    tags?: string[];
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: CriterionDto[];
    complexity?: number;
    clearComplexity?: boolean;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    resetPasses?: boolean;
    status?: string;
    /** Set whether the flow node is archived. */
    archived?: boolean;
    onSuccess?: SuccessDto;
    routes?: GatewayRoute[];
    chat?: string;
    spot?: SpotDto;
    clearSpot?: boolean;
    size?: SizeDto;
    workflow?: string;
}

/** The service honours client-minted ids for optimistic creation and pasted chains. */
export interface NewFlowNodeDto extends RoleFields {
    id?: string;
    title: string;
    type?: string;
    tags?: string[];
    note?: string;
    value?: unknown;
    valueType?: string;
    outputType?: string;
    body?: string;
    multiPartTemplate?: boolean;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;

    duration?: string;
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
    maxPasses?: number;
    remainingPasses?: number;
    spot?: SpotDto;
    size?: SizeDto;
    status?: string;

    archived?: boolean;
    chat?: string;
    onSuccess?: SuccessDto;
    routes?: GatewayRoute[];
    workflow?: string;
}

export interface ChangeDto {
    seq: number;
    at: string;
    scope: 'board' | 'flowNode' | 'workflow' | 'agent' | 'runner';
    kind: 'created' | 'updated' | 'deleted';
    board?: string;
    flowNode?: string;
    agent?: string;
    runner?: string;
    workflow?: string;
    actor?: string;
    revision?: number;
}

export type { AgentDto, AgentVersionDto, NewAgentDto, AgentPatchDto } from '../agentic-resources/types';

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

export type { AgenticResourceDto, ResourceFileDto } from '../agentic-resources/types';

export interface TaskExecutionDto {
    id: string;
    conversationId: string;
    turnId: string;
    runnerId?: string;
    runId?: string;
    harness: string;
    model: string;
    effort: string;
    agent: AgentVersionDto;
    at: string;
}
