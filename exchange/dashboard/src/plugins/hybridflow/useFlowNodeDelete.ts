/** Taking flow nodes off the board and throwing them away. */

import { useCallback } from 'react';
import { useConfirmation } from '@kiao-dashboard-core';
import { flowNodeTitles } from './flowNodeTitles';
import { useFlowNodeRemoval } from './useFlowNodeRemoval';

export const useFlowNodeDelete = (): ((flowNodeIds: string[]) => void) => {
    const confirm = useConfirmation();
    const removal = useFlowNodeRemoval();

    return useCallback((flowNodeIds: string[]) => {
        const going = removal(flowNodeIds);
        if (!going) return;
        const alone = going.nodes.length === 1;
        confirm({
            title: alone
                ? `Delete ${flowNodeTitles(going.nodes)}?`
                : `Delete these ${going.nodes.length} nodes?`,
            description: alone
                ? 'It leaves the content.'
                : `${flowNodeTitles(going.nodes)} leave the content.`,
            onConfirm: going.remove,
        });
    }, [confirm, removal]);
};
