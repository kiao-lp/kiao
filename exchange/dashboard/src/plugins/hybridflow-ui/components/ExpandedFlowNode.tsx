import React, { useEffect } from 'react';

import { useCentralStack } from '@cms-core';
import { useHybridflow } from '../Hybridflow-ctx';
import { FlowNodeEditorPanel } from './FlowNodeEditorPanel';

export const FLOW_NODE_EDITOR_PANEL_ID = 'flow-node-editor';

/**
 * Keep the editor beside the board on the central stack so hiding a toolbar or reloading
 * the board cannot unmount an active draft. Board state controls whether it is open;
 * the editor reads the current node and draft from their contexts.
 */
export const ExpandedFlowNode: React.FC = () => {
    const { content, selectedFlowNode, expanded, setExpanded } = useHybridflow();
    const { push, close } = useCentralStack();

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const open = expanded && !!flowNode && !!content;

    useEffect(() => {
        if (open) {
            push({
                id: FLOW_NODE_EDITOR_PANEL_ID,
                // The editor's title box serves as its header.
                label: 'Node editor',
                closeLabel: 'Close',
                onClose: () => setExpanded(false),
                content: <FlowNodeEditorPanel />,
            });
        } else {
            close(FLOW_NODE_EDITOR_PANEL_ID);
        }
        // Watch only opening: the editor reads live context; keystrokes must not re-push it.
        // `push`, `close` and `setExpanded` are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // The editor belongs to this board, so close it on unmount.
    useEffect(() => () => close(FLOW_NODE_EDITOR_PANEL_ID), [close]);

    return null;
};
