/**
 * Read drag targets from DOM attributes: antd Dropdown composes a card's ref only at mount,
 * so a position-keyed ref registry becomes stale when cards move.
 */

export const BOARD_ATTRIBUTE = 'data-board';

export const FLOW_NODE_ID_ATTRIBUTE = 'data-flow-node-id';

export const boardOf = (element: Element | null): HTMLElement | null =>
    element?.closest<HTMLElement>(`[${BOARD_ATTRIBUTE}]`) ?? null;
