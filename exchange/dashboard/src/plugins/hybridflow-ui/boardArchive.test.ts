import { describe, it, expect } from 'vitest';

/**
 * One board in one file, and back: what the download writes is what the import replays — the
 * cards with their chains, the classes with their versions, the rectangles round them — and what
 * names something outside the board is left behind: the chats, the runs, the revisions, and the
 * agents and runners the destination store does not hold.
 */
import {
    BOARD_ARCHIVE_KIND, BOARD_ARCHIVE_VERSION, boardArchiveFilename, boardArchiveText,
    importBoardArchive, readBoardArchive,
} from './boardArchive';
import { HybridflowError } from './service';
import type {
    AgentDto, BoardDetailDto, BoardSummary, ClassVersionDto, FlowNodeClassDto, FlowNodeDto,
    RunnerDto, WorkflowClassDto, WorkflowDto,
} from './service';

const summary = (over: Partial<BoardSummary> = {}): BoardSummary => ({
    id: 'board-id', name: 'Major', slug: 'major',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
    revision: 3, archived: false,
    ...over,
});

const flowNode = (over: Partial<FlowNodeDto> & { id: string }): FlowNodeDto => ({
    title: `card ${over.id}`, type: 'ai', status: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    ...over,
});

const version = (over: Partial<ClassVersionDto> & { id: string }): ClassVersionDto => ({
    number: 1, status: 'published',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    ...over,
});

const flowNodeClass = (over: Partial<FlowNodeClassDto> & { id: string }): FlowNodeClassDto => ({
    title: `class ${over.id}`, type: 'ai', versions: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    ...over,
});

const detail = (over: Partial<BoardDetailDto> = {}): BoardDetailDto => ({
    board: summary(), flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [],
    cursor: 7,
    ...over,
});

describe('boardArchiveText', () => {
    it('writes the board as one marked document, without the revisions and timestamps', () => {
        const text = boardArchiveText(detail({
            board: summary({ name: 'Major', archived: true }),
            flowNodes: [flowNode({ id: 'card-1' })],
        }));

        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed.kind).toBe(BOARD_ARCHIVE_KIND);
        expect(parsed.version).toBe(BOARD_ARCHIVE_VERSION);
        expect(parsed.name).toBe('Major');
        expect(parsed.archived).toBe(true);
        expect(text).not.toContain('revision');
        expect(text).not.toContain('createdAt');
        expect(text).not.toContain('updatedAt');
        expect(text).not.toContain('cursor');
    });

    it('keeps what a card says and drops what names something outside the board', () => {
        const text = boardArchiveText(detail({
            flowNodes: [flowNode({
                id: 'card-1', title: 'First', type: 'ai', tags: ['majeur'],
                body: 'Do it', criteria: [{ id: 'crit-1', text: 'Done' }], complexity: 3,
                settings: { agent: 'agent-1', effort: 'high', permission: 'manual', folder: '/' },
                spot: { x: 10, y: 20 }, status: 'done', archived: true,
                chat: 'chat-1', run: 'run-1',
                onSuccess: { flowNode: 'card-2', mode: 'continue', compact: true },
                classVersion: {
                    classId: 'class-1', classTitle: 'First class',
                    versionId: 'version-1', versionNumber: 1,
                },
                workflow: 'workflow-1',
            })],
        }));

        const parsed = JSON.parse(text) as { flowNodes: Record<string, unknown>[] };
        expect(parsed.flowNodes).toEqual([{
            id: 'card-1', title: 'First', type: 'ai', tags: ['majeur'],
            body: 'Do it', criteria: [{ id: 'crit-1', text: 'Done' }], complexity: 3,
            settings: { agent: 'agent-1', effort: 'high', permission: 'manual', folder: '/' },
            spot: { x: 10, y: 20 }, status: 'done', archived: true,
            onSuccess: { flowNode: 'card-2', mode: 'continue', compact: true },
            classVersion: 'version-1',
            workflow: 'workflow-1',
        }]);
    });

    it('keeps the classes with their versions, published or draft', () => {
        const text = boardArchiveText(detail({
            flowNodeClasses: [flowNodeClass({
                id: 'class-1', title: 'First class', instantiable: true, type: 'ai',
                tags: ['reuse'], spot: { x: 1, y: 2 },
                onSuccess: { flowNode: 'class-2', mode: 'end' },
                permission: 'manual', runner: 'runner-1', note: 'For later',
                workflowClass: 'workflow-class-1',
                versions: [
                    version({ id: 'version-1', number: 1, body: 'First words', status: 'published' }),
                    version({
                        id: 'version-2', number: 2, body: 'Second words', template: true,
                        agent: 'agent-1', status: 'draft',
                    }),
                ],
            })],
            workflows: [{ id: 'workflow-1', name: 'Round', createdAt: '', updatedAt: '', revision: 1 }],
            workflowClasses: [{
                id: 'workflow-class-1', name: 'Rounds', createdAt: '', updatedAt: '', revision: 1,
            }],
        }));

        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed.flowNodeClasses).toEqual([{
            id: 'class-1', title: 'First class', instantiable: true, type: 'ai',
            tags: ['reuse'], spot: { x: 1, y: 2 },
            onSuccess: { flowNode: 'class-2', mode: 'end' },
            permission: 'manual', runner: 'runner-1', note: 'For later',
            workflowClass: 'workflow-class-1',
            versions: [
                { id: 'version-1', body: 'First words', published: true },
                {
                    id: 'version-2', body: 'Second words', template: true,
                    agent: 'agent-1', published: false,
                },
            ],
        }]);
        expect(parsed.workflows).toEqual([{ id: 'workflow-1', name: 'Round' }]);
        expect(parsed.workflowClasses).toEqual([{ id: 'workflow-class-1', name: 'Rounds' }]);
    });

    it('names the file after the handle', () => {
        expect(boardArchiveFilename('major')).toBe('major.json');
    });
});

