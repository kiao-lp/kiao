/**
 * Holding the reader's place in the preview across a change that lays the document out again.
 *
 * Zooming is such a change: at another size the document is not merely taller, its blocks wrap
 * differently, so no offset — a pixel, a fraction of the content — survives it. What does survive
 * is the block itself. Put back where it was, the passage being read is still the passage on
 * screen, whatever happened to everything above it.
 */

/** A block of the rendered document, and how far below the pane's top edge it was sitting. */
export interface PreviewAnchor {
    element: Element;
    offset: number;
}

/**
 * The rendered document's top-level blocks, in document order.
 *
 * `ConfiguredMarkdown` draws the document into a box of its own inside the container it names —
 * the copy-HTML button is that container's other child, and it is not part of the document — so
 * the blocks are the last child's children.
 */
const blocksOf = (pane: HTMLElement): Element[] => {
    const container = pane.querySelector('.configured-markdown-container');
    const rendered = container?.lastElementChild;
    return rendered ? [...rendered.children] : [];
};

/**
 * The block at the top of `pane` — the first one reaching past its top edge.
 *
 * Found by halving rather than by walking: blocks stack in document order and this is answered on
 * every scroll event, where a long document is hundreds of them.
 */
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

/**
 * Scroll `pane` so that the anchored block sits where it did.
 *
 * A block that has since left the document — the file was replaced under the pane — anchors
 * nothing, and the pane is left where it is rather than scrolled somewhere arbitrary.
 */
export const restoreAnchor = (pane: HTMLElement, anchor: PreviewAnchor): void => {
    if (!anchor.element.isConnected) return;
    const drift = anchor.element.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(drift) >= 1) pane.scrollTop += drift;
};
