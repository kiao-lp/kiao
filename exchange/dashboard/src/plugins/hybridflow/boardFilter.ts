/** View-only tag filtering: selections are ORed and never alter board content. */

export interface TaggedFlowNode {
    tags: string[];
}

/** Offer tags used by this board, including unregistered tags; sort to keep chips stable. */
export const boardTags = (nodes: TaggedFlowNode[]): string[] => {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const node of nodes) {
        for (const label of node.tags) {
            const key = label.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            words.push(label);
        }
    }
    return words.sort((one, other) => one.localeCompare(other, undefined, { sensitivity: 'base' }));
};

/** No selection shows all nodes; matching is case-insensitive. */
export const showsFlowNode = (node: TaggedFlowNode, selected: string[]): boolean => {
    if (!selected.length) return true;
    return node.tags.some(label => selected.some(wanted => wanted.toLowerCase() === label.toLowerCase()));
};

/** Preserve node identity and order; return the original array when unfiltered. */
export const filterFlowNodes = <T extends TaggedFlowNode>(nodes: T[], selected: string[]): T[] =>
    (selected.length ? nodes.filter(node => showsFlowNode(node, selected)) : nodes);

export const toggleTag = (selected: string[], label: string): string[] => {
    const held = selected.some(word => word.toLowerCase() === label.toLowerCase());
    return held
        ? selected.filter(word => word.toLowerCase() !== label.toLowerCase())
        : [...selected, label];
};

/** Drop unavailable selections so a vanished chip cannot leave an unremovable filter. */
export const keptTags = (selected: string[], available: string[]): string[] => {
    const known = new Set(available.map(word => word.toLowerCase()));
    return selected.filter(word => known.has(word.toLowerCase()));
};
