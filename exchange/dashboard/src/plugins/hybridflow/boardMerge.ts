/** Three-way merge by id. base is the last service state, ours is on screen, theirs is the service now. */

import { BoardContent, FlowNode, Workflow } from './boardContent';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const pick = <V>(base: V, ours: V, theirs: V): V => (same(ours, base) ? theirs : ours);

const mergeFlowNode = (base: FlowNode, ours: FlowNode, theirs: FlowNode): FlowNode => ({
    id: ours.id,
    title: pick(base.title, ours.title, theirs.title),
    type: pick(base.type, ours.type, theirs.type),
    at: pick(base.at, ours.at, theirs.at),
    duration: pick(base.duration, ours.duration, theirs.duration),
    pullRequestId: pick(base.pullRequestId, ours.pullRequestId, theirs.pullRequestId),
    pullRequestStatus: pick(base.pullRequestStatus, ours.pullRequestStatus, theirs.pullRequestStatus),
    commitId: pick(base.commitId, ours.commitId, theirs.commitId),
    commitStatus: pick(base.commitStatus, ours.commitStatus, theirs.commitStatus),
    maxPasses: pick(base.maxPasses, ours.maxPasses, theirs.maxPasses),
    remainingPasses: theirs.remainingPasses,
    spot: pick(base.spot, ours.spot, theirs.spot),
    size: pick(base.size, ours.size, theirs.size),
    tags: pick(base.tags, ours.tags, theirs.tags),
    note: pick(base.note, ours.note, theirs.note),
    value: pick(base.value, ours.value, theirs.value),
    valueType: pick(base.valueType, ours.valueType, theirs.valueType),
    roleId: pick(base.roleId ?? '', ours.roleId ?? '', theirs.roleId),
    roleKind: pick(base.roleKind ?? 'human', ours.roleKind ?? 'human', theirs.roleKind),
    people: pick(base.people ?? [], ours.people ?? [], theirs.people),
    description: pick(base.description ?? '', ours.description ?? '', theirs.description),
    outputType: pick(base.outputType, ours.outputType, theirs.outputType),
    output: pick(base.output, ours.output, theirs.output),
    body: pick(base.body, ours.body, theirs.body),
    multiPartTemplate: pick(base.multiPartTemplate, ours.multiPartTemplate, theirs.multiPartTemplate),
    criteria: pick(base.criteria, ours.criteria, theirs.criteria),
    complexity: pick(base.complexity, ours.complexity, theirs.complexity),
    settings: pick(base.settings, ours.settings, theirs.settings),
    status: pick(base.status, ours.status, theirs.status),
    archived: pick(base.archived, ours.archived, theirs.archived),
    chat: pick(base.chat, ours.chat, theirs.chat),
    onSuccess: pick(base.onSuccess, ours.onSuccess, theirs.onSuccess),
    routes: pick(base.routes, ours.routes, theirs.routes),
    workflow: pick(base.workflow, ours.workflow, theirs.workflow),
});

const mergeNewFlowNode = (ours: FlowNode, theirs: FlowNode): FlowNode =>
    ours.type === 'limiter' ? { ...ours, remainingPasses: theirs.remainingPasses } : ours;

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
    ...theirs,
    name: pick(base.name, ours.name, theirs.name),
});

export const mergeBoardContent = (base: BoardContent, ours: BoardContent, theirs: BoardContent): BoardContent => {
    const flowNodes = survivors(
        byId(base.flowNodes), byId(ours.flowNodes), byId(theirs.flowNodes), mergeFlowNode, mergeNewFlowNode);
    const workflows = survivors(
        byId(base.workflows ?? []), byId(ours.workflows ?? []),
        byId(theirs.workflows ?? []), mergeWorkflow);
    return {
        flowNodes: arrange(idsOf(base.flowNodes), idsOf(ours.flowNodes), idsOf(theirs.flowNodes), flowNodes),
        workflows: arrange(
            idsOf(base.workflows ?? []), idsOf(ours.workflows ?? []),
            idsOf(theirs.workflows ?? []), workflows),
    };
};
