import React, { useEffect } from 'react';

import { useCentralStack } from '@cms-core';
import { useHybridflow } from '../Hybridflow-ctx';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeEditorPanel } from './FlowNodeEditorPanel';

export const FLOW_NODE_EDITOR_PANEL_ID = 'flow-node-editor';

/** Editor overlay on the central stack. */
export const ExpandedFlowNode: React.FC = () => {
    const { content, selectedFlowNode, expanded, setExpanded } = useHybridflow();
    const { push, close } = useCentralStack();

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const open = expanded && !!flowNode && !!content;

    useEffect(() => {
        if (open) {
            push({
                id: FLOW_NODE_EDITOR_PANEL_ID,
                host: BOARD_TAB_ID,
                label: 'Node editor',
                closeLabel: 'Close',
                onClose: () => setExpanded(false),
                content: <FlowNodeEditorPanel />,
            });
        } else {
            close(FLOW_NODE_EDITOR_PANEL_ID);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => () => close(FLOW_NODE_EDITOR_PANEL_ID), [close]);

    return null;
};
