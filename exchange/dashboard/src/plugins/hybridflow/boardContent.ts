/** Board codec: tolerate hand-written, generated and pasted content on read; write only supported. */

import { hasSchedule, readSchedule, readDuration } from './flowNodeSchedule';
import { readRole, type RoleFields } from './flowNodeRole';
import { readBitbucketEvent, writeBitbucketEvent, type BitbucketEventFields } from './flowNodeBitbucket';
import { readLimiter } from './flowNodeLimiter';
import { predecessors } from './flowConnections';
import { isPlayable, noSettings, readSettings, FlowNodeSettings } from './flowNodeSettings';
import { readSpot, FlowNodeSpot, writeSpot } from './flowNodeSpot';
import { FlowNodeSize, readSize, writeSize } from './flowNodeSize';
import { readStatus, READY, FlowNodeStatus } from './flowNodeStatus';
import {
    noSuccess, readSuccess, saysSuccess, successFor, FlowNodeSuccess, writeSuccess,
} from './flowNodeSuccess';
import { isDisplay, readType, saysType, FlowNodeType } from './flowNodeType';
import { readRoutes } from './flowNodeRoutes';
import type { GatewayRoute } from './service/types';
import { readValueType } from './valueType';

/** Criterion IDs preserve editor identity across rewrites; only the text enters the prompt. */
export interface SuccessCriterion {
    id: string;
    text: string;
}

/** Ordered estimation choices, not measurements. */
export const COMPLEXITIES = [1, 2, 3, 5, 8, 13, 21] as const;

/** Optional task estimate; never included in the prompt. */
export type TaskComplexity = number | null;

export interface FlowNode extends BitbucketEventFields, RoleFields {
    id: string;
    title: string;

    type: FlowNodeType;
    note: string;
    value: unknown;
    valueType: string;
    outputType?: string;
    output?: unknown;
    routes?: GatewayRoute[];
    maxPasses?: number;
    remainingPasses?: number;

    tags: string[];

    body: string;
    multiPartTemplate: boolean;
    /** Task-only criteria, included in the prompt when present. */
    criteria: SuccessCriterion[];
    /** Task-only estimate. */
    complexity: TaskComplexity;
    /** AI uses all settings; Human uses only the folder; other types run no turn. */
    settings: FlowNodeSettings;
    at: string;

    duration?: string;
    spot: FlowNodeSpot | null;
    /** Resized dimensions; absent height keeps the natural one. */
    size: FlowNodeSize | null;
    status: FlowNodeStatus;
    /** Hidden everywhere without being deleted. */
    archived: boolean;

    chat: string;

    onSuccess: FlowNodeSuccess;

    workflow: string;
}

/** Members name their workflow; its bounds are computed from their positions. */
export interface Workflow {
    id: string;
    name: string;
    values?: Record<string, unknown>;
    workflowFolder?: string;
    files?: string[];
}

export const workflowFilesError = (workflow?: Workflow): string | undefined =>
    !!workflow?.workflowFolder !== !!workflow?.files?.length
        ? 'Invalid workflow. Set both a folder and at least one file or folder.'
        : undefined;

export interface BoardContent {
    flowNodes: FlowNode[];
    workflows: Workflow[];
}

/** UUIDs avoid collisions when pasting across instances. */
export const newId = (): string => crypto.randomUUID();

/** Infer AI from a named agent, otherwise Human. */
export const newFlowNode = (
    title: string,
    body = '',
    settings: FlowNodeSettings = {},
    onSuccess: FlowNodeSuccess = noSuccess(),
    criteria: SuccessCriterion[] = [],
    complexity: TaskComplexity = null,
): FlowNode => ({
    id: newId(), title: title.trim(), type: readType(undefined, settings), note: '', value: {}, valueType: '', tags: [], body,
    multiPartTemplate: false, criteria, complexity,
    settings, at: '', spot: null, size: null, status: READY, archived: false, chat: '', onSuccess,
    workflow: '',
});

export const newCriterion = (text = ''): SuccessCriterion => ({ id: newId(), text });

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Normalize whitespace and deduplicate case-insensitively, retaining first spelling and order. */
export const readTags = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const tags: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const label = entry.trim().replace(/\s+/g, ' ');
        if (!label || tags.some(held => held.toLowerCase() === label.toLowerCase())) continue;
        tags.push(label);
    }
    return tags;
};

