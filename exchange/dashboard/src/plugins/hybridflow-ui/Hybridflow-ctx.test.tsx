import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from 'src/test/render';

/** The board reads and writes through the hybridflow store, so these run against one held in memory. */

/** The one agent this deployment offers, with the three modes Claude publishes: what a card made on. */
const AGENTS = await vi.hoisted(async () => {
    const { agentOptions } = await import('src/test/agents');
    return [agentOptions({
        models: [{ value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }],
        efforts: [{ value: 'high', label: 'High' }],
    })];
});

vi.mock('@cms-kit/capabilities', () => ({
    useChatOptions: () => ({ agents: AGENTS, optionsFor: () => AGENTS[0] }),
}));

/** The one managed agent this store keeps, on the engine above: what a card made on the board is made. */
vi.mock('./Agents-ctx', () => ({
    useAgents: () => ({
        agents: [{ id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus', published: { platform: 'claude' } }],
        loading: false,
        error: null,
    }),
}));

import { HybridflowProvider, useHybridflow } from './Hybridflow-ctx';
import { FakeHybridflowClient, HybridflowClientProvider } from './service';
import { newFlowNode, readBoardContent, BoardContent } from './boardContent';

const HANDLE = 'major';

type FlowNodeSpec = { id: string; title: string } & Record<string, unknown>;

/** A board of the cards it should show — the shape the service publishes, read by the board's own. */
const boardOf = (...flowNodes: FlowNodeSpec[]): BoardContent => readBoardContent({ flowNodes });

/** One card, as the wire holds it. */
const card = (id: string, title = id, over: Record<string, unknown> = {}): FlowNodeSpec =>
    ({ id, title, ...over });

let service: FakeHybridflowClient;

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <HybridflowClientProvider client={service.asClient()}>
        <HybridflowProvider>{children}</HybridflowProvider>
    </HybridflowClientProvider>
);

const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const openedBoard = async () => {
    const { result } = renderHook(() => useHybridflow(), { wrapper });
    act(() => { result.current.openBoard(HANDLE); });
    await tick();
    return result;
};

type BoardResult = { current: ReturnType<typeof useHybridflow> };

/** What the board is showing — what every assertion here is about. */
const shape = (result: BoardResult) =>
    (result.current.content?.flowNodes ?? []).map(flowNode => flowNode.title);

const flowNodeById = (result: BoardResult, id: string) =>
    (result.current.content?.flowNodes ?? []).find(t => t.id === id);

/** Every call the board has sent, in order. */
const sent = () => service.calls.filter(call => !call.startsWith('board '));

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new FakeHybridflowClient(boardOf(card('t1', 'Write the plan')), HANDLE);
});

afterEach(() => { vi.useRealTimers(); });

describe('Hybridflow – opening and closing', () => {
    it('reads the board again when it is reopened', async () => {
        const result = await openedBoard();
        expect(shape(result)).toEqual(['Write the plan']);

        act(() => { result.current.closeBoard(); });
        service.content = boardOf(card('t1', 'Write the plan'), card('t2', 'Added by hand'));
        act(() => { result.current.openBoard(HANDLE); });
        await tick();

        expect(shape(result)).toEqual(['Write the plan', 'Added by hand']);
    });

    it('leaves an open board alone when it is pointed at the same handle', async () => {
        const result = await openedBoard();

        act(() => { result.current.openBoard(HANDLE); });
        act(() => { result.current.openBoard(HANDLE); });
        await tick();

        expect(service.calls.filter(call => call.startsWith('board '))).toHaveLength(1);
    });

    it('says so when the handle names no board', async () => {
        service.board = async () => { throw Object.assign(new Error('gone'), { status: 404, gone: true }); };
        const { result } = renderHook(() => useHybridflow(), { wrapper });
        act(() => { result.current.openBoard('nowhere'); });
        await tick();

        expect(result.current.content).toBeNull();
        expect(result.current.error).toBeTruthy();
    });
});

