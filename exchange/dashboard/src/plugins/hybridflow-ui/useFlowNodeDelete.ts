/** Taking flow nodes off the board and throwing them away. */

import { useCallback } from 'react';
import { Modal } from 'antd';
import { FlowNodeAt } from './boardOps';
import { useFlowNodeRemoval } from './useFlowNodeRemoval';

/** How many titles the question spells out before it starts counting instead. */
const NAMED_AT_MOST = 6;

/** The cards being deleted, named — the last thing said about them before they are gone. */
const naming = (cards: FlowNodeAt[]): string => {
    const titles = cards.slice(0, NAMED_AT_MOST).map(at => `“${at.flowNode.title || 'Untitled'}”`);
    const rest = cards.length - titles.length;
    return rest > 0 ? `${titles.join(', ')} and ${rest} more` : titles.join(', ');
};

export const useFlowNodeDelete = (): ((flowNodeIds: string[]) => void) => {
    const removal = useFlowNodeRemoval();

    return useCallback((flowNodeIds: string[]) => {
        const going = removal(flowNodeIds);
        if (!going) return;
        const [one] = going.cards;
        const alone = going.cards.length === 1;
        Modal.confirm({
            title: alone
                ? `Delete “${one.flowNode.title || 'Untitled'}”?`
                : `Delete these ${going.cards.length} nodes?`,
            content: alone
                ? 'It leaves the content.'
                : `${naming(going.cards)} leave the content.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: going.remove,
        });
    }, [removal]);
};
