import { useMatch } from 'react-router-dom';
import type { useToolBars } from '@kiao-dashboard-core';
import { BOARD_TAB_ID, FLOW_NODE_TAB_ID } from './constants';

/** Boards use stable name-derived handles, not file paths; renaming preserves bookmarks. */

/** Claims the list at this prefix and board pages below it. */
export const BOARDS_PREFIX = '/boards';
export const TASKS_PREFIX = '/tasks';
const TASK_ROUTE = { path: `${TASKS_PREFIX}/:id`, caseSensitive: true };

export const boardUrl = (slug: string): string => `${BOARDS_PREFIX}/${encodeURIComponent(slug)}`;

export const boardsUrl = (): string => BOARDS_PREFIX;

export const taskUrl = (id: string, board: string): string =>
    `${TASKS_PREFIX}/${encodeURIComponent(id)}?${new URLSearchParams({ board })}`;

export const useLinkedTaskId = (): string | null =>
    useMatch(TASK_ROUTE)?.params.id ?? null;

export const revealTaskEditor = (bars: ReturnType<typeof useToolBars>) => {
    const boardBar = bars.placementOf(BOARD_TAB_ID);
    const nodeBar = bars.placementOf(FLOW_NODE_TAB_ID);
    const boardArea = boardBar === 'off' ? 'center' : boardBar;
    const nodeArea = nodeBar === 'off' ? 'right' : nodeBar;
    // Only one tab in an area can be visible. Keep the Board where the user placed it.
    if (boardArea === nodeArea) {
        const side = boardArea === 'right' ? 'left' : 'right';
        bars.place(FLOW_NODE_TAB_ID, side);
        bars.activate(side, FLOW_NODE_TAB_ID);
    } else if (nodeBar === 'off' || bars.activeIn(nodeBar) !== FLOW_NODE_TAB_ID
        || ((nodeBar === 'left' || nodeBar === 'right') && !bars.isSideOn(nodeBar))) {
        bars.showTab(FLOW_NODE_TAB_ID);
    }
};

/** Receives the pathname after the claimed prefix; uses its first segment, or null for the list. */
export const handleOf = (rest: string): string | null => {
    const handle = rest.split('/')[0]?.trim() ?? '';
    return handle === '' ? null : handle;
};

/** Pasted images live here. */
export const boardFolder = (handle: string): string => `boards/${handle}`;
