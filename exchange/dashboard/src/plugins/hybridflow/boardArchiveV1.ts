import { newId } from './boardContent';

type Fields = Record<string, unknown>;

const object = (value: unknown): Fields | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : null;

const idOf = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const byId = (items: unknown): Map<string, Fields> | null => {
    if (!Array.isArray(items)) return null;
    const entries = new Map<string, Fields>();
    for (const item of items) {
        const entry = object(item);
        const id = idOf(entry?.id);
        if (!entry || !id || entries.has(id)) return null;
        entries.set(id, entry);
    }
    return entries;
};

const remapIds = (source: Map<string, Fields>, occupied: Map<string, Fields>) =>
    new Map([...source.keys()].map(id => [id, occupied.has(id) ? newId() : id]));

/** Upgrade the fixed v1 wire format before validating or importing the current archive. */
export const upgradeBoardArchiveV1 = (archive: Fields): Fields | null => {
    const nodes = byId(archive.flowNodes);
    const workflows = byId(archive.workflows);
    const classes = byId(archive.flowNodeClasses);
    const workflowClasses = byId(archive.workflowClasses);
    if (!nodes || !workflows || !classes || !workflowClasses) return null;

    const nodeIds = remapIds(classes, nodes);
    const workflowIds = remapIds(workflowClasses, workflows);
    const converted: Fields[] = [];
    const notes: Fields[] = [];
    const incoming = new Map<string, Fields[]>();
    for (const [id, entry] of classes) {
        const versions = entry.versions ?? [];
        if (!Array.isArray(versions) || versions.some(version => !object(version))) return null;
        const latest = object(versions.at(-1));
        const selection = object(entry.selection);
        const settings = {
            ...selection,
            agent: selection?.agent || latest?.agent,
            permission: entry.permission,
            runner: entry.runner,
        };
        const type = entry.type || (settings.agent || selection?.model || settings.permission ? 'ai' : 'human');
        const workflow = workflowIds.get(idOf(entry.workflowClass));
        const success = object(entry.onSuccess);
        const target = idOf(success?.flowNode);
        const next = id !== target && type !== 'shutdown' ? nodeIds.get(target) : undefined;
        const onSuccess = next || type === 'ai'
            ? { flowNode: next, mode: success?.mode, compact: success?.compact }
            : undefined;
        const node = {
            id: nodeIds.get(id), title: entry.title, type, status: 'draft', workflow,
            tags: entry.tags, spot: entry.spot, size: entry.size, at: entry.at, duration: entry.duration,
            body: latest?.body, criteria: latest?.criteria, multiPartTemplate: latest?.template,
            settings: type === 'ai' ? settings : undefined, onSuccess,
        };
        converted.push(node);
        if (next && onSuccess) {
            const sources = incoming.get(next);
            if (sources) sources.push(onSuccess);
            else incoming.set(next, [onSuccess]);
        }
        if (typeof entry.note === 'string' && entry.note.trim()) {
            notes.push({
                id: newId(), title: entry.title ? `${entry.title} — Note` : 'Note',
                type: 'note', note: entry.note, workflow,
            });
        }
    }

    const joins = converted.flatMap(node => {
        const target = idOf(node.id);
        const sources = incoming.get(target);
        if (!sources || sources.length < 2) return [];
        const id = newId();
        for (const source of sources) source.flowNode = id;
        return [{
            id, title: node.title ? `Join — ${node.title}` : 'Join',
            type: 'exclusive-gateway', workflow: node.workflow,
            onSuccess: { flowNodes: [target] }, routes: [{ condition: 'true', flowNode: target }],
        }];
    });

    return {
        kind: archive.kind, version: 2, name: archive.name, archived: archive.archived,
        flowNodes: [...nodes.values(), ...converted, ...notes, ...joins],
        workflows: [
            ...workflows.values(),
            ...[...workflowClasses].map(([id, entry]) => ({ id: workflowIds.get(id), name: entry.name })),
        ],
    };
};
