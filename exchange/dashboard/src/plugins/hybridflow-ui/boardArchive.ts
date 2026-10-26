/**
 * One board in one file: what the download button writes and the Import button reads.
 *
 * A board is a row in a database, so it has no file of its own to copy — this is the file made
 * for it: the board's name, its cards, its classes with their versions, and the rectangles round
 * them, as one JSON document. Importing it replays those through the client's own calls onto a
 * fresh board, keeping the ids — which is what keeps the chains, the grouping and the links from
 * cards to class versions.
 *
 * What does not travel is what names something outside the board. A chat stays where the
 * conversation is, a `running` card arrives `interrupted` — the run it belonged to is gone — and
 * an agent or a runner the destination store does not hold is left unset rather than refusing
 * the import. Revisions and timestamps are the store's own and are never written.
 */

import { readComplexity, readCriteria, readTags } from './boardContent';
import { readDuration, readSchedule } from './flowNodeSchedule';
import { readStatus } from './flowNodeStatus';
import { readSuccess, saysSuccess, successFor, writeSuccess } from './flowNodeSuccess';
import { readType } from './flowNodeType';
import { chainConnectionIssue } from './flowConnections';
import type { HybridflowClient } from './service';
import type {
    BoardDetailDto, BoardSummary, CriterionDto, FlowNodeClassDto, FlowNodeDto,
    SettingsDto, SpotDto, SuccessDto, WorkflowClassDto, WorkflowDto,
} from './service';

export const BOARD_ARCHIVE_KIND = 'kiao-board';
export const BOARD_ARCHIVE_VERSION = 1;

/** A card as the file holds it: the fields a create replays, plus the class version it names. */
export interface ArchivedFlowNode {
    id: string;
    title: string;
    type?: string;
    tags?: string[];
    body?: string;
    criteria?: CriterionDto[];
    complexity?: number;
    settings?: SettingsDto;
    at?: string;
    duration?: string;
    spot?: SpotDto;
    status?: string;
    archived?: boolean;
    onSuccess?: SuccessDto;
    workflow?: string;
    /** The version's id on the board it was downloaded from; remapped on import. */
    classVersion?: string;
}

/** One version as the file holds it: its words, and whether they were published. */
export interface ArchivedClassVersion {
    /** The version's id on the board it was downloaded from; remapped on import. */
    id: string;
    body?: string;
    criteria?: CriterionDto[];
    template?: boolean;
    agent?: string;
    published: boolean;
}

/** A class as the file holds it: its own answers, and its succession oldest first. */
export interface ArchivedFlowNodeClass {
    id: string;
    title: string;
    instantiable?: boolean;
    type?: string;
    tags?: string[];
    at?: string;
    duration?: string;
    spot?: SpotDto;
    onSuccess?: SuccessDto;
    permission?: string;
    runner?: string;
    note?: string;
    workflowClass?: string;
    versions: ArchivedClassVersion[];
}

export interface ArchivedGrouping {
    id: string;
    name: string;
}

/** The file, parsed and normalized: everything an import replays, and nothing it drops. */
export interface BoardArchive {
    name: string;
    archived: boolean;
    flowNodes: ArchivedFlowNode[];
    flowNodeClasses: ArchivedFlowNodeClass[];
    workflows: ArchivedGrouping[];
    workflowClasses: ArchivedGrouping[];
}

// ── export ────────────────────────────────────────────────────────────────────

/** The board, whole, as one JSON document. */
export const boardArchiveText = (detail: BoardDetailDto): string =>
    JSON.stringify({
        kind: BOARD_ARCHIVE_KIND,
        version: BOARD_ARCHIVE_VERSION,
        name: detail.board.name,
        ...(detail.board.archived ? { archived: true } : {}),
        flowNodes: detail.flowNodes.map(archivedFlowNode),
        flowNodeClasses: detail.flowNodeClasses.map(archivedClass),
        workflows: detail.workflows.map(archivedGrouping),
        workflowClasses: detail.workflowClasses.map(archivedGrouping),
    }, null, 2);

