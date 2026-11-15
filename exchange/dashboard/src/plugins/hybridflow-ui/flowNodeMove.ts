/** Moves within one store retain chat and agent references, but get new globally unique ids. */

import { newId, FlowNode } from './boardContent';

/** Preserves input order; callers supply each card once. */
export const prepareMovedFlowNodes = (cards: FlowNode[]): FlowNode[] => {
    if (cards.length === 0) return [];
    const minted = new Map(cards.map(card => [card.id, newId()]));
    const moving = new Set(cards.map(card => card.id));
    return cards.map(card => {
        const target = card.onSuccess.flowNode;
        const kept = target && moving.has(target) ? minted.get(target) ?? '' : '';
        const branches = card.onSuccess.flowNodes
            .filter(branch => moving.has(branch))
            .map(branch => minted.get(branch) ?? '');
        return {
            ...card,
            id: minted.get(card.id) ?? card.id,
            spot: null,
            onSuccess: { ...card.onSuccess, flowNode: kept, flowNodes: branches },

            workflow: '',
        };
    });
};