/** Skip malformed or blank criteria; retain order and IDs for editing. */
export const readCriteria = (raw: unknown): SuccessCriterion[] => {
    const out: SuccessCriterion[] = [];
    for (const entry of list(raw)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const said = entry as Record<string, unknown>;
        const criterionText = typeof said.text === 'string' ? said.text.trim() : '';
        if (!criterionText) continue;
        out.push({
            id: typeof said.id === 'string' ? said.id.trim() : '',
            text: criterionText,
        });
    }
    return out;
};

export const readComplexity = (raw: unknown): TaskComplexity =>
    typeof raw === 'number' && (COMPLEXITIES as readonly number[]).includes(raw) ? raw : null;

const readFlowNode = (raw: unknown): FlowNode | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const settings = readSettings(source.settings);
    const type = readType(source.type, settings);
    const task = type === 'ai' || type === 'human';
    const onSuccess = successFor(readSuccess(source.onSuccess), type);
    return {
        id: text(source.id) || newId(),
        title: type === 'note' ? '' : text(source.title),
        type,
        note: type === 'note' ? text(source.note) : '',
        value: type === 'value' && source.value !== undefined ? source.value : {},
        valueType: type === 'value' ? readValueType(source.valueType) : '',
        ...(task && typeof source.outputType === 'string' ? { outputType: source.outputType.trim() } : {}),
        ...(Object.hasOwn(source, 'output') ? { output: source.output } : {}),
        tags: isDisplay(type) ? [] : readTags(source.tags),
        ...readRole(type, source),
        body: text(source.body),
        multiPartTemplate: task && source.multiPartTemplate === true,
        criteria: task ? readCriteria(source.criteria) : [],
        complexity: task ? readComplexity(source.complexity) : null,
        settings,
        at: readSchedule(source.at),
        ...(readDuration(source.duration) ? { duration: readDuration(source.duration) } : {}),
        ...readBitbucketEvent(type, source),
        ...(type === 'limiter' ? readLimiter(source) : {}),
        spot: readSpot(source.spot),
        size: readSize(source.size),
        status: readStatus(source.status),
        archived: (source as Record<string, unknown>).archived === true,
        chat: text(source.chat).trim(),

        onSuccess,
        ...(type === 'exclusive-gateway' ? { routes: readRoutes(source.routes, onSuccess.flowNodes) } : {}),
        workflow: text(source.workflow).trim(),
    };
};

const readFlowNodes = (raw: unknown): FlowNode[] =>
    list(raw).map(readFlowNode).filter((flowNode): flowNode is FlowNode => flowNode !== null);

const readWorkflow = (raw: unknown): Workflow | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const values = source.values;
    const workflowFolder = text(source.workflowFolder);
    const files = list(source.files).filter((file): file is string => typeof file === 'string' && file !== '');
    return {
        id: text(source.id) || newId(),
        name: text(source.name),
        ...(workflowFolder ? { workflowFolder } : {}),
        ...(files.length ? { files } : {}),
        ...(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length > 0
            ? { values: values as Record<string, unknown> }
            : {}),
    };
};

const readWorkflows = (raw: unknown): Workflow[] =>
    list(raw).map(readWorkflow).filter((workflow): workflow is Workflow => workflow !== null);

export const readBoardContent = (raw: unknown): BoardContent => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { flowNodes: [], workflows: [] };
    }
    const source = raw as Record<string, unknown>;
    return {
        flowNodes: readFlowNodes(source.flowNodes),
        workflows: readWorkflows(source.workflows),
    };
};

export const writeBoardContent = (content: BoardContent): unknown => ({
    flowNodes: content.flowNodes.map(writeFlowNode),
    ...(content.workflows.length
        ? { workflows: content.workflows.map(workflow => ({ ...workflow })) }
        : {}),
});

