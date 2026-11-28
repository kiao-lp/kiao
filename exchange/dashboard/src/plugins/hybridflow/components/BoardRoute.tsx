import { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { useLocation } from 'react-router-dom';
import { useAppRoute, useToolBars } from '@kiao-dashboard-core';
import { handleOf, revealTaskEditor, TASKS_PREFIX, useLinkedTaskId } from '../boardRoute';
import { FLOW_NODE_TAB_ID } from '../constants';
import { isTask } from '../flowNodeType';
import { useHybridflow } from '../Hybridflow-ctx';
import { HybridflowError, useHybridflowClient } from '../service';

type BoardLookup = { key: string; handle: string } | { key: string; error: string };

/** Board and task links use the same panel and the same board subscription. */
export const BoardRoute = () => {
    const route = useAppRoute();
    const { key, search } = useLocation();
    const taskRoute = route?.route.prefix === TASKS_PREFIX;
    const taskId = useLinkedTaskId();
    const boardHint = taskRoute
        ? new URLSearchParams(search).get('board')?.trim() || null
        : handleOf(route?.rest ?? '');

    const { board, handle, content, selected, openBoard, closeBoard, selectFromRoute } = useHybridflow();
    const client = useHybridflowClient();
    const bars = useToolBars();
    const candidate = taskId ? content?.flowNodes.find(node => node.id === taskId) : undefined;
    const localHandle = candidate ? board?.slug ?? null : null;
    const [lookup, setLookup] = useState<BoardLookup | null>(null);

    useEffect(() => {
        if (!taskId || boardHint || localHandle || !client) return;
        const controller = new AbortController();
        void client.flowNodeBoard(taskId, controller.signal).then(
            found => {
                if (!controller.signal.aborted) setLookup({ key, handle: found.slug });
            },
            cause => {
                if (controller.signal.aborted) return;
                const error = cause instanceof HybridflowError && cause.gone
                    ? 'There is no task at this address.' : 'The board for this task could not be found.';
                setLookup({ key, error });
            },
        );
        return () => controller.abort();
    }, [taskId, boardHint, localHandle, client, key]);

    const resolved = lookup?.key === key ? lookup : null;
    const target = boardHint ?? localHandle ?? (resolved && 'handle' in resolved ? resolved.handle : null);
    const lookupError = !taskId ? 'There is no task at this address.'
        : resolved && 'error' in resolved ? resolved.error : null;

    useEffect(() => {
        if (target) openBoard(target);
        else if (!taskRoute && handle) closeBoard();
    }, [target, taskRoute, handle, openBoard, closeBoard]);

    const loaded = target && (board?.id === target || board?.slug === target) && content;
    const title = !target && !taskRoute ? 'Boards' : loaded && board?.name;
    useEffect(() => {
        if (title) document.title = title;
    }, [title]);

    const handled = useRef<{ key: string; taskId: string | null }>();
    useEffect(() => {
        if (!taskRoute) {
            if (handled.current?.taskId && handled.current.taskId === selected) selectFromRoute(null);
            handled.current = undefined;
            return;
        }
        if (handled.current?.key === key) return;
        if (!lookupError && (!loaded || !bars.tabs.some(tab => tab.id === FLOW_NODE_TAB_ID))) return;

        handled.current = { key, taskId };
        const problem = lookupError ?? (candidate?.archived ? 'This task is archived.'
            : candidate && isTask(candidate.type) ? null : 'There is no task at this address.');
        if (problem) {
            if (selected) selectFromRoute(null);
            void message.warning(problem);
            return;
        }
        if (selected !== taskId) selectFromRoute(taskId);
        revealTaskEditor(bars);
    }, [key, taskRoute, taskId, loaded, lookupError, candidate, selected, selectFromRoute, bars]);

    return null;
};