describe('Hybridflow – following the board it is open on', () => {
    it('shows a change made while the board sits on it', async () => {
        const result = await openedBoard();

        service.elsewhere(() => boardOf(
            card('t1', 'Write the plan', { status: 'done', body: 'Answered' }),
        ));
        await tick();

        expect(flowNodeById(result, 't1')).toMatchObject({ status: 'done', body: 'Answered' });
    });

    it('shows a card a turn added', async () => {
        const result = await openedBoard();

        service.elsewhere(() => boardOf(
            card('t1', 'Write the plan'), card('t9', 'Added by a turn'),
        ));
        await tick();

        expect(shape(result)).toEqual(['Write the plan', 'Added by a turn']);
    });

    it('reads the board when it is asked to', async () => {
        const result = await openedBoard();

        service.content = boardOf(card('t1', 'Write the plan', { status: 'running' }));
        act(() => { result.current.reloadBoard(); });
        await tick();

        expect(flowNodeById(result, 't1')!.status).toBe('running');
    });

    it('keeps the open flow node through a change arriving from the service', async () => {
        const result = await openedBoard();
        act(() => { result.current.select('t1'); });
        const opened = result.current.openingId;

        service.elsewhere(() => boardOf(card('t1', 'Write the plan', { status: 'done' })));
        await tick();

        expect(result.current.selected).toBe('t1');
        expect(result.current.openingId).toBe(opened);
        expect(result.current.selectedFlowNode!.flowNode.status).toBe('done');
    });
});

describe('Hybridflow – written at both ends at once', () => {
    // The point of the whole thing: starting a play must not stop the next ticket being written, and writing it.
    it('keeps a ticket typed here and a mark made by the run', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'Played'), card('t2', 'Next one')), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.editFlowNode('t2', { title: 'Next one, written up' }); });
        service.elsewhere(() => boardOf(
            card('t1', 'Played', { status: 'done', chat: 'chat-1' }),
            card('t2', 'Next one'),
        ));
        await tick();

        expect(flowNodeById(result, 't1')).toMatchObject({ status: 'done', chat: 'chat-1' });
        expect(flowNodeById(result, 't2')!.title).toBe('Next one, written up');
        // And the write that was sent names the field that was typed and no other: the run's mark was never.
        expect(sent()).toEqual([`patchFlowNode ${HANDLE} t2 title`]);
    });

    it('takes a mark made on the very flow node being read', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'Played', { body: 'Do the thing.' })), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.editFlowNode('t1', { title: 'Played, retitled' }); });
        service.elsewhere(() => boardOf(
            card('t1', 'Played', { body: 'Do the thing.', status: 'done', chat: 'chat-1' }),
        ));
        await tick();

        expect(flowNodeById(result, 't1')!.title).toBe('Played, retitled');
        expect(flowNodeById(result, 't1')!.body).toBe('Do the thing.');
        expect(flowNodeById(result, 't1')!.status).toBe('done');
        expect(flowNodeById(result, 't1')!.chat).toBe('chat-1');
    });

    it('keeps a card placed here while the run was writing the board', async () => {
        service = new FakeHybridflowClient(boardOf(
            card('t1', 'Played', { spot: { x: 0, y: 0 } }),
        ), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.moveSpots(['t1'], 100, 50); });
        service.elsewhere(() => boardOf(card('t1', 'Played', { status: 'done' })));
        await tick();

        expect(flowNodeById(result, 't1')!.spot).toEqual({ x: 100, y: 50 });
        expect(flowNodeById(result, 't1')!.status).toBe('done');
        expect(sent()).toEqual([`patchFlowNode ${HANDLE} t1 spot`]);
    });
});

