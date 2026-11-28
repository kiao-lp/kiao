/** Archive flow nodes while keeping their records on the board. */

import { useCallback } from 'react';
import { useConfirmation } from '@kiao-dashboard-core';
import { flowNodeTitles } from './flowNodeTitles';
import { useConfirmOrphanedChatDeletion } from './useConfirmOrphanedChatDeletion';
import { findFlowNode, FlowNodeAt } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';

export const useFlowNodeArchive = (): ((flowNodeIds: string[]) => void) => {
    const { content, archiveFlowNodes } = useHybridflow();
    const confirm = useConfirmation();
    const askChats = useConfirmOrphanedChatDeletion('archive');

    return useCallback((flowNodeIds: string[]) => {
        if (!content) return;
        const going = flowNodeIds
            .map(flowNodeId => findFlowNode(content, flowNodeId))
            .filter((at): at is FlowNodeAt => at !== null && !at.flowNode.archived);
        if (going.length === 0) return;

        const alone = going.length === 1;
        confirm({
            title: alone
                ? `Archive ${flowNodeTitles(going)}?`
                : `Archive ${going.length} nodes?`,
            description: alone
                ? 'It leaves the board but stays stored, hidden everywhere with its links.'
                : `${flowNodeTitles(going)} leave the board but stay stored, hidden everywhere with their links.`,
            confirmText: 'Archive',
            danger: false,
            onConfirm: () => {
                archiveFlowNodes(going.map(({ flowNode }) => flowNode.id));
                askChats(content, going);
            },
        });
    }, [content, confirm, archiveFlowNodes, askChats]);
};
