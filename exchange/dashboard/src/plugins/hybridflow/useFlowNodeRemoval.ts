/**
 * Shared by delete and cut.
 * Ask once per orphaned conversation, only when all nodes referencing it leave this board.
 */

import { useCallback, useRef } from 'react';
import { useConfirmOrphanedChatDeletion } from './useConfirmOrphanedChatDeletion';
import { findFlowNode, FlowNodeAt } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface FlowNodeRemoval {

    nodes: FlowNodeAt[];

    remove: () => void;
}

/** Resolves against the current board; returns null if no requested ids remain. */
export const useFlowNodeRemoval = (): ((flowNodeIds: string[]) => FlowNodeRemoval | null) => {
    const { content, removeFlowNodes } = useHybridflow();
    const askChats = useConfirmOrphanedChatDeletion('remove');

    const held = useRef(content);
    held.current = content;

    return useCallback((flowNodeIds: string[]) => {
        const board = held.current;
        if (!board) return null;
        const nodes = flowNodeIds
            .map(flowNodeId => findFlowNode(board, flowNodeId))
            .filter((at): at is FlowNodeAt => at !== null);
        if (nodes.length === 0) return null;

        return {
            nodes,
            remove: () => {
                removeFlowNodes([...new Set(nodes.map(({ flowNode }) => flowNode.id))]);
                askChats(board, nodes);
            },
        };
    }, [askChats, removeFlowNodes]);
};
