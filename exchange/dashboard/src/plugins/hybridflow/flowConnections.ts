import type { FlowNodeSuccess } from './flowNodeSuccess';
import { acceptsPredecessor, chains, joins, FlowNodeType, splits } from './flowNodeType';

interface ConnectedNode {
    id: string;
    title: string;
    type: FlowNodeType;
    archived?: boolean;
    onSuccess: FlowNodeSuccess;
}

export const successorIds = (node: ConnectedNode): string[] =>
    [...new Set([node.onSuccess.flowNode, ...node.onSuccess.flowNodes].filter(Boolean))];

export const predecessors = <T extends ConnectedNode>(nodes: T[], id: string): T[] =>
    nodes.filter(node => successorIds(node).includes(id));

export const canConnect = (nodes: ConnectedNode[], from: string, to: string): boolean => {
    const source = nodes.find(node => node.id === from);
    const target = nodes.find(node => node.id === to);
    return !!source && !!target && from !== to && chains(source.type) && acceptsPredecessor(target.type)
        && (joins(target.type) || !predecessors(nodes, to).some(node => node.id !== from));
};

export const canAppendSuccessor = (nodes: ConnectedNode[], from: string, to: string): boolean => {
    const source = nodes.find(node => node.id === from);
    return canConnect(nodes, from, to)
        && (source?.type !== 'limiter' || source.onSuccess.flowNodes.length < 2);
};

export const canRetype = (nodes: ConnectedNode[], id: string, type: FlowNodeType): boolean =>
    joins(type) || predecessors(nodes, id).length <= (acceptsPredecessor(type) ? 1 : 0);

/** Validate the live connected component, leaving independent chains playable. */
export const chainConnectionIssue = (nodes: ConnectedNode[], root?: string): string | null => {
    const live = nodes.filter(node => !node.archived);
    const byId = new Map(live.map(node => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const node of live) {
        for (const target of successorIds(node)) {
            const previous = incoming.get(target) ?? [];
            previous.push(node.id);
            incoming.set(target, previous);
        }
    }
    const seen = new Set<string>();
    const pending = root === undefined ? [...byId.keys()] : [root];
    while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = byId.get(id);
        if (!node) continue;
        const next = successorIds(node).filter(target => byId.has(target));
        const previous = incoming.get(id) ?? [];
        const name = node.title || node.id;
        if (!acceptsPredecessor(node.type) && previous.length > 0) {
            return `“${name}” cannot have a predecessor.`;
        }
        if (!joins(node.type) && previous.length > 1) {
            return `“${name}” can have only one predecessor. Use a gateway to join branches.`;
        }
        if ((!chains(node.type) && next.length) || (!splits(node.type) && next.length > 1)) {
            return `“${name}” has successors its type does not allow. Use a gateway to split branches.`;
        }
        if (node.type === 'limiter' && successorIds(node).length > 2) {
            return `“${name}” can have only two successors.`;
        }
        if (next.includes(id)) return `“${name}” cannot be chained to itself.`;
        pending.push(...next, ...previous);
    }
    return null;
};
