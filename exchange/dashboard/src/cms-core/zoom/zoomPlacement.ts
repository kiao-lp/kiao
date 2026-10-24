// ── Where a magnified element goes ────────────────────────────────────────────
//
// Magnifying is not a layout change. The element leaves the flow, keeps the corner it already
// occupied, and is pushed back inside the window only as far as it has to be — so the reader who
// Ctrl-clicked something goes on looking at the same place, and everything behind it stays put.
//
// Everything here is screen pixels and pure arithmetic: the DOM side (`magnify.ts`) converts to the
// element's own units, which `zoom` scales.

export interface Point { left: number; top: number; }
export interface Size { width: number; height: number; }
export type Box = Point & Size;

/** Kept between a magnified element and the edge of the area it may use. */
export const VIEWPORT_MARGIN = 8;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The margin actually applied, and how large an element may grow under it.
 *
 * An area smaller than twice the margin would leave nothing to show, so the margin yields first —
 * a quarter of the area each way is the most it ever takes.
 */
export const zoomBounds = (area: Box, margin: number = VIEWPORT_MARGIN) => {
    const applied = Math.max(0, Math.min(margin, area.width / 4, area.height / 4));
    return {
        margin: applied,
        maxWidth: Math.max(0, area.width - 2 * applied),
        maxHeight: Math.max(0, area.height - 2 * applied),
    };
};

/**
 * Anchored where the element already was, moved only if it runs off an edge.
 *
 * It is deliberately never centred: centring would send every zoom to the middle of the screen,
 * which loses the place the reader was reading.
 */
export const placeInViewport = (anchor: Point, size: Size, area: Box, margin: number = VIEWPORT_MARGIN): Point => {
    const { margin: m } = zoomBounds(area, margin);
    return {
        left: clamp(anchor.left, area.left + m, area.left + area.width - m - size.width),
        top: clamp(anchor.top, area.top + m, area.top + area.height - m - size.height),
    };
};
