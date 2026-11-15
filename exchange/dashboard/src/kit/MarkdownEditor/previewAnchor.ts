/** Holds preview scroll position across re-layout by anchoring to a block, not an offset. */

/** Rendered block and its offset from the pane top. */
export interface PreviewAnchor {
    element: Element;
    offset: number;
}

// Blocks are the children of the container's last child; the other child is the copy-HTML button.
const blocksOf = (pane: HTMLElement): Element[] => {
    const container = pane.querySelector('.configured-markdown-container');
    const rendered = container?.lastElementChild;
    return rendered ? [...rendered.children] : [];
};

/** First block past the pane top. Binary search: called on every scroll event. */
export const anchorAtTop = (pane: HTMLElement): PreviewAnchor | null => {
    const blocks = blocksOf(pane);
    const top = pane.getBoundingClientRect().top;

    let low = 0;
    let high = blocks.length - 1;
    let found: Element | null = null;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (blocks[middle].getBoundingClientRect().bottom > top) {
            found = blocks[middle];
            high = middle - 1;
        } else {
            low = middle + 1;
        }
    }
    return found ? { element: found, offset: found.getBoundingClientRect().top - top } : null;
};

/** Scroll so the anchored block returns to its offset. A disconnected block leaves the pane unchanged. */
export const restoreAnchor = (pane: HTMLElement, anchor: PreviewAnchor): void => {
    if (!anchor.element.isConnected) return;
    const drift = anchor.element.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(drift) >= 1) pane.scrollTop += drift;
};
