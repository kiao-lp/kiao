/** Board export/import as one JSON file. */

import { readComplexity, readCriteria, readTags } from './boardContent';
import { readDuration, readSchedule } from './flowNodeSchedule';
import { readBitbucketEvent, writeBitbucketEvent } from './flowNodeBitbucket';
import { readLimiter } from './flowNodeLimiter';
import { readStatus } from './flowNodeStatus';
import { readSuccess, saysSuccess, successFor, writeSuccess } from './flowNodeSuccess';
import { readType } from './flowNodeType';
import { readRoutes } from './flowNodeRoutes';
import { upgradeBoardArchiveV1 } from './boardArchiveV1';
import { chainConnectionIssue } from './flowConnections';
import { readSize } from './flowNodeSize';
import type { HybridflowClient } from './service';
import type {
    BoardDetailDto, BoardSummary, CriterionDto, FlowNodeDto, GatewayRoute,
    SettingsDto, SizeDto, SpotDto, SuccessDto, WorkflowDto,
} from './service';

export const BOARD_ARCHIVE_KIND = 'kiao-board';
export const BOARD_ARCHIVE_VERSION = 2;

export interface ArchivedFlowNode {
    id: string;
    title: string;
    type?: string;
    tags?: string[];
    body?: string;
    multiPartTemplate?: boolean;
    note?: string;
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
    onSuccess?: SuccessDto;
    routes?: GatewayRoute[];
    workflow?: string;
}

type ArchivedWorkflow = Pick<WorkflowDto, 'id' | 'name' | 'workflowFolder' | 'files'>;

export interface BoardArchive {
    name: string;
    archived: boolean;
    flowNodes: ArchivedFlowNode[];
    workflows: ArchivedWorkflow[];
}

export const boardArchiveText = (detail: BoardDetailDto): string =>
    JSON.stringify({
        kind: BOARD_ARCHIVE_KIND,
        version: BOARD_ARCHIVE_VERSION,
        name: detail.board.name,
        ...(detail.board.archived ? { archived: true } : {}),
        flowNodes: detail.flowNodes.map(archivedFlowNode),
        workflows: detail.workflows.map(workflow => ({
            id: workflow.id, name: workflow.name, workflowFolder: workflow.workflowFolder, files: workflow.files,
        })),
    }, null, 2);

export const boardArchiveFilename = (slug: string): string => `${slug}.json`;