describe('Hybridflow – what a gesture sends', () => {
    it('sends one call per gesture, naming only what it changed', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'One'), card('t2', 'Two')), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.editFlowNode('t1', { title: 'Renamed' }); });
        act(() => { result.current.setFlowNodeStatus('t1', 'done'); });
        act(() => { result.current.chainFlowNode('t1', 't2'); });
        act(() => { result.current.removeFlowNode('t1'); });
        await tick();

        expect(sent()).toEqual([
            `patchFlowNode ${HANDLE} t1 title`,
            `patchFlowNode ${HANDLE} t1 status`,
            `chainFlowNode ${HANDLE} t1 -> t2`,
            `deleteFlowNodes ${HANDLE} t1`,
        ]);
    });

    it('creates a card under the id it minted for it', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        const made = result.current.selectedFlowNode!.flowNode.id;
        await tick();

        expect(sent()).toEqual([`createFlowNodes ${HANDLE} ${made}`]);
    });

    it('sends nothing for a gesture that found nothing to do', async () => {
        const result = await openedBoard();

        act(() => { result.current.cloneFlowNode('gone'); });
        await tick();

        expect(sent()).toEqual([]);
    });

    it('files a workflow round the cards it names, and opens it', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'One'), card('t2', 'Two')), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.createWorkflow(['t1', 't2']); });
        const filed = result.current.selectedWorkflow;
        await tick();

        expect(filed?.kind).toBe('workflow');
        expect(sent()).toEqual([`createWorkflow ${HANDLE} ${filed!.id}`]);
        expect(result.current.content?.workflows).toEqual([{ id: filed!.id, name: '' }]);
        expect(result.current.content?.flowNodes.map(flowNode => flowNode.workflow))
            .toEqual([filed!.id, filed!.id]);
    });

    it('ungroups the cards of a workflow taken off, and one a delete emptied', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'One'), card('t2', 'Two')), HANDLE);
        const result = await openedBoard();
        act(() => { result.current.createWorkflow(['t1', 't2']); });
        const filed = result.current.selectedWorkflow!.id;
        await tick();

        act(() => { result.current.removeFlowNodes(['t1', 't2']); });
        await tick();

        expect(result.current.content?.workflows).toEqual([]);
        expect(sent()).toContain(`deleteWorkflows ${HANDLE} ${filed}`);
    });
});

describe('Hybridflow – a board written with columns', () => {
    it('reads the cards and leaves the columns behind', async () => {
        service = new FakeHybridflowClient(readBoardContent({
            columns: [{ id: 'col-Todo', title: 'Todo' }],
            flowNodes: [card('t1', 'Write the plan')],
        }), HANDLE);
        const result = await openedBoard();

        expect(shape(result)).toEqual(['Write the plan']);
    });
});

