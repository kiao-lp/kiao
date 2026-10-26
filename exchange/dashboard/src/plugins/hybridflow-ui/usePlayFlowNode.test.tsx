import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentChainRun } from 'kiao-worker';
import { message } from 'antd';
import { readBoardContent } from './boardContent';

// The board's view of the service's run. The loop itself is worker's — what a chain does, how
// an error worth waiting out is waited out, what is filed under a flow node — and it is tested there,
// against a real document and a real turn. What is left to pin here is the reading: which card is
// marked, which button a card carries, and what a run playing *another* board does to this one.

const content = {
    runs: [] as AgentChainRun[],
    play: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    forget: vi.fn(),
};
const board = { handle: null as string | null, content: readBoardContent({}) };

// The run is the `chat.run` capability, whichever plugin published it — the board names the
// contract and never the plugin, so this stubs the contract.
vi.mock('@cms-kit/capabilities', () => ({ useChatRun: () => content }));
vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));

import { usePlayFlowNode, retryClock } from './usePlayFlowNode';

// The board a run names, on the wire to worker: its **handle**.
const HANDLE = 'major';

const running = (over: Partial<AgentChainRun> = {}): AgentChainRun => ({
    id: 'run-1',
    name: 'Started 4 Sep 10:00',
    // The run DTO's field is still called `path`: it is worker's wire name for the handle.
    // — and what it now carries is the handle.
    path: HANDLE,
    rootFlowNodeId: 'flow-node-1',
    flowNodeId: 'flow-node-1',
    chat: 'conv-1',
    state: 'playing',
    startedAt: 1_000,
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    content.runs = [];
    board.handle = HANDLE;
    board.content = readBoardContent({});
});

const play = () => renderHook(() => usePlayFlowNode()).result;

describe('usePlayFlowNode', () => {
    it('names an invalid downstream join without starting a run', () => {
        board.content = readBoardContent({ flowNodes: [
            { id: 'first', title: 'First', onSuccess: { flowNode: 'target' } },
            { id: 'fork', title: 'Fork', type: 'gateway', onSuccess: { flowNodes: ['target'] } },
            { id: 'target', title: 'Target', type: 'shutdown' },
        ] });
        const notice = vi.spyOn(message, 'error').mockReturnValue(undefined as never);
        const result = play();
        act(() => result.current.play('first', 'Invalid'));
        expect(content.play).not.toHaveBeenCalled();
        expect(notice).toHaveBeenCalledWith(expect.stringContaining('“Target” can have only one predecessor'));
        notice.mockRestore();
    });
    it('says nothing is playing when nothing is', () => {
        const result = play();
        expect(result.current.runOn('flow-node-1')).toBeNull();
        expect(result.current.documentAt).toBeNull();
    });

    it('asks the run to play the flow node, on this board, under the name it was given', () => {
        const result = play();
        act(() => result.current.play('flow-node-1', 'Nightly'));

        // Bringing the chat panel up goes with it, and belongs to whoever published the run.
        expect(content.play).toHaveBeenCalledWith(HANDLE, 'flow-node-1', 'Nightly');
    });

    it('marks the card the run is on, and reads out what it is doing', () => {
        content.runs = [running()];
        expect(play().current.runOn('flow-node-1')).toMatchObject({ id: 'run-1', state: 'playing' });

        content.runs = [running({ state: 'compacting' })];
        expect(play().current.runOn('flow-node-1')).toMatchObject({ state: 'compacting' });

        content.runs = [running({ state: 'stopping' })];
        expect(play().current.runOn('flow-node-1')).toMatchObject({ state: 'stopping' });

        content.runs = [running({ state: 'waiting', retryAt: 5_000 })];
        expect(play().current.runOn('flow-node-1')).toMatchObject({ state: 'waiting', retryAt: 5_000 });

        // A usage limit is a wait like the other one and not the same wait: it lasts as long as the
        // window does, and what goes back in at the end of it picks the cut-off turn back up rather
        // than sending the flow node again. The card says something else, so the board is told which.
        content.runs = [running({ state: 'refreshing', retryAt: 9_000 })];
        expect(play().current.runOn('flow-node-1')).toMatchObject({ state: 'refreshing', retryAt: 9_000 });
    });

    // Two chains of one board, on two cards. Each is drawn where it is, and neither makes the other
    // inert: that is the whole of what several runs at once means to a board.
    it('marks each card its own run is on', () => {
        content.runs = [running(), running({ id: 'run-2', name: 'Second', flowNodeId: 'flow-node-9', state: 'waiting', retryAt: 7_000 })];

        const result = play();
        expect(result.current.runOn('flow-node-1')).toMatchObject({ id: 'run-1', state: 'playing' });
        expect(result.current.runOn('flow-node-9')).toMatchObject({ id: 'run-2', name: 'Second', state: 'waiting' });
        expect(result.current.runOn('flow-node-3')).toBeNull();
    });

    // A run playing another document has no card on this board, and no longer says anything about
    // it at all: several boards play at once.
    it('marks nothing for a run playing another board', () => {
        content.runs = [running({ path: 'another-board' })];

        expect(play().current.runOn('flow-node-1')).toBeNull();
    });

    // A suspended run is waiting to be picked back up by a message in its chat, and an ended one is
    // over. Nothing is running in either, so the card shows the mark its last turn left rather than
    // a spinner, and Play is offered again.
    it('shows a suspended or ended run as nothing playing', () => {
        content.runs = [running({ state: 'suspended' })];
        expect(play().current.runOn('flow-node-1')).toBeNull();

        content.runs = [running({ state: 'ended' })];
        expect(play().current.runOn('flow-node-1')).toBeNull();
    });

    it('reports the latest write of this board, so the document is read again', () => {
        content.runs = [
            running({ documentAt: 42 }),
            running({ id: 'run-2', flowNodeId: 'flow-node-9', documentAt: 99 }),
            running({ id: 'run-3', path: 'another-board', documentAt: 500 }),
        ];
        expect(play().current.documentAt).toBe(99);
    });

    it('plays nothing when no board is open', () => {
        board.handle = null;
        const result = play();
        act(() => result.current.play('flow-node-1', 'Nightly'));
        expect(content.play).not.toHaveBeenCalled();
    });

    it('stops the run that holds a card, by its id', () => {
        content.runs = [running()];
        const result = play();
        const on = result.current.runOn('flow-node-1');
        act(() => result.current.stop(on!.id));
        expect(content.stop).toHaveBeenCalledWith('run-1');
    });
});

describe('retryClock', () => {
    it('includes the date for a wait ending today', () => {
        const today = new Date();
        const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 5).getTime();
        expect(retryClock(at)).toMatch(/\b(14|0?2):05\b/);
        expect(retryClock(at)).not.toMatch(/:\d\d:\d\d/);
        expect(retryClock(at)).toContain(new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at));
        expect(retryClock(at)).toContain(new Intl.DateTimeFormat(undefined, { month: 'short' }).format(at));
    });

    it('carries the date where the wait is not today', () => {
        const at = new Date(2026, 0, 2, 14, 5).getTime();
        expect(retryClock(at)).toMatch(/\b(14|0?2):05\b/);
        expect(retryClock(at)).toMatch(/2/);
        expect(retryClock(at).length).toBeGreaterThan(6);
    });
});
