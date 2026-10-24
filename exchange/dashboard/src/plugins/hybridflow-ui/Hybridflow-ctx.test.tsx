import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from 'src/test/render';

/**
 * The board reads and writes through the **hybridflow store**, so these run against one held in
 * memory rather than against a stubbed context: what is under test is a board **being written at
 * both ends at once**, and that is a question about two writers and one store.
 *
 * The fake is the real path and not a shortcut. A gesture runs the pure operation locally *and*
 * sends a call; `service.elsewhere(…)` moves the board under it and wakes the held request the
 * board is watching on, exactly as a run filing an answer does. So every test below goes through
 * the optimistic update, the watch, the re-read and the three-way merge.
 */

/**
 * The one agent this deployment offers, with the three modes Claude publishes: what a card made on
 * the board is made with is read off it, so the `chat.options` capability stands in here as the
 * contract rather than as a plugin.
 */
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

/**
 * The one managed agent this store keeps, on the engine above: what a card made on the board is
 * made with is read off it.
 */
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

/**
 * A board of the cards it should show — the shape the service publishes, read by the board's own
 * reader.
 */
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

/** Every call the board has sent, in order. What a gesture asked the service for. */
const sent = () => service.calls.filter(call => !call.startsWith('board '));

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new FakeHybridflowClient(boardOf(card('t1', 'Write the plan')), HANDLE);
});

afterEach(() => { vi.useRealTimers(); });