/** The file a board is downloaded as. The slug is URL-safe, hence filename-safe. */
export const boardArchiveFilename = (slug: string): string => `${slug}.json`;

const archivedFlowNode = (flowNode: FlowNodeDto): ArchivedFlowNode => ({
    id: flowNode.id,
    title: flowNode.title,
    ...(optional(flowNode.type) ? { type: flowNode.type } : {}),
    ...(flowNode.tags?.length ? { tags: flowNode.tags } : {}),
    ...(optional(flowNode.body) ? { body: flowNode.body } : {}),
    ...(flowNode.criteria?.length ? { criteria: flowNode.criteria } : {}),
    ...(flowNode.complexity !== undefined ? { complexity: flowNode.complexity } : {}),
    ...(flowNode.settings && !emptySettings(flowNode.settings) ? { settings: flowNode.settings } : {}),
    ...(optional(flowNode.at) ? { at: flowNode.at } : {}),
    ...(optional(flowNode.duration) ? { duration: flowNode.duration } : {}),
    ...(flowNode.spot ? { spot: flowNode.spot } : {}),
    ...(optional(flowNode.status) ? { status: flowNode.status } : {}),
    ...(flowNode.archived ? { archived: true } : {}),
    ...archiveSuccess(flowNode.onSuccess, flowNode.type, flowNode.settings),
    ...(optional(flowNode.workflow) ? { workflow: flowNode.workflow } : {}),
    // The chat stays where the conversation is; the run holding the card is gone with the
    // download. What travels is the link to the version it was made from, as the id to remap.
    ...(flowNode.classVersion ? { classVersion: flowNode.classVersion.versionId } : {}),
});

const archivedClass = (flowNodeClass: FlowNodeClassDto): ArchivedFlowNodeClass => ({
    id: flowNodeClass.id,
    title: flowNodeClass.title,
    ...(flowNodeClass.instantiable ? { instantiable: true } : {}),
    ...(optional(flowNodeClass.type) ? { type: flowNodeClass.type } : {}),
    ...(flowNodeClass.tags?.length ? { tags: flowNodeClass.tags } : {}),
    ...(optional(flowNodeClass.at) ? { at: flowNodeClass.at } : {}),
    ...(optional(flowNodeClass.duration) ? { duration: flowNodeClass.duration } : {}),
    ...(flowNodeClass.spot ? { spot: flowNodeClass.spot } : {}),
    ...archiveSuccess(flowNodeClass.onSuccess, flowNodeClass.type),
    ...(optional(flowNodeClass.permission) ? { permission: flowNodeClass.permission } : {}),
    ...(optional(flowNodeClass.runner) ? { runner: flowNodeClass.runner } : {}),
    ...(optional(flowNodeClass.note) ? { note: flowNodeClass.note } : {}),
    ...(optional(flowNodeClass.workflowClass) ? { workflowClass: flowNodeClass.workflowClass } : {}),
    versions: flowNodeClass.versions.map(version => ({
        id: version.id,
        ...(optional(version.body) ? { body: version.body } : {}),
        ...(version.criteria?.length ? { criteria: version.criteria } : {}),
        ...(version.template ? { template: true } : {}),
        ...(optional(version.agent) ? { agent: version.agent } : {}),
        published: version.status === 'published',
    })),
});

const archivedGrouping = (grouping: WorkflowDto | WorkflowClassDto): ArchivedGrouping => ({
    id: grouping.id,
    name: grouping.name,
});

const archiveSuccess = (raw: SuccessDto | undefined, type?: string, settings?: SettingsDto): { onSuccess?: SuccessDto } => {
    const kind = readType(type, { agent: settings?.agent, model: settings?.model });
    const success = successFor(readSuccess(raw), kind);
    if (!saysSuccess(success)) return {};
    const written = writeSuccess(success) as SuccessDto;
    if (kind !== 'ai') delete written.mode;
    return { onSuccess: written };
};

const optional = (value: string | undefined): boolean =>
    value !== undefined && value.trim() !== '';

