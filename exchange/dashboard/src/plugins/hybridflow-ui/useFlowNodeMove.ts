/**
 * Moving cards to another board of this store: created there first, taken off here after.
 * In that order, and only in that order.
 */

import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { flowNodesNamed } from './boardOps';
import { newFlowNodeDto } from './boardWrites';
import { prepareMovedFlowNodes } from './flowNodeMove';
import { useHybridflow } from './Hybridflow-ctx';
import { useHybridflowClient } from './service';
import { errorText } from './useFlowNodeRemoval';
import { FlowNode } from './boardContent';

/** What a toast calls the cards a move took: named by title while there is one, counted after. */
const naming = (cards: FlowNode[]): string =>
    (cards.length === 1 ? `“${cards[0].title || 'Untitled'}”` : `${cards.length} nodes`);

export interface MoveTarget {
    slug: string;
    name: string;
}

export const useFlowNodeMove = (): ((flowNodeIds: string[], target: MoveTarget) => Promise<boolean>) => {
    const { content, handle, removeFlowNodes } = useHybridflow();
    const client = useHybridflowClient();

    const held = useRef(content);
    held.current = content;
    const source = useRef(handle);
    source.current = handle;
    const service = useRef(client);
    service.current = client;
    const takeOff = useRef(removeFlowNodes);
    takeOff.current = removeFlowNodes;

    return useCallback(async (flowNodeIds: string[], target: MoveTarget) => {
        const board = held.current;
        const from = source.current;
        const store = service.current;
        if (!board || !from || !store) return false;
        if (!target || !target.slug || target.slug === from) return false;
        const cards = flowNodesNamed(board, flowNodeIds);
        if (cards.length === 0) return false;
        const moved = prepareMovedFlowNodes(cards);
        try {
            await store.createFlowNodes(target.slug, moved.map(newFlowNodeDto));
        } catch (error) {
            message.error(`The nodes could not be moved: ${errorText(error)}`);
            return false;
        }
        takeOff.current?.(cards.map(card => card.id));
        message.success(`Moved ${naming(cards)} to “${target.name || target.slug}”.`);
        return true;
    }, []);
};
