/**
 * Board codec: tolerate hand-written, generated and pasted content on read; write only
 * supported fields, omitting empty values. Node IDs identify cards independently of placement.
 */

import { hasSchedule, readSchedule, readDuration } from './flowNodeSchedule';
import {
    readClassRef, readFlowNodeClasses, writeFlowNodeClass, ClassRef, FlowNodeClass,
} from './flowNodeClass';
import { isPlayable, noSettings, readSettings, FlowNodeSettings } from './flowNodeSettings';
import { readSpot, FlowNodeSpot, writeSpot } from './flowNodeSpot';
import { readStatus, READY, FlowNodeStatus } from './flowNodeStatus';
import {
    noSuccess, readSuccess, saysSuccess, successFor, FlowNodeSuccess, writeSuccess,
} from './flowNodeSuccess';
import { readType, saysType, FlowNodeType } from './flowNodeType';

/** Criterion IDs preserve editor identity across rewrites; only the text enters the prompt. */
export interface SuccessCriterion {
    id: string;
    text: string;
}

/** Ordered estimation choices, not measurements. */
export const COMPLEXITIES = [1, 2, 3, 5, 8, 13, 21] as const;

/** Optional task estimate; never included in the prompt. */
export type TaskComplexity = number | null;

export interface FlowNode {
    /** Stable across moves. */
    id: string;
    title: string;
    /** Controls card capabilities; `human` is omitted on disk. See flowNodeType.ts. */
    type: FlowNodeType;
    /** Ordered tag words, not store IDs, so they survive cross-instance paste. Unknown tags render grey. */
    tags: string[];
    /** Task description in Markdown. Playing preserves it; turn output stays in the conversation. */
    body: string;
    /** Task-only criteria, included in the prompt when present. */
    criteria: SuccessCriterion[];
    /** Task-only estimate. */
    complexity: TaskComplexity;
    /** AI uses all settings; Human uses only the folder; other types run no turn. */
    settings: FlowNodeSettings;
    /** Scheduler's local `YYYY-MM-DDTHH:mm`; alternative to duration. */
    at: string;
    /** Fixed wait from play, as positive h/m/s/ms components; alternative to at. */
    duration?: string;
    /** Persisted board position; null means unplaced. */
    spot: FlowNodeSpot | null;
    status: FlowNodeStatus;
    /** Hidden everywhere without being deleted. Links to and from it are hidden too. */
    archived: boolean;
    /**
     * Conversation ID, or ''. Reused on replay or inherited from a predecessor; cleared only by hand.
     * Local to this instance: never carry it on cross-instance paste.
     */
    chat: string;
    /** Successors and AI chat transition. Shutdown has none; Gateway uses a list of branches. */
    onSuccess: FlowNodeSuccess;
    /** Source class/version, or null. Unlinking changes no other card fields. */
    classVersion: ClassRef | null;
    /** At most one workflow ID per card; '' means ungrouped. */
    workflow: string;
}

/** Members name their workflow; its bounds are computed from their positions. */
export interface Workflow {
    /** Stable across member moves. */
    id: string;
    name: string;
}

/** Named group of node classes. */
export interface WorkflowClass {
    /** Stable identity. */
    id: string;
    name: string;
}

export interface BoardContent {
    /** Lists retain store order. */
    flowNodes: FlowNode[];
    flowNodeClasses: FlowNodeClass[];
    workflows: Workflow[];
    workflowClasses: WorkflowClass[];
}

/** UUIDs avoid collisions when pasting across instances. */
export const newId = (): string => crypto.randomUUID();

/** Infer AI from a named agent, otherwise Human. Other types are set on existing cards. */
export const newFlowNode = (
    title: string,
    body = '',
    settings: FlowNodeSettings = {},
    onSuccess: FlowNodeSuccess = noSuccess(),
    criteria: SuccessCriterion[] = [],
    complexity: TaskComplexity = null,
): FlowNode => ({
    id: newId(), title: title.trim(), type: readType(undefined, settings), tags: [], body,
    criteria, complexity,
    settings, at: '', spot: null, status: READY, archived: false, chat: '', onSuccess, classVersion: null,
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
    return {
        // Missing IDs are generated on read and persisted on the first save.
        id: text(source.id) || newId(),
        title: text(source.title),
        type,
        tags: readTags(source.tags),
        body: text(source.body),
        criteria: task ? readCriteria(source.criteria) : [],
        complexity: task ? readComplexity(source.complexity) : null,
        settings,
        at: readSchedule(source.at),
        ...(readDuration(source.duration) ? { duration: readDuration(source.duration) } : {}),
        spot: readSpot(source.spot),
        status: readStatus(source.status),
        archived: (source as Record<string, unknown>).archived === true,
        chat: text(source.chat).trim(),
        // Strip transitions unsupported by the card type.
        onSuccess: successFor(readSuccess(source.onSuccess), type),
        classVersion: readClassRef(source.classVersion),
        workflow: text(source.workflow).trim(),
    };
};

const readFlowNodes = (raw: unknown): FlowNode[] =>
    list(raw).map(readFlowNode).filter((flowNode): flowNode is FlowNode => flowNode !== null);

const readWorkflow = (raw: unknown): Workflow | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    // Persist the generated identity on the first save.
    return { id: text(source.id) || newId(), name: text(source.name) };
};