describe('readBoardArchive', () => {
    it('reads back what the export wrote', () => {
        const archive = readBoardArchive(boardArchiveText(detail({
            board: summary({ name: 'Major' }),
            flowNodes: [flowNode({
                id: 'card-1', title: 'First',
                onSuccess: { flowNode: 'card-2' }, workflow: 'workflow-1',
            }), flowNode({ id: 'card-2', title: 'Second' })],
            workflows: [{ id: 'workflow-1', name: 'Round', createdAt: '', updatedAt: '', revision: 1 }],
        })));

        expect(archive?.name).toBe('Major');
        expect(archive?.flowNodes.map(flowNode => flowNode.id)).toEqual(['card-1', 'card-2']);
        expect(archive?.flowNodes[0].onSuccess).toEqual({ flowNode: 'card-2' });
        expect(archive?.flowNodes[0].workflow).toBe('workflow-1');
    });

    it.each([
        ['not json at all', 'not a board download'],
        ['another document', JSON.stringify({ kind: 'kiao-flow-nodes', version: 1 })],
        ['another version', JSON.stringify({ kind: BOARD_ARCHIVE_KIND, version: 99, name: 'X' })],
        ['no name', JSON.stringify({ kind: BOARD_ARCHIVE_KIND, version: 1 })],
        ['no lists', JSON.stringify({ kind: BOARD_ARCHIVE_KIND, version: 1, name: 'X' })],
    ])('refuses %s', (_what, text) => {
        expect(readBoardArchive(text)).toBeNull();
    });

    it.each([
        ['a card without an id', { flowNodes: [{ title: 'Nobody' }] }],
        ['a class without an id', { flowNodeClasses: [{ title: 'Nobody' }] }],
        ['a workflow without an id', { workflows: [{ name: 'Nowhere' }] }],
        ['a malformed card', { flowNodes: ['card-1'] }],
    ])('refuses %s', (_what, lists) => {
        const text = JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [], ...lists,
        });
        expect(readBoardArchive(text)).toBeNull();
    });

    it('settles a card downloaded mid-play as interrupted', () => {
        const text = JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [
                { id: 'card-1', title: 'Running', status: 'running' },
                { id: 'card-2', title: 'Waiting', status: 'waiting-refresh' },
                { id: 'card-3', title: 'Ready', status: 'ready' },
                { id: 'card-4', title: 'Unknown', status: 'flying' },
            ],
            flowNodeClasses: [], workflows: [], workflowClasses: [],
        });

        const archive = readBoardArchive(text);
        expect(archive?.flowNodes.map(flowNode => flowNode.status)).toEqual(
            ['interrupted', 'interrupted', 'ready', 'ready']);
    });

    it('drops references the file does not hold, keeping the transitions', () => {
        const text = JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [{
                id: 'card-1', title: 'First',
                onSuccess: { flowNode: 'card-gone', flowNodes: ['card-2', 'card-gone'], mode: 'continue' },
                workflow: 'workflow-gone', classVersion: 'version-gone',
            }, { id: 'card-2', title: 'Second' }],
            flowNodeClasses: [{
                id: 'class-1', title: 'First class',
                onSuccess: { flowNode: 'class-gone' }, workflowClass: 'grouping-gone', versions: [],
            }],
            workflows: [], workflowClasses: [],
        });

        const archive = readBoardArchive(text);
        expect(archive?.flowNodes[0].onSuccess).toEqual({ flowNodes: ['card-2'], mode: 'continue' });
        expect(archive?.flowNodes[0].workflow).toBeUndefined();
        expect(archive?.flowNodes[0].classVersion).toBeUndefined();
        expect(archive?.flowNodeClasses[0].onSuccess).toBeUndefined();
        expect(archive?.flowNodeClasses[0].workflowClass).toBeUndefined();
    });
});