const archivedFlowNode = (flowNode: FlowNodeDto): ArchivedFlowNode => ({
    id: flowNode.id,
    title: flowNode.title,
    ...(optional(flowNode.type) ? { type: flowNode.type } : {}),
    ...(flowNode.tags?.length ? { tags: flowNode.tags } : {}),
    ...(optional(flowNode.body) ? { body: flowNode.body } : {}),
    ...(flowNode.multiPartTemplate ? { multiPartTemplate: true } : {}),
    ...(optional(flowNode.note) ? { note: flowNode.note } : {}),
    ...(flowNode.criteria?.length ? { criteria: flowNode.criteria } : {}),
    ...(flowNode.complexity !== undefined ? { complexity: flowNode.complexity } : {}),
    ...(flowNode.settings && !emptySettings(flowNode.settings) ? { settings: flowNode.settings } : {}),
    ...(optional(flowNode.at) ? { at: flowNode.at } : {}),
    ...(optional(flowNode.duration) ? { duration: flowNode.duration } : {}),
    ...writeBitbucketEvent(flowNode),
    ...(flowNode.type === 'limiter' ? readLimiter(flowNode) : {}),
    ...(flowNode.spot ? { spot: flowNode.spot } : {}),
    ...(flowNode.size ? { size: flowNode.size } : {}),
    ...(optional(flowNode.status) ? { status: flowNode.status } : {}),
    ...(flowNode.archived ? { archived: true } : {}),
    ...archiveSuccess(flowNode.onSuccess, flowNode.type, flowNode.settings),
    ...(flowNode.routes?.length ? { routes: flowNode.routes } : {}),
    ...(optional(flowNode.workflow) ? { workflow: flowNode.workflow } : {}),
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
    !optional(settings.agent) && !optional(settings.harness) && !optional(settings.profileId) &&
    !optional(settings.model) && !optional(settings.effort)
    && !optional(settings.permission) && !optional(settings.folder) && !optional(settings.runner)
    && !settings.extra;

/** Strict on kind, version, name, and list types. */
export const readBoardArchive = (text: string): BoardArchive | null => {
    const source = parse(text);
    if (!source || source.kind !== BOARD_ARCHIVE_KIND) return null;
    const parsed = source.version === 1 ? upgradeBoardArchiveV1(source) : source;
    if (!parsed || parsed.version !== BOARD_ARCHIVE_VERSION) return null;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) return null;
    if (!Array.isArray(parsed.flowNodes) || !Array.isArray(parsed.workflows)) return null;
    const flowNodes: ArchivedFlowNode[] = [];
    for (const raw of parsed.flowNodes) {
        const flowNode = readArchivedFlowNode(raw);
        if (!flowNode) return null;
        flowNodes.push(flowNode);
    }
    const workflows: ArchivedWorkflow[] = [];
    for (const raw of parsed.workflows) {
        const workflow = readArchivedWorkflow(raw);
        if (!workflow) return null;
        workflows.push(workflow);
    }
    const heldNodes = new Set(flowNodes.map(flowNode => flowNode.id));
    const heldWorkflows = new Set(workflows.map(workflow => workflow.id));
    for (const flowNode of flowNodes) {
        flowNode.onSuccess = chainWithin(flowNode.onSuccess, heldNodes);
        if (flowNode.routes) flowNode.routes = readRoutes(flowNode.routes, flowNode.onSuccess?.flowNodes ?? []);
        if (flowNode.workflow && !heldWorkflows.has(flowNode.workflow)) delete flowNode.workflow;
    }
    return {
        name,
        archived: parsed.archived === true,
        flowNodes, workflows,
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
    const status = readStatus(source.status);
    const chain = chainOf(source.onSuccess);
    const type = text(source.type).trim();
    return {
        id,
        title: text(source.title),
        ...(type ? { type } : {}),
        ...tagsOf(source.tags),
        ...(optional(text(source.body)) ? { body: text(source.body) } : {}),
        ...(source.multiPartTemplate === true ? { multiPartTemplate: true } : {}),
        ...(typeof source.note === 'string' ? { note: source.note } : {}),
        ...criteriaOf(source.criteria),
        ...complexityOf(source.complexity),
        ...settingsOf(source.settings),
        ...scheduleOf(source),
        ...readBitbucketEvent(type, source),
        ...(type === 'limiter' ? readLimiter(source) : {}),
        ...spotOf(source.spot),
        ...sizeOf(source.size),
        status: status === 'running' || status === 'waiting-refresh' ? 'interrupted' : status,
        ...(source.archived === true ? { archived: true } : {}),
        ...chain,
        ...(type === 'exclusive-gateway' ? { routes: readRoutes(source.routes, chain.onSuccess?.flowNodes ?? []) } : {}),
        ...(optional(text(source.workflow)) ? { workflow: text(source.workflow).trim() } : {}),
    };
};

const readArchivedWorkflow = (raw: unknown): ArchivedWorkflow | null => {
    const source = asObject(raw);
    const id = text(source?.id).trim();
    if (!source || !id) return null;
    const { workflowFolder, files } = source;
    if (workflowFolder !== undefined && typeof workflowFolder !== 'string') return null;
    if (files !== undefined && (!Array.isArray(files) || files.some(file => typeof file !== 'string'))) return null;
    return { id, name: text(source.name), ...(workflowFolder ? { workflowFolder } : {}), ...(files?.length ? { files } : {}) };
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
    for (const key of ['agent', 'harness', 'profileId', 'model', 'effort', 'permission', 'folder', 'runner'] as const) {
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

const sizeOf = (raw: unknown): { size?: SizeDto } => {
    const size = readSize(raw);
    return size ? { size } : {};
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

export interface BoardImportResult {
    board: BoardSummary;

    droppedRefs: number;
}

/** Create workflows first, then add the connected nodes in one batch. */
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
        else {
            delete kept.agent;
            delete kept.harness;
            delete kept.profileId;
            delete kept.model;
        }
        if (runner) kept.runner = runner;
        else delete kept.runner;
        return kept;
    };

    const made = await client.createBoard(archive.name);
    const handle = made.board.slug;
    try {
        for (const grouping of archive.workflows) {
            await client.createWorkflow(handle, grouping);
        }
        if (archive.flowNodes.length) {
            await client.createFlowNodes(handle, archive.flowNodes.map(flowNode => ({
                id: flowNode.id,
                title: flowNode.title,
                type: flowNode.type,
                tags: flowNode.tags,
                body: flowNode.body,
                multiPartTemplate: flowNode.multiPartTemplate,
                note: flowNode.note,
                criteria: flowNode.criteria,
                complexity: flowNode.complexity,
                settings: knownSettings(flowNode.settings),
                at: flowNode.at,
                duration: flowNode.duration,
                ...writeBitbucketEvent(flowNode),
                ...(flowNode.type === 'limiter' ? readLimiter(flowNode) : {}),
                spot: flowNode.spot,
                size: flowNode.size,
                status: flowNode.status,
                archived: flowNode.archived,
                onSuccess: flowNode.onSuccess,
                routes: flowNode.routes,
                workflow: flowNode.workflow,
            })));
        }
        if (archive.archived) await client.archiveBoard(handle, true);
        return { board: made.board, droppedRefs };
    } catch (cause) {
        await client.deleteBoard(handle).catch(() => undefined);
        throw cause;
    }
};

/** Uses FileReader for consistent behavior across browsers. */
export const readFileText = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
        reader.readAsText(file);
    });

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