const readWorkflows = (raw: unknown): Workflow[] =>
    list(raw).map(readWorkflow).filter((workflow): workflow is Workflow => workflow !== null);

const readWorkflowClass = (raw: unknown): WorkflowClass | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    return { id: text(source.id) || newId(), name: text(source.name) };
};

const readWorkflowClasses = (raw: unknown): WorkflowClass[] =>
    list(raw).map(readWorkflowClass).filter((workflow): workflow is WorkflowClass => workflow !== null);

export const readBoardContent = (raw: unknown): BoardContent => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [] };
    }
    const source = raw as Record<string, unknown>;
    return {
        flowNodes: readFlowNodes(source.flowNodes),
        flowNodeClasses: readFlowNodeClasses(source.flowNodeClasses),
        workflows: readWorkflows(source.workflows),
        workflowClasses: readWorkflowClasses(source.workflowClasses),
    };
};

export const writeBoardContent = (content: BoardContent): unknown => ({
    flowNodes: content.flowNodes.map(writeFlowNode),
    flowNodeClasses: content.flowNodeClasses.map(writeFlowNodeClass),
    ...(content.workflows.length
        ? { workflows: content.workflows.map(workflow => ({ ...workflow })) }
        : {}),
    ...(content.workflowClasses.length
        ? { workflowClasses: content.workflowClasses.map(workflow => ({ ...workflow })) }
        : {}),
});

export const writeFlowNode = (flowNode: FlowNode): unknown => ({
    id: flowNode.id,
    title: flowNode.title,
    ...(saysType(flowNode.type) ? { type: flowNode.type } : {}),
    ...(flowNode.tags.length ? { tags: [...flowNode.tags] } : {}),
    ...(flowNode.body ? { body: flowNode.body } : {}),
    ...(flowNode.criteria.length ? { criteria: flowNode.criteria.map(criterion => ({ ...criterion })) } : {}),
    ...(flowNode.complexity ? { complexity: flowNode.complexity } : {}),
    ...(noSettings(flowNode.settings) ? {} : { settings: { ...flowNode.settings } }),
    ...(flowNode.at ? { at: flowNode.at } : {}),
    ...(flowNode.duration ? { duration: flowNode.duration } : {}),
    ...(flowNode.spot ? { spot: writeSpot(flowNode.spot) } : {}),
    ...(flowNode.status === READY ? {} : { status: flowNode.status }),
    ...(flowNode.archived ? { archived: true } : {}),
    ...(flowNode.chat ? { chat: flowNode.chat } : {}),
    ...(saysSuccess(flowNode.onSuccess) ? { onSuccess: writeSuccess(flowNode.onSuccess) } : {}),
    ...(flowNode.classVersion ? { classVersion: { ...flowNode.classVersion } } : {}),
    ...(flowNode.workflow ? { workflow: flowNode.workflow } : {}),
});

/**
 * Use the description, falling back to the title, then append criteria. Keeping the title
 * out of described tasks lets board renames leave their prompts unchanged.
 */
export const flowNodePrompt = (flowNode: FlowNode): string => {
    const base = flowNode.body.trim() || flowNode.title.trim();
    const lines = flowNode.criteria.map(criterion => criterion.text.trim()).filter(line => line !== '');
    if (lines.length === 0) return base;
    const criteria = `Success criteria:\n- ${lines.join('\n- ')}`;
    return base ? `${base}\n\n${criteria}` : criteria;
};

/** Empty prompts disable Play and stop chains. */
export const hasPrompt = (flowNode: FlowNode): boolean => flowNodePrompt(flowNode) !== '';

/** Type-level eligibility only; status and prompt availability are checked separately. Archived never runs. */
export const isRunnable = (flowNode: FlowNode): boolean => {
    if (flowNode.archived) return false;
    switch (flowNode.type) {
        case 'ai': return isPlayable(flowNode.settings);
        case 'scheduler': return hasSchedule(flowNode.at, flowNode.duration);
        case 'shutdown': return true;
        case 'gateway': return true;
        default: return false;
    }
};

/** Only AI cards require a nonempty prompt; other types perform work without one. */
export const hasWork = (flowNode: FlowNode): boolean => flowNode.type !== 'ai' || hasPrompt(flowNode);
