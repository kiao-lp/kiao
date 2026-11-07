/** Bringing the board to the pointer while something is being dragged across it. */

/** How close to the edge of a scrolling area the pointer starts dragging it along. */
export const EDGE_PX = 48;

/** Scroll speed at the very edge, per frame. */
const MAX_STEP_PX = 14;

export type Axis = 'x' | 'y';

/** The nearest thing that scrolls along axis, starting at element itself and going up — the canvas. */
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

/** Scrolls element along axis by one frame's worth, the pointer being at at on that axis: the closer. */
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
