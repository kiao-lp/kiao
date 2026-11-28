/**
 * Moving nodes to another board of this store: created there first, taken off here after.
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

/** What a toast calls the nodes a move took: named by title while there is one, counted after. */
const naming = (nodes: FlowNode[]): string =>
    (nodes.length === 1 ? `“${nodes[0].title || 'Untitled'}”` : `${nodes.length} nodes`);

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
        const nodes = flowNodesNamed(board, flowNodeIds);
        if (nodes.length === 0) return false;
        const moved = prepareMovedFlowNodes(nodes);
        try {
            await store.createFlowNodes(target.slug, moved.map(newFlowNodeDto));
        } catch (error) {
            message.error(`The nodes could not be moved: ${errorText(error)}`);
            return false;
        }
        takeOff.current?.(nodes.map(node => node.id));
        message.success(`Moved ${naming(nodes)} to “${target.name || target.slug}”.`);
        return true;
    }, []);
};