const emptySettings = (settings: SettingsDto): boolean =>
    !optional(settings.agent) && !optional(settings.model) && !optional(settings.effort)
    && !optional(settings.permission) && !optional(settings.folder) && !optional(settings.runner)
    && !settings.extra;

// ── import ────────────────────────────────────────────────────────────────────

/**
 * The file, read back. Strict about the envelope — the kind, the version, the name and the four
 * lists — and forgiving about the entries, the way the board's own readers are: an entry says
 * what it says, and what it cannot say is left unset. Anything else is not a board download.
 */
export const readBoardArchive = (text: string): BoardArchive | null => {
    const parsed = parse(text);
    if (!parsed || parsed.kind !== BOARD_ARCHIVE_KIND || parsed.version !== BOARD_ARCHIVE_VERSION) {
        return null;
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) return null;
    if (!Array.isArray(parsed.flowNodes) || !Array.isArray(parsed.flowNodeClasses)
        || !Array.isArray(parsed.workflows) || !Array.isArray(parsed.workflowClasses)) {
        return null;
    }
    const flowNodes: ArchivedFlowNode[] = [];
    for (const raw of parsed.flowNodes) {
        const flowNode = readArchivedFlowNode(raw);
        if (!flowNode) return null;
        flowNodes.push(flowNode);
    }
    const flowNodeClasses: ArchivedFlowNodeClass[] = [];
    for (const raw of parsed.flowNodeClasses) {
        const flowNodeClass = readArchivedClass(raw);
        if (!flowNodeClass) return null;
        flowNodeClasses.push(flowNodeClass);
    }
    const workflows: ArchivedGrouping[] = [];
    for (const raw of parsed.workflows) {
        const grouping = readArchivedGrouping(raw);
        if (!grouping) return null;
        workflows.push(grouping);
    }
    const workflowClasses: ArchivedGrouping[] = [];
    for (const raw of parsed.workflowClasses) {
        const grouping = readArchivedGrouping(raw);
        if (!grouping) return null;
        workflowClasses.push(grouping);
    }
    // A reference the file does not hold is left unset: a chain onto nothing would refuse the
    // import, and a file saying one is either hand-written or from a newer writer.
    const heldNodes = new Set(flowNodes.map(flowNode => flowNode.id));
    const heldClasses = new Set(flowNodeClasses.map(flowNodeClass => flowNodeClass.id));
    const heldWorkflows = new Set(workflows.map(workflow => workflow.id));
    const heldWorkflowClasses = new Set(workflowClasses.map(workflow => workflow.id));
    const heldVersions = new Set(flowNodeClasses.flatMap(flowNodeClass =>
        flowNodeClass.versions.map(version => version.id).filter(id => id !== '')));
    for (const flowNode of flowNodes) {
        flowNode.onSuccess = chainWithin(flowNode.onSuccess, heldNodes);
        if (flowNode.workflow && !heldWorkflows.has(flowNode.workflow)) delete flowNode.workflow;
        if (flowNode.classVersion && !heldVersions.has(flowNode.classVersion)) {
            delete flowNode.classVersion;
        }
    }
    for (const flowNodeClass of flowNodeClasses) {
        const target = flowNodeClass.onSuccess?.flowNode;
        flowNodeClass.onSuccess = target && !heldClasses.has(target)
            ? transitionOnly(flowNodeClass.onSuccess)
            : chainWithin(flowNodeClass.onSuccess, heldClasses);
        if (flowNodeClass.workflowClass && !heldWorkflowClasses.has(flowNodeClass.workflowClass)) {
            delete flowNodeClass.workflowClass;
        }
    }
    return {
        name,
        archived: parsed.archived === true,
        flowNodes, flowNodeClasses, workflows, workflowClasses,
    };
};

const parse = (text: string): Record<string, unknown> | null => {
    try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
};

