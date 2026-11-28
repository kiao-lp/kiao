import { useCallback, useMemo } from 'react';
import { message } from 'antd';
import type { HarnessChainRun } from 'kiao-worker';
import { useDashboardConfig, useToolBars } from '@kiao-dashboard-core';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';
import { useChatChainRuns } from './conversations/ChatChainRuns-ctx';
import { CONVERSATIONS_TAB_ID } from './conversations/constants';
import { useHybridflow } from './Hybridflow-ctx';
import { chainConnectionIssue } from './flowConnections';

export const retryClock = formatLocalDateTime;

export const defaultChainRunName = (at = new Date()): string =>
    `Started ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} `
    + `${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

export interface FlowNodeRun {
    id: string;
    name: string;

    state: 'playing' | 'compacting' | 'scheduled' | 'polling' | 'queued' | 'waiting' | 'refreshing' | 'stopping';
    /** Retry time in epoch milliseconds while waiting or refreshing; otherwise null. */
    retryAt: number | null;
}

export interface FlowNodePlay {
    runOn: (flowNodeId: string) => FlowNodeRun | null;

    documentAt: number | null;

    play: (flowNodeId: string, name: string, afterPredecessor?: boolean, predecessorId?: string) => void;

    resumeOn: (flowNodeId: string, chat: string) => (() => void) | undefined;

    stop: (runId: string) => void;
}

/** Suspended and ended runs leave the last turn's mark visible, without a spinner. */
const stateOf = (run: HarnessChainRun): FlowNodeRun['state'] | null => {
    switch (run.state) {
        case 'playing':
        case 'compacting':
        case 'scheduled':
        case 'polling':
        case 'queued':
        case 'waiting':
        case 'refreshing':
        case 'stopping':
            return run.state;
        default:
            return null;
    }
};

/** Worker owns the play lifecycle, independent of this view. */
export const usePlayFlowNode = (): FlowNodePlay => {
    const { handle, content } = useHybridflow();
    const { runs, play: playRun, resume, stop } = useChatChainRuns();
    const { chatEnabled } = useDashboardConfig();
    const { showTab } = useToolBars();

    const here = useMemo(() => runs.filter(run => handle && run.path === handle), [runs, handle]);

    const byFlowNode = useMemo(() => {
        const map = new Map<string, FlowNodeRun>();
        here.forEach(run => {
            const state = stateOf(run);
            const current = map.get(run.flowNodeId);
            if (!state || (current && (current.state !== 'queued' || state === 'queued'))) return;
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

    const resumeOn = useCallback((flowNodeId: string, chat: string) => {
        const suspended = here.find(run => run.state === 'suspended' && run.flowNodeId === flowNodeId && run.chat === chat);
        if (!suspended || !chat) return undefined;
        return () => {
            showTab(CONVERSATIONS_TAB_ID);
            void resume(suspended.id);
        };
    }, [here, resume, showTab]);

    const documentAt = useMemo(() => here.reduce<number | null>(
        (latest, run) => (run.documentAt && (!latest || run.documentAt > latest) ? run.documentAt : latest),
        null,
    ), [here]);

    const play = useCallback((flowNodeId: string, name: string, afterPredecessor?: boolean, predecessorId?: string) => {
        if (!chatEnabled || !handle || !content) return;
        const issue = chainConnectionIssue(content.flowNodes, flowNodeId);
        if (issue) {
            message.error(issue);
            return;
        }
        showTab(CONVERSATIONS_TAB_ID);
        playRun(handle, flowNodeId, name, afterPredecessor, predecessorId);
    }, [chatEnabled, handle, content, playRun, showTab]);

    return useMemo(() => ({ runOn, documentAt, play, resumeOn, stop }), [runOn, documentAt, play, resumeOn, stop]);
};
