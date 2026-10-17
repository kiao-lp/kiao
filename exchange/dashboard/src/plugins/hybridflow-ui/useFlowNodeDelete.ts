/**
 * Taking flow nodes off the board and throwing them away.
 *
 * It asks first, and then — for every conversation the board is left with nothing naming — asks
 * whether that chat goes too. Two dialogs rather than a three-button one: the first is about the
 * cards, which every delete asks, and the second is about a conversation, which most deletes have no
 * reason to mention. Both the question and what it is asked of are
 * [`useFlowNodeRemoval`](./useFlowNodeRemoval.ts)'s.
 *
 * **One card or several.** A Delete aimed at a card marked with others takes the lot, in one edit to
 * the document, behind one question — and the question **names them**, because a count is not
 * something a hand can check itself against and these cards are about to be gone. It is the whole
 * of what stands between a mis-aimed Ctrl-click and a morning's tickets.
 *
 * The other way off the board is [archiving](./useFlowNodeArchive.ts), which hides the card
 * everywhere by flipping a boolean instead of losing it. This is the one for a card that was never worth keeping.
 */

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
