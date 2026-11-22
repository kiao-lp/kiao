import React from 'react';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { HarnessSocketMessage, HarnessChainRunMessage, HarnessChainRun } from 'kiao-worker';


const state = vi.hoisted(() => ({
    chatEnabled: true,
    chainRunListeners: new Set<(msg: HarnessChainRunMessage) => void>(),
    helloListeners: new Set<(hello: HarnessSocketMessage) => void>(),
    getChainRuns: vi.fn(async () => [] as HarnessChainRun[]),
    playChainRun: vi.fn(async () => null),
    stopChainRun: vi.fn(async () => undefined),
    resumeChainRun: vi.fn(async () => null),
    restartChainRun: vi.fn(async () => null),
    forgetChainRun: vi.fn(async () => undefined),
    said: [] as string[],
}));

vi.mock('@kiao-dashboard-core', () => ({
    useDashboardConfig: () => ({ chatEnabled: state.chatEnabled }),
    useWorkerClient: () => ({
        getChainRuns: state.getChainRuns,
        playChainRun: state.playChainRun,
        stopChainRun: state.stopChainRun,
        resumeChainRun: state.resumeChainRun,
        restartChainRun: state.restartChainRun,
        forgetChainRun: state.forgetChainRun,
    }),
}));

vi.mock('./ChatSocket-ctx', () => ({
    useChatSocketContext: () => ({
        onChainRun: (listener: (msg: HarnessChainRunMessage) => void) => {
            state.chainRunListeners.add(listener);
            return () => state.chainRunListeners.delete(listener);
        },
        onHello: (listener: (hello: HarnessSocketMessage) => void) => {
            state.helloListeners.add(listener);
            return () => state.helloListeners.delete(listener);
        },
    }),
}));

vi.mock('antd', () => ({
    message: {
        info: (text: string) => state.said.push(`info:${text}`),
        warning: (text: string) => state.said.push(`warning:${text}`),
        error: (text: string) => state.said.push(`error:${text}`),
    },
}));

import { ChatChainRunsProvider, useChatChainRuns } from './ChatChainRuns-ctx';

const RUN: HarnessChainRun = {
    id: 'run-1',
    name: 'Nightly',
    path: 'major',
    rootFlowNodeId: 'flow-node-1',
    flowNodeId: 'flow-node-1',
    chat: 'conv-1',
    state: 'playing',
    startedAt: 1_000,
};

/** Shows what the provider holds, and offers the five calls as buttons. */
const Probe: React.FC = () => {
    const { runs, play, stop, resume, restart, forget } = useChatChainRuns();
    return (
        <div>
            <span data-testid="state">
                {runs.length ? runs.map(run => `${run.name}/${run.state}:${run.flowNodeId}`).join(' ') : 'idle'}
            </span>
            <button onClick={() => play('major', 'flow-node-2', 'Nightly')}>play</button>
            <button onClick={() => stop('run-1')}>stop</button>
            <button onClick={() => { void resume('run-1'); }}>resume</button>
            <button onClick={() => restart('run-1')}>restart</button>
            <button onClick={() => forget('run-1')}>forget</button>
        </div>
    );
};

const show = () => render(<ChatChainRunsProvider><Probe /></ChatChainRunsProvider>);

const frame = (msg: HarnessChainRunMessage) => {
    act(() => { state.chainRunListeners.forEach(listener => listener(msg)); });
};

beforeEach(() => {
    vi.clearAllMocks();
    state.chatEnabled = true;
    state.chainRunListeners.clear();
    state.helloListeners.clear();
    state.getChainRuns.mockResolvedValue([]);
    state.said = [];
});

describe('ChatChainRunsProvider', () => {
    it('reads the runs once at start-up', async () => {
        state.getChainRuns.mockResolvedValue([RUN]);
        show();
        await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('Nightly/playing:flow-node-1'));
    });

    it('follows the runs as the service reports them', async () => {
        show();
        await waitFor(() => expect(state.getChainRuns).toHaveBeenCalled());

        frame({
            type: 'chainRun',
            runs: [
                { ...RUN, state: 'compacting', flowNodeId: 'flow-node-2' },
                { ...RUN, id: 'run-2', name: 'Second', flowNodeId: 'flow-node-9', state: 'waiting' },
            ],
        });
        expect(screen.getByTestId('state'))
            .toHaveTextContent('Nightly/compacting:flow-node-2 Second/waiting:flow-node-9');

        frame({ type: 'chainRun', runs: [] });
        expect(screen.getByTestId('state')).toHaveTextContent('idle');
    });

    it('says what the run said, at the level it said it', async () => {
        show();
        frame({
            type: 'chainRun',
            runs: [RUN],
            notice: { level: 'warning', text: 'The chain ends here.', at: 2_000 },
        });
        expect(state.said).toEqual(['warning:The chain ends here.']);
    });

    it('shows a reset wait in the reader’s local datetime', async () => {
        show();
        frame({
            type: 'chainRun', runs: [RUN],
            notice: { level: 'warning', text: 'Resuming at 2026-10-23T10:00:32Z.', at: 2_000 },
        });
        expect(state.said).toEqual([
            `warning:Resuming at ${formatLocalDateTime(Date.parse('2026-10-23T10:00:32Z'))}.`,
        ]);
    });

    it('says which chain run a notice came from', async () => {
        show();
        frame({
            type: 'chainRun',
            runs: [RUN],
            notice: { level: 'warning', text: 'The chain ends here.', at: 2_000, chainRun: 'Nightly' },
        });
        expect(state.said).toEqual(['warning:Nightly — The chain ends here.']);
    });

    it('takes the runs from the frame the service opens with', async () => {
        show();
        act(() => {
            state.helloListeners.forEach(listener => listener({
                type: 'hello', protocolVersion: 8, socketId: 's1', harnesses: ['claude'],
                runningConversations: [], maxConcurrentTurns: 4, chainRuns: [RUN],
            }));
        });
        expect(screen.getByTestId('state')).toHaveTextContent('Nightly/playing:flow-node-1');
    });

    it('asks the service to play, stop, resume, restart and forget — each naming its run', async () => {
        show();
        await act(async () => { screen.getByText('play').click(); });
        expect(state.playChainRun)
            .toHaveBeenCalledWith('major', 'flow-node-2', 'Nightly');

        await act(async () => { screen.getByText('stop').click(); });
        expect(state.stopChainRun).toHaveBeenCalledWith('run-1');

        await act(async () => { screen.getByText('resume').click(); });
        expect(state.resumeChainRun).toHaveBeenCalledWith('run-1');

        await act(async () => { screen.getByText('restart').click(); });
        expect(state.restartChainRun).toHaveBeenCalledWith('run-1');

        await act(async () => { screen.getByText('forget').click(); });
        expect(state.forgetChainRun).toHaveBeenCalledWith('run-1');
    });

    // The provider is mounted whatever the configuration says, like every plugin provider — so on a deployment without Claude Code it.
    it('asks nothing where the build has no Claude Code', async () => {
        state.chatEnabled = false;
        show();

        await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('idle'));
        expect(state.getChainRuns).not.toHaveBeenCalled();
        expect(state.chainRunListeners.size).toBe(0);
        expect(state.helloListeners.size).toBe(0);
    });

    it('says why a play could not be started', async () => {
        state.playChainRun.mockRejectedValueOnce(new Error('no such flow node'));
        show();

        await act(async () => { screen.getByText('play').click(); });
        await waitFor(() => expect(state.said).toEqual(['error:The flow node could not be played: no such flow node']));
    });
});