/** The store the import replays against: records the calls, mints what the service mints. */
const stubClient = (over: {
    agents?: AgentDto[]; runners?: RunnerDto[]; failOn?: string; taken?: boolean;
} = {}) => {
    const calls: string[] = [];
    const mintedVersions: Record<string, ClassVersionDto> = {};
    const agent = (id: string): AgentDto => ({
        id, name: id, platform: 'muse',
        createdAt: '', updatedAt: '', revision: 1,
    });
    const runner = (id: string): RunnerDto => ({ id, name: id, createdAt: '', updatedAt: '', revision: 1 });
    const fail = (call: string) => {
        if (over.failOn === call) throw new Error(`failed on ${call}`);
    };
    return {
        calls,
        agents: async () => { calls.push('agents'); return over.agents ?? []; },
        runners: async () => { calls.push('runners'); return over.runners ?? []; },
        createBoard: async (name: string) => {
            calls.push(`createBoard ${name}`);
            if (over.taken) throw new HybridflowError(409, 'board name is taken');
            return detail({ board: summary({ name, slug: 'imported' }) });
        },
        createWorkflowClass: async (_handle: string, grouping: { id?: string }) => {
            calls.push(`createWorkflowClass ${grouping.id}`);
            fail('createWorkflowClass');
            return { id: grouping.id } as WorkflowClassDto;
        },
        createWorkflow: async (_handle: string, grouping: { id?: string }) => {
            calls.push(`createWorkflow ${grouping.id}`);
            fail('createWorkflow');
            return { id: grouping.id } as WorkflowDto;
        },
        createFlowNodeClass: async (_handle: string, flowNodeClass: Record<string, unknown>) => {
            calls.push(`createFlowNodeClass ${String(flowNodeClass.id)}`);
            fail('createFlowNodeClass');
            const made = version({ id: `new-${String(flowNodeClass.id)}-v1`, number: 1 });
            mintedVersions[String(flowNodeClass.id)] = made;
            return { id: flowNodeClass.id, versions: [made] } as FlowNodeClassDto;
        },
        createClassVersion: async (_handle: string, classId: string) => {
            calls.push(`createClassVersion ${classId}`);
            fail('createClassVersion');
            return version({ id: `new-${classId}-v2`, number: 2 });
        },
        patchClassVersion: async (
            _handle: string, classId: string, versionId: string, patch: Record<string, unknown>,
        ) => {
            calls.push(`patchClassVersion ${classId} ${versionId} ${String(patch.status)}`);
            return undefined as unknown as ClassVersionDto;
        },
        chainFlowNodeClass: async (_handle: string, fromId: string, toId: string) => {
            calls.push(`chainFlowNodeClass ${fromId} -> ${toId}`);
            return undefined as unknown as FlowNodeClassDto;
        },
        createFlowNodes: async (_handle: string, flowNodes: { id?: string }[]) => {
            calls.push(`createFlowNodes ${flowNodes.map(flowNode => flowNode.id).join(',')}`);
            fail('createFlowNodes');
            return [];
        },
        patchFlowNode: async (_handle: string, flowNodeId: string, patch: Record<string, unknown>) => {
            calls.push(`patchFlowNode ${flowNodeId} classVersion=${String(patch.classVersion)}`);
            return undefined as unknown as FlowNodeDto;
        },
        archiveBoard: async (handle: string, archive: boolean) => {
            calls.push(`archiveBoard ${handle} ${archive}`);
            return summary();
        },
        deleteBoard: async (handle: string) => { calls.push(`deleteBoard ${handle}`); },
        agent, runner,
    };
};