const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const readArchivedFlowNode = (raw: unknown): ArchivedFlowNode | null => {
    const source = asObject(raw);
    if (!source) return null;
    const id = text(source.id).trim();
    if (!id) return null;
    // Held by no run: a card downloaded mid-play arrives interrupted, the way a run left
    // behind by a dead process is settled.
    const status = readStatus(source.status);
    return {
        id,
        title: text(source.title),
        ...(optional(text(source.type)) ? { type: text(source.type).trim() } : {}),
        ...tagsOf(source.tags),
        ...(optional(text(source.body)) ? { body: text(source.body) } : {}),
        ...criteriaOf(source.criteria),
        ...complexityOf(source.complexity),
        ...settingsOf(source.settings),
        ...scheduleOf(source),
        ...spotOf(source.spot),
        status: status === 'running' || status === 'waiting-refresh' ? 'interrupted' : status,
        ...(source.archived === true ? { archived: true } : {}),
        ...chainOf(source.onSuccess),
        ...(optional(text(source.workflow)) ? { workflow: text(source.workflow).trim() } : {}),
        ...(optional(text(source.classVersion))
            ? { classVersion: text(source.classVersion).trim() } : {}),
    };
};

const readArchivedClass = (raw: unknown): ArchivedFlowNodeClass | null => {
    const source = asObject(raw);
    if (!source) return null;
    const id = text(source.id).trim();
    if (!id) return null;
    if (source.versions !== undefined && !Array.isArray(source.versions)) return null;
    const versions: ArchivedClassVersion[] = [];
    for (const entry of (Array.isArray(source.versions) ? source.versions : [])) {
        const held = asObject(entry);
        if (!held) return null;
        versions.push({
            id: text(held.id).trim(),
            ...(optional(text(held.body)) ? { body: text(held.body) } : {}),
            ...criteriaOf(held.criteria),
            ...(held.template === true ? { template: true } : {}),
            ...(optional(text(held.agent)) ? { agent: text(held.agent).trim() } : {}),
            published: held.published === true || text(held.status).trim() === 'published',
        });
    }
    return {
        id,
        title: text(source.title),
        ...(source.instantiable === true ? { instantiable: true } : {}),
        ...(optional(text(source.type)) ? { type: text(source.type).trim() } : {}),
        ...tagsOf(source.tags),
        ...scheduleOf(source),
        ...spotOf(source.spot),
        ...chainOf(source.onSuccess),
        ...(optional(text(source.permission)) ? { permission: text(source.permission).trim() } : {}),
        ...(optional(text(source.runner)) ? { runner: text(source.runner).trim() } : {}),
        ...(optional(text(source.note)) ? { note: text(source.note) } : {}),
        ...(optional(text(source.workflowClass))
            ? { workflowClass: text(source.workflowClass).trim() } : {}),
        versions,
    };
};

const readArchivedGrouping = (raw: unknown): ArchivedGrouping | null => {
    const source = asObject(raw);
    if (!source) return null;
    const id = text(source.id).trim();
    if (!id) return null;
    return { id, name: text(source.name) };
};

const tagsOf = (raw: unknown): { tags?: string[] } => {
    const tags = readTags(raw);
    return tags.length ? { tags } : {};
};

const criteriaOf = (raw: unknown): { criteria?: CriterionDto[] } => {
    const criteria = readCriteria(raw);
    return criteria.length ? { criteria } : {};
};

const complexityOf = (raw: unknown): { complexity?: number } => {
    const complexity = readComplexity(raw);
    return complexity === null ? {} : { complexity };
};

const settingsOf = (raw: unknown): { settings?: SettingsDto } => {
    const source = asObject(raw);
    if (!source) return {};
    const settings: SettingsDto = {};
    for (const key of ['agent', 'model', 'effort', 'permission', 'folder', 'runner'] as const) {
        if (optional(text(source[key]))) settings[key] = text(source[key]).trim();
    }
    const extra = asObject(source.extra);
    if (extra) {
        const kept: Record<string, string> = {};
        for (const [key, value] of Object.entries(extra)) {
            if (typeof value === 'string') kept[key] = value;
        }
        if (Object.keys(kept).length) settings.extra = kept;
    }
    return Object.keys(settings).length ? { settings } : {};
};

const scheduleOf = (source: Record<string, unknown>): { at?: string; duration?: string } => ({
    ...(readSchedule(source.at) ? { at: readSchedule(source.at) } : {}),
    ...(readDuration(source.duration) ? { duration: readDuration(source.duration) } : {}),
});

