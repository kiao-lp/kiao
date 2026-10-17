import { useCallback, useMemo } from 'react';
import { useChatRun } from '@cms-kit/capabilities';
import type { AgentRun } from '@cms-kit/capabilities';
import { useHybridflow } from './Hybridflow-ctx';

/** Include the date for waits ending on another day. */
export const retryClock = (at: number): string => {
    const when = new Date(at);
    const clock = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (when.toDateString() === new Date().toDateString()) return clock;
    return `${when.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock}`;
};

export interface FlowNodeRun {
    id: string;
    name: string;
    /**
     * `compacting` follows the completed, marked turn; `scheduled` waits for a Scheduler datetime.
     * `waiting` retries a transient error; `refreshing` waits for a usage reset and resumes the cut-off turn.
     * `stopping` lets the current turn finish without starting a successor.
     */
    state: 'playing' | 'compacting' | 'scheduled' | 'waiting' | 'refreshing' | 'stopping';
    /** Retry time in epoch milliseconds while waiting or refreshing; otherwise null. */
    retryAt: number | null;
}

export interface FlowNodePlay {
    runOn: (flowNodeId: string) => FlowNodeRun | null;
    /** Latest board write by any run, in epoch milliseconds; changes trigger a reload. */
    documentAt: number | null;
    /** Start a named chain following the flow node's onSuccess links. */
    play: (flowNodeId: string, name: string) => void;
    /** Stop after the current turn finishes and is marked; chat Stop interrupts the turn and run. */
    stop: (runId: string) => void;
}

/** Suspended and ended runs leave the last turn's mark visible, without a spinner. */
const stateOf = (run: AgentRun): FlowNodeRun['state'] | null => {
    switch (run.state) {
        case 'playing':
        case 'compacting':
        case 'scheduled':
        case 'waiting':
        case 'refreshing':
        case 'stopping':
            return run.state;
        default:
            return null;
    }
};

/**
 * Worker owns the play lifecycle, independent of this view. Runs are service-wide and concurrent;
 * each card belongs to at most one run. Status text comes from the service.
 * Without a chat.run provider, runs stay empty and play is a no-op; useChatAvailable gates controls.
 */
export const usePlayFlowNode = (): FlowNodePlay => {
    const { handle } = useHybridflow();
    const { runs, play: playRun, stop } = useChatRun();

    const here = useMemo(() => runs.filter(run => handle && run.path === handle), [runs, handle]);

    const byFlowNode = useMemo(() => {
        const map = new Map<string, FlowNodeRun>();
        here.forEach(run => {
            const state = stateOf(run);
            if (!state || map.has(run.flowNodeId)) return;
            map.set(run.flowNodeId, {
                id: run.id,
                name: run.name,
                state,
                retryAt: state === 'waiting' || state === 'refreshing' ? run.retryAt ?? null : null,
            });
        });
        return map;
    }, [here]);

    const runOn = useCallback((flowNodeId: string) => byFlowNode.get(flowNodeId) ?? null, [byFlowNode]);

    const documentAt = useMemo(() => here.reduce<number | null>(
        (latest, run) => (run.documentAt && (!latest || run.documentAt > latest) ? run.documentAt : latest),
        null,
    ), [here]);

    const play = useCallback((flowNodeId: string, name: string) => {
        if (!handle) return;
        playRun(handle, flowNodeId, name);
    }, [handle, playRun]);

    return useMemo(() => ({ runOn, documentAt, play, stop }), [runOn, documentAt, play, stop]);
};
