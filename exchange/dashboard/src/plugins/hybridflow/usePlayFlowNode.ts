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

export interface FlowNodeRun {
    id: string;
    name: string;

    state: 'playing' | 'compacting' | 'scheduled' | 'waiting' | 'refreshing' | 'stopping';
    /** Retry time in epoch milliseconds while waiting or refreshing; otherwise null. */
    retryAt: number | null;
}

export interface FlowNodePlay {
    runOn: (flowNodeId: string) => FlowNodeRun | null;

    documentAt: number | null;

    play: (flowNodeId: string, name: string) => void;

    stop: (runId: string) => void;
}

/** Suspended and ended runs leave the last turn's mark visible, without a spinner. */
const stateOf = (run: HarnessChainRun): FlowNodeRun['state'] | null => {
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

/** Worker owns the play lifecycle, independent of this view. */
export const usePlayFlowNode = (): FlowNodePlay => {
    const { handle, content } = useHybridflow();
    const { runs, play: playRun, stop } = useChatChainRuns();
    const { chatEnabled } = useDashboardConfig();
    const { showTab } = useToolBars();

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
        if (!chatEnabled || !handle || !content) return;
        const issue = chainConnectionIssue(content.flowNodes, flowNodeId);
        if (issue) {
            message.error(issue);
            return;
        }
        showTab(CONVERSATIONS_TAB_ID);
        playRun(handle, flowNodeId, name);
    }, [chatEnabled, handle, content, playRun, showTab]);

    return useMemo(() => ({ runOn, documentAt, play, stop }), [runOn, documentAt, play, stop]);
};