const spotOf = (raw: unknown): { spot?: SpotDto } => {
    const source = asObject(raw);
    if (!source || typeof source.x !== 'number' || typeof source.y !== 'number'
        || !Number.isFinite(source.x) || !Number.isFinite(source.y)) {
        return {};
    }
    return { spot: { x: source.x, y: source.y } };
};

const chainOf = (raw: unknown): { onSuccess?: SuccessDto } => {
    const source = asObject(raw);
    if (!source) return {};
    const flowNode = text(source.flowNode).trim();
    const flowNodes = (Array.isArray(source.flowNodes) ? source.flowNodes : [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');
    const mode = text(source.mode).trim();
    const compact = source.compact === true;
    if (!flowNode && !flowNodes.length && !mode && !compact) return {};
    return {
        onSuccess: {
            ...(flowNode ? { flowNode } : {}),
            ...(flowNodes.length ? { flowNodes } : {}),
            ...(mode ? { mode } : {}),
            ...(compact ? { compact } : {}),
        },
    };
};

/** Keeps the chain's targets within the file and the transition however it stands. */
const chainWithin = (success: SuccessDto | undefined, held: Set<string>): SuccessDto | undefined => {
    if (!success) return undefined;
    const flowNode = success.flowNode && held.has(success.flowNode) ? success.flowNode : undefined;
    const flowNodes = (success.flowNodes ?? []).filter(branch => held.has(branch));
    if (!flowNode && !flowNodes.length && !success.mode && !success.compact) return undefined;
    return {
        ...(flowNode ? { flowNode } : {}),
        ...(flowNodes.length ? { flowNodes } : {}),
        ...(success.mode ? { mode: success.mode } : {}),
        ...(success.compact ? { compact: success.compact } : {}),
    };
};

/** The transition without the target: what a class is created with before it is chained. */
const transitionOnly = (success: SuccessDto | undefined): SuccessDto | undefined => {
    if (!success || (!success.mode && !success.compact)) return undefined;
    return {
        ...(success.mode ? { mode: success.mode } : {}),
        ...(success.compact ? { compact: success.compact } : {}),
    };
};

export interface BoardImportResult {
    board: BoardSummary;
    /** Agents and runners the file named that this store does not hold, left unset. */
    droppedRefs: number;
}

/**
 * Replays the file onto a fresh board: the rectangles first, since cards and classes name them;
 * the classes next, chained once they all exist, since a chain names a class already there; the
 * cards in one call, since a chain may name a card of the same call; then the links from cards
 * to the versions they were made from, remapped onto the versions this store minted.
 *
 * An agent or a runner the destination store does not hold is left unset and counted, so a board
 * downloaded elsewhere still imports. Anything else failing takes the board with it: a failed
 * import leaves nothing behind, so it can be tried again.
 */
export const importBoardArchive = async (
    client: HybridflowClient, archive: BoardArchive,
): Promise<BoardImportResult> => {
    const connected = archive.flowNodes.map(node => ({
        id: node.id, title: node.title, type: readType(node.type, {}),
        onSuccess: readSuccess(node.onSuccess),
    }));
    const issue = chainConnectionIssue(connected);
    if (issue) throw new Error(issue);
    const [agents, runners] = await Promise.all([client.agents(), client.runners()]);
    const knownAgents = new Set(agents.map(agent => agent.id));
    const knownRunners = new Set(runners.map(runner => runner.id));
    let droppedRefs = 0;
    const knownAgent = (id: string | undefined): string | undefined => {
        if (!id) return undefined;
        if (knownAgents.has(id)) return id;
        droppedRefs += 1;
        return undefined;
    };
    const knownRunner = (id: string | undefined): string | undefined => {
        if (!id) return undefined;
        if (knownRunners.has(id)) return id;
        droppedRefs += 1;
        return undefined;
    };
    const knownSettings = (settings: SettingsDto | undefined): SettingsDto | undefined => {
        if (!settings) return undefined;
        const agent = knownAgent(settings.agent);
        const runner = knownRunner(settings.runner);
        if (agent === settings.agent && runner === settings.runner) return settings;
        const kept: SettingsDto = { ...settings };
        if (agent) kept.agent = agent;
        else delete kept.agent;
        if (runner) kept.runner = runner;
        else delete kept.runner;
        return kept;
    };

    const made = await client.createBoard(archive.name);
    const handle = made.board.slug;
    try {
        for (const grouping of archive.workflowClasses) {
            await client.createWorkflowClass(handle, { id: grouping.id, name: grouping.name });
        }
        for (const grouping of archive.workflows) {
            await client.createWorkflow(handle, { id: grouping.id, name: grouping.name });
        }
        // The versions the store mints, by the id the file holds: what the cards' links remap onto.
        const versionOf = new Map<string, string>();
        const classChains: [string, string][] = [];
        for (const flowNodeClass of archive.flowNodeClasses) {
            const [first, ...rest] = flowNodeClass.versions;
            const created = await client.createFlowNodeClass(handle, {
                id: flowNodeClass.id,
                title: flowNodeClass.title,
                instantiable: flowNodeClass.instantiable,
                type: flowNodeClass.type,
                tags: flowNodeClass.tags,
                body: first?.body,
                criteria: first?.criteria,
                template: first?.template,
                agent: knownAgent(first?.agent),
                at: flowNodeClass.at,
                duration: flowNodeClass.duration,
                spot: flowNodeClass.spot,
                permission: flowNodeClass.permission,
                runner: knownRunner(flowNodeClass.runner),
                note: flowNodeClass.note,
                onSuccess: transitionOnly(flowNodeClass.onSuccess),
                published: first?.published,
                workflowClass: flowNodeClass.workflowClass,
            });
            if (first?.id && created.versions[0]) {
                versionOf.set(first.id, created.versions[0].id);
            }
            for (const version of rest) {
                const createdVersion = await client.createClassVersion(handle, flowNodeClass.id, {
                    body: version.body,
                    criteria: version.criteria,
                    template: version.template,
                    agent: knownAgent(version.agent),
                });
                if (version.id) versionOf.set(version.id, createdVersion.id);
                if (version.published) {
                    await client.patchClassVersion(handle, flowNodeClass.id, createdVersion.id, {
                        status: 'published',
                    });
                }
            }
            const target = flowNodeClass.onSuccess?.flowNode;
            if (target) classChains.push([flowNodeClass.id, target]);
        }
        for (const [from, to] of classChains) {
            await client.chainFlowNodeClass(handle, from, to);
        }
        if (archive.flowNodes.length) {
            await client.createFlowNodes(handle, archive.flowNodes.map(flowNode => ({
                id: flowNode.id,
                title: flowNode.title,
                type: flowNode.type,
                tags: flowNode.tags,
                body: flowNode.body,
                criteria: flowNode.criteria,
                complexity: flowNode.complexity,
                settings: knownSettings(flowNode.settings),
                at: flowNode.at,
                duration: flowNode.duration,
                spot: flowNode.spot,
                status: flowNode.status,
                archived: flowNode.archived,
                onSuccess: flowNode.onSuccess,
                workflow: flowNode.workflow,
            })));
            for (const flowNode of archive.flowNodes) {
                const version = flowNode.classVersion
                    ? versionOf.get(flowNode.classVersion)
                    : undefined;
                if (flowNode.classVersion && version) {
                    await client.patchFlowNode(handle, flowNode.id, { classVersion: version });
                }
            }
        }
        if (archive.archived) await client.archiveBoard(handle, true);
        return { board: made.board, droppedRefs };
    } catch (cause) {
        await client.deleteBoard(handle).catch(() => undefined);
        throw cause;
    }
};

// ── the file itself ───────────────────────────────────────────────────────────

/** Reads the file as text. A FileReader rather than `blob.text()`: the same promise in every browser. */
export const readFileText = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
        reader.readAsText(file);
    });

/** Offers the text as a file download, named as said. */
export const downloadTextFile = (
    filename: string, text: string, mime = 'application/json',
): void => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