export const writeFlowNode = (flowNode: FlowNode): unknown => ({
    id: flowNode.id,
    title: flowNode.type === 'note' ? '' : flowNode.title,
    ...(saysType(flowNode.type) ? { type: flowNode.type } : {}),
    ...(flowNode.type === 'note' && flowNode.note ? { note: flowNode.note } : {}),
    ...(flowNode.type === 'value' ? { value: flowNode.value === undefined ? {} : flowNode.value } : {}),
    ...(flowNode.type === 'value' && flowNode.valueType ? { valueType: flowNode.valueType } : {}),
    ...(flowNode.type === 'role' ? {
        roleId: flowNode.roleId ?? '', roleKind: flowNode.roleKind ?? 'human',
        people: flowNode.people ?? [], description: flowNode.description || undefined,
    } : {}),
    ...(!isDisplay(flowNode.type) && flowNode.tags.length ? { tags: [...flowNode.tags] } : {}),
    ...((flowNode.type === 'ai' || flowNode.type === 'human') && flowNode.outputType ? { outputType: flowNode.outputType } : {}),
    ...(flowNode.output !== undefined ? { output: flowNode.output } : {}),
    ...(flowNode.type === 'exclusive-gateway' && flowNode.routes?.length ? { routes: flowNode.routes } : {}),
    ...(flowNode.body ? { body: flowNode.body } : {}),
    ...(flowNode.multiPartTemplate ? { multiPartTemplate: true } : {}),
    ...(flowNode.criteria.length ? { criteria: flowNode.criteria.map(criterion => ({ ...criterion })) } : {}),
    ...(flowNode.complexity ? { complexity: flowNode.complexity } : {}),
    ...(noSettings(flowNode.settings) ? {} : { settings: { ...flowNode.settings } }),
    ...(flowNode.at ? { at: flowNode.at } : {}),
    ...(flowNode.duration ? { duration: flowNode.duration } : {}),
    ...writeBitbucketEvent(flowNode),
    ...(flowNode.type === 'limiter' ? readLimiter(flowNode) : {}),
    ...(flowNode.spot ? { spot: writeSpot(flowNode.spot) } : {}),
    ...(flowNode.size ? { size: writeSize(flowNode.size) } : {}),
    ...(flowNode.status === READY ? {} : { status: flowNode.status }),
    ...(flowNode.archived ? { archived: true } : {}),
    ...(flowNode.chat ? { chat: flowNode.chat } : {}),
    ...(saysSuccess(flowNode.onSuccess) ? { onSuccess: writeSuccess(flowNode.onSuccess) } : {}),
    ...(flowNode.workflow ? { workflow: flowNode.workflow } : {}),
});

/** Use the description, falling back to the title, then append criteria. */
export const flowNodePrompt = (flowNode: FlowNode): string => {
    const base = flowNode.body.trim() || flowNode.title.trim();
    const lines = flowNode.criteria.map(criterion => criterion.text.trim()).filter(line => line !== '');
    if (lines.length === 0) return base;
    const criteria = `Success criteria:\n- ${lines.join('\n- ')}`;
    return base ? `${base}\n\n${criteria}` : criteria;
};

/** Empty prompts disable Play and stop chains. */
export const hasPrompt = (flowNode: FlowNode): boolean => flowNodePrompt(flowNode) !== '';

/**
 * Configuration eligibility. Status and prompt availability are checked separately.
 */
export const isRunnable = (flowNode: FlowNode, content?: (Pick<BoardContent, 'flowNodes'> & Partial<Pick<BoardContent, 'workflows'>>) | null): boolean => {
    if (flowNode.archived) return false;
    if (workflowFilesError(content?.workflows?.find(workflow => workflow.id === flowNode.workflow))) return false;
    switch (flowNode.type) {
        case 'ai': return isPlayable(flowNode.settings);
        case 'scheduler': return hasSchedule(flowNode.at, flowNode.duration);
        case 'bitbucket-pr-status': return !!flowNode.pullRequestId && !!flowNode.pullRequestStatus;
        case 'bitbucket-commit-status': return !!flowNode.commitId && !!flowNode.commitStatus;
        case 'start':
        case 'shutdown':
        case 'gateway':
        case 'exclusive-gateway': return true;
        case 'limiter': return flowNode.onSuccess.flowNodes.length === 2 && (!content ||
            flowNode.onSuccess.flowNodes.every(id => content.flowNodes.some(node => node.id === id && !node.archived)));
        default: return false;
    }
};

/** AI tasks require a nonempty prompt. */
export const hasWork = (flowNode: FlowNode): boolean => flowNode.type !== 'ai' || hasPrompt(flowNode);

/** Match the runner's input, including board order and empty slots at joins. */
export const flowNodeInput = (content: Pick<BoardContent, 'flowNodes'>, flowNode: FlowNode): unknown => {
    if (flowNode.archived) return undefined;
    const outputs = predecessors(content.flowNodes, flowNode.id)
        .filter(node => !node.archived && node.id !== flowNode.id)
        .map(node => node.status === 'done' ? node.output : undefined);
    if (outputs.every(output => output === undefined)) return undefined;
    return outputs.length === 1 ? outputs[0] : outputs.map(output => output ?? null);
};
