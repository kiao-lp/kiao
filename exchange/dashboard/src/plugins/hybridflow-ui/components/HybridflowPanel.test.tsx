import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AgentRun } from '@cms-kit/capabilities';

/**
 * The panel that lists the runs. What it is for is the case where **nothing on screen would say
 * so**: three chains under way on two boards, neither of them the board being looked at. So what
 * is pinned here is that it draws them without holding a single board — the chain travels
 * with the run — and that each of the four actions names the run it is asked of.
 */

const runner = vi.hoisted(() => ({
    runs: [] as AgentRun[],
    play: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    forget: vi.fn(),
}));
const showChat = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ open: vi.fn(), openInNewTab: vi.fn(), openInNewWindow: vi.fn() }));

vi.mock('@cms-kit/capabilities', () => ({
    useChatRun: () => runner,
    useShowChat: () => showChat,
}));

vi.mock('@cms-core', async () => ({ useNavigation: () => nav, Tooltip: (await import('antd')).Tooltip }));

const { HybridflowPanel } = await import('./HybridflowPanel');

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
    id: 'run-1',
    name: 'Nightly',
    path: 'major',
    rootFlowNodeId: 'flow-node-1',
    flowNodeId: 'flow-node-1',
    chat: 'conv-1',
    state: 'playing',
    startedAt: 1_000,
    flowNodes: [
        { id: 'flow-node-1', title: 'Write the plan', status: 'running', current: true },
        { id: 'flow-node-2', title: 'Do it', status: 'ready' },
    ],
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    runner.runs = [];
});

describe('HybridflowPanel', () => {
    it('says how to start one when nothing has been played', () => {
        render(<HybridflowPanel />);
        expect(screen.getByTestId('chain-runs-panel')).toHaveTextContent('No chain run has been played yet');
    });

    // The name is the whole of what tells two runs of one board apart, so it is the row.
    it('names each run and says what it is doing', () => {
        runner.runs = [run(), run({ id: 'run-2', name: 'Cleanup', state: 'waiting', retryAt: 5_000 })];
        render(<HybridflowPanel />);

        expect(screen.getByTestId('chain-run-run-1')).toHaveTextContent('Nightly');
        expect(screen.getByTestId('chain-run-run-1')).toHaveTextContent('Playing');
        const second = screen.getByTestId('chain-run-run-2');
        expect(second).toHaveTextContent('Cleanup');
        expect(second).toHaveTextContent('Waiting to try again');
    });

    // The chain travels with the run, so the flow nodes are drawn for a board this panel never opened.
    it('opens into the cards of the chain, with where each of them stands', () => {
        runner.runs = [run()];
        render(<HybridflowPanel />);

        expect(screen.getByTestId('chain-run-flow-node-flow-node-1')).toHaveTextContent('Write the plan');
        expect(screen.getByTestId('chain-run-flow-node-status-flow-node-1')).toHaveTextContent('In progress');
        expect(screen.getByTestId('chain-run-flow-node-status-flow-node-2')).toHaveTextContent('Ready');
        // The card the run is on is marked as such: two cards can wear one status and be on either
        // side of where the run stands.
        expect(screen.getByTestId('chain-run-flow-node-flow-node-1')).toHaveAttribute('data-current', 'true');
        expect(screen.getByTestId('chain-run-flow-node-flow-node-2')).not.toHaveAttribute('data-current');
    });

    it('folds a run away and back', () => {
        runner.runs = [run()];
        render(<HybridflowPanel />);

        fireEvent.click(screen.getByTestId('chain-run-toggle-run-1'));
        expect(screen.queryByTestId('chain-run-flow-node-flow-node-1')).toBeNull();

        fireEvent.click(screen.getByTestId('chain-run-toggle-run-1'));
        expect(screen.getByTestId('chain-run-flow-node-flow-node-1')).toBeInTheDocument();
    });

    // A run that has ended is a line of history until it is asked about, and a live one is the
    // question the panel was opened with.
    it('starts an ended run folded', () => {
        runner.runs = [run({ state: 'ended', endedAt: 2_000, ending: 'The chain ends here.' })];
        render(<HybridflowPanel />);

        expect(screen.queryByTestId('chain-run-flow-node-flow-node-1')).toBeNull();
        expect(screen.getByTestId('chain-run-run-1')).toHaveTextContent('The chain ends here.');
    });

    it('stops a live run, and offers no restart on one', () => {
        runner.runs = [run()];
        render(<HybridflowPanel />);

        fireEvent.click(screen.getByTestId('chain-run-stop-run-1'));
        expect(runner.stop).toHaveBeenCalledWith('run-1');
        expect(screen.queryByTestId('chain-run-restart-run-1')).toBeNull();
    });

    it('restarts and forgets an ended run, and offers no stop on one', () => {
        runner.runs = [run({ state: 'ended', endedAt: 2_000 })];
        render(<HybridflowPanel />);

        expect(screen.queryByTestId('chain-run-stop-run-1')).toBeNull();
        fireEvent.click(screen.getByTestId('chain-run-restart-run-1'));
        expect(runner.restart).toHaveBeenCalledWith('run-1');
        fireEvent.click(screen.getByTestId('chain-run-forget-run-1'));
        expect(runner.forget).toHaveBeenCalledWith('run-1');
    });

    // A run stopped with its chat is picked back up by saying something there — and from here, which
    // is where somebody looking at the list of plays actually is.
    it('picks a suspended run back up', () => {
        runner.runs = [run({ state: 'suspended' })];
        render(<HybridflowPanel />);

        fireEvent.click(screen.getByTestId('chain-run-resume-run-1'));
        expect(runner.resume).toHaveBeenCalledWith('run-1');
    });

    it('opens the board a run plays, and the chat it plays it in', () => {
        runner.runs = [run()];
        render(<HybridflowPanel />);

        fireEvent.click(screen.getByTestId('chain-run-open-run-1'));
        expect(nav.open).toHaveBeenCalledWith('/boards/major');

        fireEvent.click(screen.getByTestId('chain-run-chat-run-1'));
        expect(showChat).toHaveBeenCalledWith('conv-1');
    });

    // What somebody opening the panel came to see is what is playing right now, not an hour of
    // finished work above it.
    it('puts the newest run at the top', () => {
        runner.runs = [run({ id: 'run-1', name: 'First' }), run({ id: 'run-2', name: 'Second' })];
        const { container } = render(<HybridflowPanel />);

        const rows = container.querySelectorAll('[role="treeitem"][aria-level="1"]');
        expect(rows[0]).toHaveTextContent('Second');
    });
});
