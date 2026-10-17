import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentSocketMessage, AgentChainRunMessage, AgentChainRun } from 'kiao-worker';

// The page's view of the service's runs: what they say, and what it asks of the service. Nothing here
// decides anything about a play — the loop is worker's — so what is pinned is that every
// change arrives from the service and that the words shown are the words it sent.

const state = vi.hoisted(() => ({
    chatEnabled: true,
    chainRunListeners: new Set<(msg: AgentChainRunMessage) => void>(),
    helloListeners: new Set<(hello: AgentSocketMessage) => void>(),
    getChainRuns: vi.fn(async () => [] as AgentChainRun[]),
    playChainRun: vi.fn(async () => null),
    stopChainRun: vi.fn(async () => undefined),
    resumeChainRun: vi.fn(async () => null),
    restartChainRun: vi.fn(async () => null),
    forgetChainRun: vi.fn(async () => undefined),
    said: [] as string[],
}));

vi.mock('@cms-core', () => ({
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
        onChainRun: (listener: (msg: AgentChainRunMessage) => void) => {
            state.chainRunListeners.add(listener);
            return () => state.chainRunListeners.delete(listener);
        },
        onHello: (listener: (hello: AgentSocketMessage) => void) => {
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

const RUN: AgentChainRun = {
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

const frame = (msg: AgentChainRunMessage) => {
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
    // The first paint has to know what is playing, and the socket may not be open yet.
    it('reads the runs once at start-up', async () => {
        state.getChainRuns.mockResolvedValue([RUN]);
        show();
        await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('Nightly/playing:flow-node-1'));
    });

    // The whole list travels every frame rather than the run that moved: a client merging deltas
    // would be a second place the truth lived.
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

    // The service decides that a chain ended, or that a flow node is tried again at twenty past, and sends
    // the words with the state. Nothing here works out a sentence of its own.
    it('says what the run said, at the level it said it', async () => {
        show();
        frame({
            type: 'chainRun',
            runs: [RUN],
            notice: { level: 'warning', text: 'The chain ends here.', at: 2_000 },
        });
        expect(state.said).toEqual(['warning:The chain ends here.']);
    });

    // Several runs speak at once, so a line is said under the name of the run that decided it —
    // unattributed, "the chain ends here" names none of three chain runs.
    it('says which chain run a notice came from', async () => {
        show();
        frame({
            type: 'chainRun',
            runs: [RUN],
            notice: { level: 'warning', text: 'The chain ends here.', at: 2_000, chainRun: 'Nightly' },
        });
        expect(state.said).toEqual(['warning:Nightly — The chain ends here.']);
    });

    // `hello` is what repairs a tab that connected late or reconnected: it carries the runs the way
    // it carries the turns that are running.
    it('takes the runs from the frame the service opens with', async () => {
        show();
        act(() => {
            state.helloListeners.forEach(listener => listener({
                type: 'hello', protocolVersion: 8, socketId: 's1', agents: ['claude'],
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

    // The provider is mounted whatever the configuration says, like every plugin provider — so on a
    // deployment without Claude Code it must ask the service nothing at all, socket included.
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
