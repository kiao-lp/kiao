/**
 * Portable JSON clipboard format: accept current and legacy wrappers, bare cards and arrays.
 * Paste mints fresh ids, remaps internal chains and drops references outside the copied set.
 * Tags and status travel; instance-local references require validation or clearing.
 */

import { newId, readComplexity, readCriteria, readTags, FlowNode, writeFlowNode } from './boardContent';
import { readSchedule } from './flowNodeSchedule';
import { isAgentId, readSettings } from './flowNodeSettings';
import { readStatus } from './flowNodeStatus';
import { readSuccess, successFor, FlowNodeSuccess } from './flowNodeSuccess';
import { isTask, readType } from './flowNodeType';

export const FLOW_NODE_CLIP_KIND = 'kiao-flow-node';
export const FLOW_NODES_CLIP_KIND = 'kiao-flow-nodes';
export const CLIP_VERSION = 1;

/** Legacy kinds remain readable but are never written. */
const LEGACY_FLOW_NODE_CLIP_KIND = 'kiao-workflow-flow-node';
const LEGACY_FLOW_NODES_CLIP_KIND = 'kiao-workflow-flow-nodes';

const clipFlowNode = (flowNode: FlowNode): unknown => writeFlowNode(flowNode);

export const flowNodeClipText = (flowNode: FlowNode): string =>
    JSON.stringify({ kind: FLOW_NODE_CLIP_KIND, version: CLIP_VERSION, flowNode: clipFlowNode(flowNode) }, null, 2);

/** Keep the singular wrapper for one card so older instances can paste it. */
export const flowNodesClipText = (flowNodes: FlowNode[]): string => (
    flowNodes.length === 1
        ? flowNodeClipText(flowNodes[0])
        : JSON.stringify(
            { kind: FLOW_NODES_CLIP_KIND, version: CLIP_VERSION, flowNodes: flowNodes.map(clipFlowNode) },
            null,
            2,
        )
);

/** Destination-store agent ids; omitted ids are treated as foreign. */
export type KnownAgents = ReadonlySet<string>;

const NO_AGENTS: KnownAgents = new Set<string>();

/** Destination-store runner ids; unknown pins are cleared. */
export type KnownRunners = ReadonlySet<string>;

const NO_RUNNERS: KnownRunners = new Set<string>();

const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const parse = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const objects = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : [])
    .map(asObject)
    .filter((entry): entry is Record<string, unknown> => entry !== null);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const flowNodeFrom = (raw: Record<string, unknown>, agents: KnownAgents, runners: KnownRunners): FlowNode => {
    const settings = readSettings(raw.settings);
    // Infer types for older or handwritten cards without an explicit type.
    const type = readType(raw.type, settings);
    // Keep known managed agents and legacy engine names; drop foreign agent ids.
    if (settings.agent && isAgentId(settings.agent) && !agents.has(settings.agent)) delete settings.agent;
    // Unpin unknown runners so the pasted card remains playable.
    if (settings.runner && !runners.has(settings.runner)) delete settings.runner;
    return {
        id: newId(),
        title: type === 'note' ? '' : str(raw.title),
        type,
        note: type === 'note' ? str(raw.note) : '',
        value: type === 'value' ? (raw.value ?? {}) : {},
        tags: type === 'note' || type === 'value' ? [] : readTags(raw.tags),
        body: str(raw.body),
        // Criterion ids are local to this card and need no remapping.
        criteria: isTask(type) ? readCriteria(raw.criteria) : [],
        complexity: isTask(type) ? readComplexity(raw.complexity) : null,
        settings,
        at: readSchedule(raw.at),
        // Reset placement to avoid overlapping cards on the receiving canvas.
        spot: null,
        status: readStatus(raw.status),
        // Pasted cards arrive shown: archiving stays where it was, it does not travel.
        archived: false,
        // Conversations are instance-local and must not be shared by a duplicate.
        chat: '',
        onSuccess: successFor(readSuccess(raw.onSuccess), type),
        // Version ids are instance-local; pasted cards are unlinked.
        classVersion: null,
        // Grouping follows the paste target, not the source rectangle.
        workflow: '',
    };
};

const remap = (success: FlowNodeSuccess, minted: Map<string, string>): FlowNodeSuccess => {
    const id = minted.get(success.flowNode);
    const flowNodes = success.flowNodes
        .map(branch => minted.get(branch))
        .filter((branch): branch is string => branch !== undefined);
    return { ...success, flowNode: id ?? '', flowNodes };
};

/** Remap internal chains; drop external targets but retain transition modes. */
const flowNodesFrom = (source: Record<string, unknown>[], agents: KnownAgents, runners: KnownRunners): FlowNode[] => {
    const flowNodes = source.map(raw => flowNodeFrom(raw, agents, runners));
    const minted = new Map(source
        .map((flowNode, index): [string, string] => [str(flowNode.id), flowNodes[index].id])
        .filter(([old]) => old !== ''));
    return flowNodes.map(flowNode => ({ ...flowNode, onSuccess: remap(flowNode.onSuccess, minted) }));
};

/** Read cards with fresh ids, validating agent and runner references against the destination. */
export const readFlowNodesClip = (
    text: string, agents: KnownAgents = NO_AGENTS, runners: KnownRunners = NO_RUNNERS,
): FlowNode[] => {
    const parsed = parse(text);
    if (Array.isArray(parsed)) return flowNodesFrom(objects(parsed), agents, runners);
    const held = asObject(parsed);
    if (!held) return [];
    if (held.kind === FLOW_NODES_CLIP_KIND || held.kind === LEGACY_FLOW_NODES_CLIP_KIND) {
        return flowNodesFrom(objects(held.flowNodes), agents, runners);
    }
    const wrapped = asObject(held.flowNode);
    if ((held.kind === FLOW_NODE_CLIP_KIND || held.kind === LEGACY_FLOW_NODE_CLIP_KIND) && wrapped) {
        return flowNodesFrom([wrapped], agents, runners);
    }
    if (held.kind !== undefined) return [];
    // Reject old column objects: treating a header as a card would discard its children.
    if (Array.isArray(held.flowNodes)) return [];
    return typeof held.title === 'string' ? flowNodesFrom([held], agents, runners) : [];
};
