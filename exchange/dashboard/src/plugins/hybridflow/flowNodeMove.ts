/** Moves within one store retain chat and agent references, but get new globally unique ids. */

import { newId, FlowNode } from './boardContent';

/** Preserves input order; callers supply each node once. */
export const prepareMovedFlowNodes = (nodes: FlowNode[]): FlowNode[] => {
    if (nodes.length === 0) return [];
    const minted = new Map(nodes.map(node => [node.id, newId()]));
    const moving = new Set(nodes.map(node => node.id));
    return nodes.map(node => {
        const target = node.onSuccess.flowNode;
        const kept = target && moving.has(target) ? minted.get(target) ?? '' : '';
        const branches = node.onSuccess.flowNodes
            .filter(branch => moving.has(branch))
            .map(branch => minted.get(branch) ?? '');
        return {
            ...node,
            id: minted.get(node.id) ?? node.id,
            spot: null,
            onSuccess: { ...node.onSuccess, flowNode: kept, flowNodes: branches },

            workflow: '',
        };
    });
};
