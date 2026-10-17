/**
 * Archiving is a boolean flip: the card stays stored with `archived` set, hidden everywhere
 * with the links to and from it, and never deleted. No file is written.
 *
 * It is the gesture a finished card wants. Delete throws the card away; archiving puts it away.
 * The chat stays where it is: the card still names it, so nothing asks whether it goes too.
 */

import { useCallback } from 'react';
import { Modal } from 'antd';
import { findFlowNode } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';

export const useFlowNodeArchive = (): ((flowNodeId: string) => void) => {
    const { content, archiveFlowNodes } = useHybridflow();

    return useCallback((flowNodeId: string) => {
        const at = content ? findFlowNode(content, flowNodeId) : null;
        if (!at || at.flowNode.archived) return;
        Modal.confirm({
            title: `Archive “${at.flowNode.title || 'Untitled'}”?`,
            content: 'It leaves the board but stays stored, hidden everywhere with its links.',
            okText: 'Archive',
            cancelText: 'Cancel',
            onOk: () => archiveFlowNodes([flowNodeId]),
        });
    }, [content, archiveFlowNodes]);
};