describe('importBoardArchive', () => {
    it('replays the rectangles, the classes with their versions, then the cards in one call', async () => {
        const client = stubClient({ agents: [], runners: [] });
        const archive = readBoardArchive(boardArchiveText(detail({
            flowNodes: [flowNode({
                id: 'card-1', title: 'First', workflow: 'workflow-1',
                onSuccess: { flowNode: 'card-2' },
                classVersion: {
                    classId: 'class-1', classTitle: 'First class',
                    versionId: 'version-1', versionNumber: 1,
                },
            }), flowNode({ id: 'card-2', title: 'Second' })],
            flowNodeClasses: [flowNodeClass({
                id: 'class-1', title: 'First class', workflowClass: 'grouping-1',
                onSuccess: { flowNode: 'class-2' },
                versions: [
                    version({ id: 'version-1', number: 1, body: 'First', status: 'published' }),
                    version({ id: 'version-2', number: 2, body: 'Second', status: 'published' }),
                ],
            }), flowNodeClass({
                id: 'class-2', title: 'Second class',
                versions: [version({ id: 'version-3', number: 1, status: 'draft' })],
            })],
            workflows: [{ id: 'workflow-1', name: 'Round', createdAt: '', updatedAt: '', revision: 1 }],
            workflowClasses: [{
                id: 'grouping-1', name: 'Rounds', createdAt: '', updatedAt: '', revision: 1,
            }],
        })))!;

        const { board, droppedRefs } = await importBoardArchive(
            client as never, archive);

        expect(board.slug).toBe('imported');
        expect(droppedRefs).toBe(0);
        expect(client.calls).toEqual([
            'agents', 'runners',
            'createBoard Major',
            'createWorkflowClass grouping-1',
            'createWorkflow workflow-1',
            'createFlowNodeClass class-1',
            'createClassVersion class-1',
            'patchClassVersion class-1 new-class-1-v2 published',
            'createFlowNodeClass class-2',
            'chainFlowNodeClass class-1 -> class-2',
            'createFlowNodes card-1,card-2',
            'patchFlowNode card-1 classVersion=new-class-1-v1',
        ]);
    });

    it('leaves unknown agents and runners unset and says how many', async () => {
        const held = stubClient();
        const client = stubClient({
            agents: [held.agent('agent-here')], runners: [held.runner('runner-here')],
        });
        const seen: { settings?: unknown; agent?: unknown; runner?: unknown }[] = [];
        const recording = {
            ...client,
            createFlowNodes: async (handle: string, flowNodes: { id?: string }[]) => {
                for (const flowNode of flowNodes) {
                    seen.push({ settings: (flowNode as { settings?: unknown }).settings });
                }
                return client.createFlowNodes(handle, flowNodes);
            },
            createFlowNodeClass: async (handle: string, flowNodeClass: Record<string, unknown>) => {
                seen.push({ agent: flowNodeClass.agent, runner: flowNodeClass.runner });
                return client.createFlowNodeClass(handle, flowNodeClass);
            },
        };
        const archive = readBoardArchive(JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [
                {
                    id: 'card-1', title: 'First',
                    settings: { agent: 'agent-here', runner: 'runner-here' },
                },
                {
                    id: 'card-2', title: 'Second',
                    settings: { agent: 'agent-gone', runner: 'runner-gone' },
                },
            ],
            flowNodeClasses: [{
                id: 'class-1', title: 'First class', runner: 'runner-gone',
                versions: [{ id: 'version-1', agent: 'agent-gone', published: true }],
            }],
            workflows: [], workflowClasses: [],
        }))!;

        const { droppedRefs } = await importBoardArchive(recording as never, archive);

        expect(droppedRefs).toBe(4);
        expect(seen).toContainEqual({ settings: { agent: 'agent-here', runner: 'runner-here' } });
        expect(seen).toContainEqual({ settings: {} });
        expect(seen).toContainEqual({ agent: undefined, runner: undefined });
    });

    it('keeps the archived boards put away', async () => {
        const client = stubClient();
        const archive = readBoardArchive(JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major', archived: true,
            flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [],
        }))!;

        await importBoardArchive(client as never, archive);

        expect(client.calls).toContain('archiveBoard imported true');
    });

    it('takes the board with it when the replay fails halfway', async () => {
        const client = stubClient({ failOn: 'createFlowNodes' });
        const archive = readBoardArchive(JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [{ id: 'card-1', title: 'First' }],
            flowNodeClasses: [], workflows: [], workflowClasses: [],
        }))!;

        await expect(importBoardArchive(client as never, archive))
            .rejects.toThrow('failed on createFlowNodes');
        expect(client.calls).toContain('deleteBoard imported');
    });

    it('leaves nothing to take when the name is already held', async () => {
        const client = stubClient({ taken: true });
        const archive = readBoardArchive(JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [],
        }))!;

        await expect(importBoardArchive(client as never, archive))
            .rejects.toMatchObject({ status: 409 });
        expect(client.calls).not.toContain('deleteBoard imported');
    });

    it('imports an empty board without creating cards', async () => {
        const client = stubClient();
        const archive = readBoardArchive(JSON.stringify({
            kind: BOARD_ARCHIVE_KIND, version: BOARD_ARCHIVE_VERSION, name: 'Major',
            flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [],
        }))!;

        await importBoardArchive(client as never, archive);

        expect(client.calls).toEqual(['agents', 'runners', 'createBoard Major']);
    });
});