describe('Hybridflow – the open flow node', () => {
    it('opens the flow node it creates', async () => {
        const result = await openedBoard();

        act(() => { result.current.select('t1'); });
        expect(result.current.selectedFlowNode!.flowNode.title).toBe('Write the plan');
        const opened = result.current.openingId;

        act(() => { result.current.addFlowNode('ai', { x: 320, y: 160 }); });

        expect(result.current.selectedFlowNode!.flowNode.spot).toEqual({ x: 320, y: 160 });
        expect(result.current.openingId).toBeGreaterThan(opened);
        expect(shape(result)).toEqual(['Write the plan', '']);
    });

    it('makes a card of the kind picked, at the point on the canvas it was asked for', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('scheduler', { x: 320, y: 160 }); });

        const made = result.current.selectedFlowNode!;
        expect(made.flowNode.type).toBe('scheduler');
        expect(made.flowNode.title).toBe('');
        expect(made.flowNode.spot).toEqual({ x: 320, y: 160 });
        expect(shape(result)).toEqual(['Write the plan', '']);
    });

    it('gives an AI card made on the canvas the store\'s agent, and a Shutdown nothing', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        expect(result.current.selectedFlowNode!.flowNode.settings)
            .toEqual({ agent: 'agent-1', permission: 'bypassPermissions' });

        act(() => { result.current.addFlowNode('shutdown', { x: 0, y: 0 }); });
        expect(result.current.selectedFlowNode!.flowNode.type).toBe('shutdown');
        expect(result.current.selectedFlowNode!.flowNode.settings).toEqual({});
    });

    it('opens the copy a clone makes, not the card it was made from', async () => {
        const result = await openedBoard();

        act(() => { result.current.cloneFlowNode('t1'); });

        expect(shape(result)).toEqual(['Write the plan', 'Write the plan']);
        expect(result.current.selected).not.toBe('t1');
        expect(result.current.selectedFlowNode!.flowNode.id).toBe(result.current.content!.flowNodes[1].id);
    });

    it('leaves the board alone when the card a clone names has gone', async () => {
        const result = await openedBoard();

        act(() => { result.current.cloneFlowNode('nowhere'); });

        expect(shape(result)).toEqual(['Write the plan']);
        expect(result.current.selected).toBeNull();
    });

    it('holds the title focus for the card the canvas menu makes, until the panel takes it', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        expect(result.current.titleCaret).toBe(result.current.selected);

        act(() => { result.current.takeTitleCaret(); });
        expect(result.current.titleCaret).toBeNull();

        act(() => { result.current.addFlowNode('ai', { x: 10, y: 10 }); });
        act(() => { result.current.select('t1'); });
        expect(result.current.titleCaret).toBeNull();
    });

    it('does not count a move as an opening, and keeps the flow node open through it', async () => {
        service = new FakeHybridflowClient(boardOf(
            card('t1', 'Write the plan', { spot: { x: 0, y: 0 } }),
            card('t2', 'Move me', { spot: { x: 400, y: 0 } }),
        ), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.select('t2'); });
        const opened = result.current.openingId;
        act(() => { result.current.moveSpots(['t2'], 100, 50); });

        expect(result.current.selected).toBe('t2');
        expect(result.current.selectedFlowNode!.flowNode.spot).toEqual({ x: 500, y: 50 });
        expect(result.current.openingId).toBe(opened);
        expect(shape(result)).toEqual(['Write the plan', 'Move me']);
    });

    it('closes the large editor when another flow node is opened', async () => {
        service = new FakeHybridflowClient(boardOf(card('t1', 'Write the plan'), card('t2', 'Ship it')), HANDLE);
        const result = await openedBoard();

        act(() => { result.current.select('t1'); });
        act(() => { result.current.setExpanded(true); });
        expect(result.current.expanded).toBe(true);

        act(() => { result.current.select('t2'); });
        expect(result.current.expanded).toBe(false);
    });

    it('closes the panel on a flow node that is deleted', async () => {
        const result = await openedBoard();

        act(() => { result.current.select('t1'); });
        act(() => { result.current.removeFlowNode('t1'); });

        expect(result.current.selected).toBeNull();
        expect(result.current.selectedFlowNode).toBeNull();
    });
});

describe('Hybridflow – where a flow node stands', () => {
    it('says where a flow node stands when the panel says so', async () => {
        const result = await openedBoard();

        act(() => { result.current.setFlowNodeStatus('t1', 'done'); });
        expect(flowNodeById(result, 't1')!.status).toBe('done');

        act(() => { result.current.setFlowNodeStatus('t1', 'ready'); });
        expect(flowNodeById(result, 't1')!.status).toBe('ready');
    });
});

describe('Hybridflow – the cards picked out', () => {
    it('holds exactly the cards the box names', async () => {
        const result = await openedBoard();

        act(() => { result.current.toggleMark('t1'); });
        expect(result.current.marked).toEqual(['t1']);

        act(() => { result.current.setMarked(['t2', 't3']); });
        expect(result.current.marked).toEqual(['t2', 't3']);

        act(() => { result.current.clearMarks(); });
        expect(result.current.marked).toEqual([]);
    });
});

describe('Hybridflow – pasting cards', () => {
    it('files the clipboard’s cards at the end of the board and opens the first', async () => {
        const result = await openedBoard();

        const coming = [newFlowNode('Pasted one'), newFlowNode('Pasted two')];
        act(() => { result.current.insertFlowNodes(coming); });

        expect(shape(result)).toEqual(['Write the plan', 'Pasted one', 'Pasted two']);
        expect(result.current.selected).toBe(coming[0].id);
        await tick();
        expect(sent()).toEqual([`createFlowNodes ${HANDLE} ${coming[0].id},${coming[1].id}`]);
    });
});
