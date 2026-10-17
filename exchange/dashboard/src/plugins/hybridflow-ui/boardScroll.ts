/**
 * Bringing the board to the pointer while something is being dragged across it.
 *
 * A board has two drags — moving a card (`useSpotDrag`) and chaining one card to another
 * (`useLinkDrag`) — and reaching a card that is off-screen is the same problem in both: the pointer
 * arrives at an edge and cannot go further, so what is under it has to come to meet it. That is all
 * this is, and it is here rather than in either hook so that neither owns it.
 */

/** How close to the edge of a scrolling area the pointer starts dragging it along. */
export const EDGE_PX = 48;

/** Scroll speed at the very edge, per frame. Nearer the middle of the band, proportionally less. */
const MAX_STEP_PX = 14;

export type Axis = 'x' | 'y';

/**
 * The nearest thing that scrolls along `axis`, starting at `element` itself and going up — the
 * canvas, most often. Null where nothing between here and the root has anywhere to scroll to,
 * which is a board that fits on screen.
 */
export const scrollerOf = (element: Element | null, axis: Axis): Element | null => {
    for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const overflow = axis === 'x' ? style.overflowX : style.overflowY;
        const room = axis === 'x'
            ? parent.scrollWidth > parent.clientWidth + 1
            : parent.scrollHeight > parent.clientHeight + 1;
        if (room && /(auto|scroll|overlay)/.test(overflow)) return parent;
    }
    return null;
};

/**
 * Scrolls `element` along `axis` by one frame's worth, the pointer being at `at` on that axis: the
 * closer to an edge, the faster, and nothing at all anywhere in the middle. Called from the drag's
 * own animation frame, so a pointer held still at an edge keeps travelling.
 */
export const edgeScroll = (element: Element | null, axis: Axis, at: number): void => {
    const box = element?.getBoundingClientRect();
    if (!element || !box) return;
    const near = axis === 'x' ? box.left : box.top;
    const far = axis === 'x' ? box.right : box.bottom;

    let step = 0;
    if (at < near + EDGE_PX) step = -MAX_STEP_PX * Math.min(1, (near + EDGE_PX - at) / EDGE_PX);
    else if (at > far - EDGE_PX) step = MAX_STEP_PX * Math.min(1, (at - (far - EDGE_PX)) / EDGE_PX);
    if (step === 0) return;

    if (axis === 'x') element.scrollLeft += step;
    else element.scrollTop += step;
};
