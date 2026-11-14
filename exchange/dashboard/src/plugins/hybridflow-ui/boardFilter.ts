/** View-only tag filtering: selections are ORed and never alter board content. */

export interface TaggedCard {
    tags: string[];
}

/** Offer tags used by this board, including unregistered tags; sort to keep chips stable. */
export const boardTags = (cards: TaggedCard[]): string[] => {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const card of cards) {
        for (const label of card.tags) {
            const key = label.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            words.push(label);
        }
    }
    return words.sort((one, other) => one.localeCompare(other, undefined, { sensitivity: 'base' }));
};

/** No selection shows all cards; matching is case-insensitive. */
export const showsFlowNode = (card: TaggedCard, selected: string[]): boolean => {
    if (!selected.length) return true;
    return card.tags.some(label => selected.some(wanted => wanted.toLowerCase() === label.toLowerCase()));
};

/** Preserve card identity and order; return the original array when unfiltered. */
export const filterFlowNodes = <T extends TaggedCard>(cards: T[], selected: string[]): T[] =>
    (selected.length ? cards.filter(card => showsFlowNode(card, selected)) : cards);

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
