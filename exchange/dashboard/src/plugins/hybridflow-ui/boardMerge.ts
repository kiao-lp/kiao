/** Three-way merge by id. base is the last service state, ours is on screen, theirs is the service now. */

import { FlowNodeClass } from './flowNodeClass';
import { BoardContent, FlowNode, Workflow, WorkflowClass } from './boardContent';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const pick = <V>(base: V, ours: V, theirs: V): V => (same(ours, base) ? theirs : ours);

const mergeFlowNode = (base: FlowNode, ours: FlowNode, theirs: FlowNode): FlowNode => ({
    id: ours.id,
    title: pick(base.title, ours.title, theirs.title),
    type: pick(base.type, ours.type, theirs.type),
    at: pick(base.at, ours.at, theirs.at),
    duration: pick(base.duration, ours.duration, theirs.duration),
    spot: pick(base.spot, ours.spot, theirs.spot),
    tags: pick(base.tags, ours.tags, theirs.tags),
    note: pick(base.note, ours.note, theirs.note),
    value: pick(base.value, ours.value, theirs.value),
    valueType: pick(base.valueType, ours.valueType, theirs.valueType),
    outputType: pick(base.outputType, ours.outputType, theirs.outputType),
    output: pick(base.output, ours.output, theirs.output),
    body: pick(base.body, ours.body, theirs.body),
    criteria: pick(base.criteria, ours.criteria, theirs.criteria),
    complexity: pick(base.complexity, ours.complexity, theirs.complexity),
    settings: pick(base.settings, ours.settings, theirs.settings),
    status: pick(base.status, ours.status, theirs.status),
    archived: pick(base.archived, ours.archived, theirs.archived),
    chat: pick(base.chat, ours.chat, theirs.chat),
    onSuccess: pick(base.onSuccess, ours.onSuccess, theirs.onSuccess),
    classVersion: pick(base.classVersion, ours.classVersion, theirs.classVersion),
    workflow: pick(base.workflow, ours.workflow, theirs.workflow),
});

const mergeFlowNodeClass = (base: FlowNodeClass, ours: FlowNodeClass, theirs: FlowNodeClass): FlowNodeClass => ({
    id: ours.id,
    title: pick(base.title, ours.title, theirs.title),
    instantiable: pick(base.instantiable, ours.instantiable, theirs.instantiable),
    type: pick(base.type, ours.type, theirs.type),
    tags: pick(base.tags, ours.tags, theirs.tags),
    at: pick(base.at, ours.at, theirs.at),
    duration: pick(base.duration, ours.duration, theirs.duration),
    spot: pick(base.spot, ours.spot, theirs.spot),
    onSuccess: pick(base.onSuccess, ours.onSuccess, theirs.onSuccess),
    permission: pick(base.permission, ours.permission, theirs.permission),
    runner: pick(base.runner, ours.runner, theirs.runner),
    note: pick(base.note, ours.note, theirs.note),
    workflowClass: pick(base.workflowClass, ours.workflowClass, theirs.workflowClass),
    versions: pick(base.versions, ours.versions, theirs.versions),
});

/** For a newly created class, keeps local fields and takes versions from the service. */
const mergeNewFlowNodeClass = (mine: FlowNodeClass, yours: FlowNodeClass): FlowNodeClass => ({
    ...mine,
    versions: yours.versions,
});

const byId = <T extends { id: string }>(items: T[]): Map<string, T> => new Map(items.map(item => [item.id, item]));

const idsOf = (items: { id: string }[]): string[] => items.map(item => item.id);

/** Survival needs base to distinguish deleted from never created. */
const survivors = <T>(
    base: Map<string, T>, ours: Map<string, T>, theirs: Map<string, T>,
    merge: (was: T, mine: T, yours: T) => T,
    mergeNew: (mine: T, yours: T) => T = mine => mine,
): Map<string, T> => {
    const kept = new Map<string, T>();
    ours.forEach((mine, id) => {
        const was = base.get(id);
        const yours = theirs.get(id);
        if (yours) kept.set(id, was ? merge(was, mine, yours) : mergeNew(mine, yours));
        else if (!was || !same(was, mine)) kept.set(id, mine);
    });
    theirs.forEach((yours, id) => {
        if (!ours.has(id) && !base.has(id)) kept.set(id, yours);
    });
    return kept;
};

/** Inserts ids from from missing in into, after their predecessor in from. */
const graft = (into: string[], from: string[], wanted: (id: string) => boolean): string[] => {
    const out = [...into];
    from.forEach((id, index) => {
        if (out.includes(id) || !wanted(id)) return;
        const after = from.slice(0, index).reverse().find(held => out.includes(held));
        out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id);
    });
    return out;
};

/**
 * Picks one order.
 * If ours was rearranged, keeps it and grafts in new ids from theirs; otherwise takes theirs.
 */
const arrange = <T>(base: string[], ours: string[], theirs: string[], kept: Map<string, T>): T[] => {
    const known = new Set(base);
    const order = same(ours, base)
        ? graft(theirs, ours, id => kept.has(id))
        : graft(ours, theirs, id => !known.has(id));
    const seen = new Set<string>();
    return order.flatMap(id => {
        const held = kept.get(id);
        if (held === undefined || seen.has(id)) return [];
        seen.add(id);
        return [held];
    });
};

const mergeWorkflow = (base: Workflow, ours: Workflow, theirs: Workflow): Workflow => ({
    id: ours.id,
    name: pick(base.name, ours.name, theirs.name),
});

const mergeWorkflowClass = (
    base: WorkflowClass, ours: WorkflowClass, theirs: WorkflowClass,
): WorkflowClass => ({
    id: ours.id,
    name: pick(base.name, ours.name, theirs.name),
});

export const mergeBoardContent = (base: BoardContent, ours: BoardContent, theirs: BoardContent): BoardContent => {
    const flowNodes = survivors(byId(base.flowNodes), byId(ours.flowNodes), byId(theirs.flowNodes), mergeFlowNode);
    const classes = survivors(
        byId(base.flowNodeClasses ?? []), byId(ours.flowNodeClasses ?? []),
        byId(theirs.flowNodeClasses ?? []), mergeFlowNodeClass, mergeNewFlowNodeClass);
    const workflows = survivors(
        byId(base.workflows ?? []), byId(ours.workflows ?? []),
        byId(theirs.workflows ?? []), mergeWorkflow);
    const workflowClasses = survivors(
        byId(base.workflowClasses ?? []), byId(ours.workflowClasses ?? []),
        byId(theirs.workflowClasses ?? []), mergeWorkflowClass);
    return {
        flowNodes: arrange(idsOf(base.flowNodes), idsOf(ours.flowNodes), idsOf(theirs.flowNodes), flowNodes),
        flowNodeClasses: arrange(
            idsOf(base.flowNodeClasses ?? []), idsOf(ours.flowNodeClasses ?? []),
            idsOf(theirs.flowNodeClasses ?? []), classes),
        workflows: arrange(
            idsOf(base.workflows ?? []), idsOf(ours.workflows ?? []),
            idsOf(theirs.workflows ?? []), workflows),
        workflowClasses: arrange(
            idsOf(base.workflowClasses ?? []), idsOf(ours.workflowClasses ?? []),
            idsOf(theirs.workflowClasses ?? []), workflowClasses),
    };
};