describe('Hybridflow – opening and closing', () => {
    // The board may have been rewritten while it was away — by a played turn, by another tab — and a
    // board that came back holding what it read the first time would write that away.
    it('reads the board again when it is reopened', async () => {
        const result = await openedBoard();
        expect(shape(result)).toEqual(['Write the plan']);

        act(() => { result.current.closeBoard(); });
        service.content = boardOf(card('t1', 'Write the plan'), card('t2', 'Added by hand'));
        act(() => { result.current.openBoard(HANDLE); });
        await tick();

        expect(shape(result)).toEqual(['Write the plan', 'Added by hand']);
    });

    // Pointing the board at what it is already showing is what the view does on every render.
    it('leaves an open board alone when it is pointed at the same handle', async () => {
        const result = await openedBoard();

        act(() => { result.current.openBoard(HANDLE); });
        act(() => { result.current.openBoard(HANDLE); });
        await tick();

        expect(service.calls.filter(call => call.startsWith('board '))).toHaveLength(1);
    });

    // A handle naming no board is a stale link or a typed URL, and it says so rather than drawing an
    // empty board somebody would start typing into.
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
    // A run files an answer into the very board on screen. Nothing here asked for the read: the
    // board is watched while it is open, and the held request comes back the moment it moves.
    it('shows a change made while the board sits on it', async () => {
        const result = await openedBoard();

        service.elsewhere(() => boardOf(
            card('t1', 'Write the plan', { status: 'done', body: 'Answered' }),
        ));
        await tick();

        expect(flowNodeById(result, 't1')).toMatchObject({ status: 'done', body: 'Answered' });
    });

    // A turn holding the `hybridflow` skill rewrites the board it was told about; the card it
    // added is on screen without anybody reopening it.
    it('shows a card a turn added', async () => {
        const result = await openedBoard();

        service.elsewhere(() => boardOf(
            card('t1', 'Write the plan'), card('t9', 'Added by a turn'),
        ));
        await tick();

        expect(shape(result)).toEqual(['Write the plan', 'Added by a turn']);
    });

    // Asking for it now, which is what a client does when it has just been told a run wrote
    // something and does not want to wait for its own watch to come round.
    it('reads the board when it is asked to', async () => {
        const result = await openedBoard();

        service.content = boardOf(card('t1', 'Write the plan', { status: 'running' }));
        act(() => { result.current.reloadBoard(); });
        await tick();

        expect(flowNodeById(result, 't1')!.status).toBe('running');
    });

    // A card that shut itself every time a run marked a card would make a board unusable during a
    // run: the panel is on a flow node, not on a version of the board.
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
    // The point of the whole thing: starting a play must not stop the next ticket being written, and
    // writing it must not throw away the mark the play made.
    it('keeps a ticket typed here and a mark made by the run', async () => {
        service = new FakeHybridflowClient(
            boardOf(card('t1', 'Played'), card('t2', 'Next one')), HANDLE);
        const result = await openedBoard();

        // Typed here: the local operation has run and the patch is on its way.
        act(() => { result.current.editFlowNode('t2', { title: 'Next one, written up' }); });
        // And meanwhile the run marks the flow node it played: what it said is in the conversation now,
        // and the card says done.
        service.elsewhere(() => boardOf(
            card('t1', 'Played', { status: 'done', chat: 'chat-1' }),
            card('t2', 'Next one'),
        ));
        await tick();

        expect(flowNodeById(result, 't1')).toMatchObject({ status: 'done', chat: 'chat-1' });
        expect(flowNodeById(result, 't2')!.title).toBe('Next one, written up');
        // And the write that was sent names the field that was typed and no other: the run's mark
        // was never this board's to write, so nothing here could have written over it.
        expect(sent()).toEqual([`patchFlowNode ${HANDLE} t2 title`]);
    });

    // The mark lands on the very flow node being read, and the description it sent stays.
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

    // Nothing about a play moves a card, so a card placed here is not undone by the play's write.
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
    // Each gesture names what it did. This is the half of the design a whole-board save could not
    // have: a rename writes a title, and nothing else of the card goes over the wire.
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

    // A card is created with the id the editor minted, so the card on screen and the row in the
    // database are the same card — and the panel is opened on it before the call has come back.
    it('creates a card under the id it minted for it', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        const made = result.current.selectedFlowNode!.flowNode.id;
        await tick();

        expect(sent()).toEqual([`createFlowNodes ${HANDLE} ${made}`]);
    });

    // A gesture that finds nothing to do sends nothing: a clone of a card that has gone is not a
    // request to create something.
    it('sends nothing for a gesture that found nothing to do', async () => {
        const result = await openedBoard();

        act(() => { result.current.cloneFlowNode('gone'); });
        await tick();

        expect(sent()).toEqual([]);
    });

    // Filing a workflow: one call, the id the editor minted — the rectangle arrives unnamed,
    // and the board opens it so the panel it shows is where it is named.
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

    // Taking the rectangle off ungroups its cards locally and sends the one call; a delete that
    // empties a rectangle takes it off the service too.
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
    // The reading stays forgiving: what the *service* publishes is the cards, but the reader is
    // also what a paste from another instance goes through. A board arriving the old way is its
    // cards, and the filing is left behind.
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
    // A new flow node goes in at the end, which is where the open one already was: the id alone cannot
    // tell the panel that what it is showing has been replaced, so the opening is counted.
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

    // The canvas's own menu: the kind is picked rather than a title typed, so what arrives is an
    // untitled card of that kind, at the point it was asked for.
    it('makes a card of the kind picked, at the point on the canvas it was asked for', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('scheduler', { x: 320, y: 160 }); });

        const made = result.current.selectedFlowNode!;
        expect(made.flowNode.type).toBe('scheduler');
        expect(made.flowNode.title).toBe('');
        expect(made.flowNode.spot).toEqual({ x: 320, y: 160 });
        expect(shape(result)).toEqual(['Write the plan', '']);
    });

    // An AI card made there is the store's first agent and the mode it answers its own tool calls in.
    it('gives an AI card made on the canvas the store\'s agent, and a Shutdown nothing', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        expect(result.current.selectedFlowNode!.flowNode.settings)
            .toEqual({ agent: 'agent-1', permission: 'bypassPermissions' });

        // And the two the board plays to itself are asked nothing at all — a permission mode on a
        // card no agent is ever handed is an answer to a question it is not asked.
        act(() => { result.current.addFlowNode('shutdown', { x: 0, y: 0 }); });
        expect(result.current.selectedFlowNode!.flowNode.type).toBe('shutdown');
        expect(result.current.selectedFlowNode!.flowNode.settings).toEqual({});
    });

    // The clone is the card the panel should be showing after the gesture: two cards reading the
    // same thing, and the one just made is the one being told apart from the other.
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

    // The focus asked for by a card the canvas menu makes: the menu picked a kind rather than a
    // title, so the panel the card opens in takes the title box without a click first.
    it('holds the title focus for the card the canvas menu makes, until the panel takes it', async () => {
        const result = await openedBoard();

        act(() => { result.current.addFlowNode('ai', { x: 0, y: 0 }); });
        expect(result.current.titleCaret).toBe(result.current.selected);

        act(() => { result.current.takeTitleCaret(); });
        expect(result.current.titleCaret).toBeNull();

        // And opening another flow node drops a focus nobody is going to claim.
        act(() => { result.current.addFlowNode('ai', { x: 10, y: 10 }); });
        act(() => { result.current.select('t1'); });
        expect(result.current.titleCaret).toBeNull();
    });

    // Moving the open flow node is not opening it again: it is the same flow node, and the panel has a caret
    // in it. Nothing has to follow the move either — a flow node is its id, not its spot.
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

    // The large editor is an editor of the flow node it was opened on, and the board opens it on the
    // flow node the double-click landed on: another opening arriving is another flow node.
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
    // A flow node marked in error that has since been dealt with is one somebody sets back.
    it('says where a flow node stands when the panel says so', async () => {
        const result = await openedBoard();

        act(() => { result.current.setFlowNodeStatus('t1', 'done'); });
        expect(flowNodeById(result, 't1')!.status).toBe('done');

        act(() => { result.current.setFlowNodeStatus('t1', 'ready'); });
        expect(flowNodeById(result, 't1')!.status).toBe('ready');
    });
});

describe('Hybridflow – the cards picked out', () => {
    // What the box drawn on the canvas writes, live, as it moves: exactly the cards in it,
    // and nothing left of the set before it.
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
