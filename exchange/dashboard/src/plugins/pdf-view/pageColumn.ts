/**
 * Where every page of a PDF sits in the scrolling column — computed, never measured.
 *
 * The column is the whole document, one page below the next, read by scrolling. Only the handful
 * of pages around the viewport are ever mounted: a page rasterised at reading width costs tens of
 * megabytes of canvas, so a six-hundred-page document rendered whole would exhaust the tab long
 * before anyone reached page two. Knowing each page's box in advance is what allows that — the
 * scrollbar spans the document from the first frame, and reaching page four hundred is arithmetic
 * rather than a walk through the three hundred and ninety-nine before it.
 *
 * A box's height comes from the page's *proportion*, its height in units of its width, which
 * survives a zoom step and a resized window where a height in pixels would not. A page that has
 * never been mounted has no proportion of its own and borrows the first page's: exact for the
 * ordinary document whose pages are all one size, an approximation for the one that mixes
 * portrait with landscape. `anchoredScrollTop` is what keeps that approximation from being felt.
 */

/** A page's box in the column: its top edge and its height, in pixels. */
export interface PageBox {
    top: number;
    height: number;
}

/** The laid-out column. */
export interface ColumnLayout {
    /** One box per page, in page order: `boxes[n - 1]` is page `n`. */
    boxes: PageBox[];
    /** Everything the scroller holds, the gap under the last page included. */
    height: number;
    /** The width every page is rendered at. */
    width: number;
    /** The space above, below and between the pages. */
    gap: number;
}

/** Page numbers, both ends included. `last < first` means none — the range a loop skips. */
export interface PageRange {
    first: number;
    last: number;
}

/** A4 upright, standing in until the document says otherwise. */
export const DEFAULT_RATIO = 297 / 210;

/** No document loaded, or no width to lay one out in. */
export const EMPTY_LAYOUT: ColumnLayout = { boxes: [], height: 0, width: 0, gap: 0 };

/**
 * One proportion per page: the measured one wherever a page has reported its size, the first
 * page's everywhere else — and `DEFAULT_RATIO` until even that is known.
 */
export const columnRatios = (numPages: number, measured: ReadonlyMap<number, number>): number[] => {
    const fallback = measured.get(1) ?? DEFAULT_RATIO;
    return Array.from({ length: Math.max(0, numPages) }, (_, i) => measured.get(i + 1) ?? fallback);
};

/**
 * Stacks the pages `gap` pixels apart, and that far from either end of the column.
 *
 * Heights are rounded, so a box and the canvas it holds agree on whole pixels rather than drifting
 * apart by a fraction of one per page — over a thousand pages that fraction is a page in itself.
 */
export const layOutColumn = (ratios: readonly number[], width: number, gap: number): ColumnLayout => {
    if (!ratios.length || width <= 0) return EMPTY_LAYOUT;

    let top = gap;
    const boxes = ratios.map(ratio => {
        const height = Math.max(1, Math.round(width * ratio));
        const box = { top, height };
        top += height + gap;
        return box;
    });
    return { boxes, height: top, width, gap };
};

/** The last page starting at or above `offset`; page 1 for anything above the first. */
const indexAt = (layout: ColumnLayout, offset: number): number => {
    let low = 0;
    let high = layout.boxes.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (layout.boxes[mid].top <= offset) low = mid; else high = mid - 1;
    }
    return low;
};

/** The page holding `offset`, or 0 when the column is empty. */
export const pageAt = (layout: ColumnLayout, offset: number): number =>
    layout.boxes.length ? indexAt(layout, offset) + 1 : 0;

/**
 * The pages worth mounting: those the viewport shows, widened by `overscan` on either side so
 * that scrolling meets pages already rendered rather than blank paper.
 */
export const pagesInView = (
    layout: ColumnLayout,
    scrollTop: number,
    viewportHeight: number,
    overscan: number,
): PageRange => {
    if (!layout.boxes.length) return { first: 1, last: 0 };

    const top = Math.max(0, scrollTop);
    const first = indexAt(layout, top) + 1;
    const last = indexAt(layout, top + Math.max(0, viewportHeight)) + 1;
    return {
        first: Math.max(1, first - overscan),
        last: Math.min(layout.boxes.length, last + overscan),
    };
};

/**
 * The page being read: the one covering most of the viewport.
 *
 * This is what the page counter shows and what is remembered for the next visit, so a page
 * scrolling off the top gives way to its successor at the moment more of the successor is on
 * screen — which is where a reader would say they had turned the page.
 */
export const pageInFocus = (layout: ColumnLayout, scrollTop: number, viewportHeight: number): number => {
    if (!layout.boxes.length) return 0;

    const top = Math.max(0, scrollTop);
    const bottom = top + Math.max(0, viewportHeight);
    let best = indexAt(layout, top);
    let bestCover = -1;
    for (let i = best; i < layout.boxes.length; i++) {
        const box = layout.boxes[i];
        if (box.top >= bottom) break;
        const cover = Math.min(box.top + box.height, bottom) - Math.max(box.top, top);
        if (cover > bestCover) {
            bestCover = cover;
            best = i;
        }
    }
    return best + 1;
};

/** Where to scroll for `pageNumber` to sit at the top of the viewport, its gap above it. */
export const scrollTopFor = (layout: ColumnLayout, pageNumber: number): number => {
    if (!layout.boxes.length) return 0;

    const index = Math.min(Math.max(Math.round(pageNumber), 1), layout.boxes.length) - 1;
    return Math.max(0, layout.boxes[index].top - layout.gap);
};

/**
 * The offset that keeps the reader in place across a relaid-out column — a zoom step, a resized
 * window, or a page turning out not to be the size its neighbours implied.
 *
 * The page at the top of the viewport and how far into it the reader has come are what carry over.
 * Everything above may have changed height without the reading position having moved at all, which
 * is exactly what happens when a page far up the document is mounted for the first time and
 * replaces its borrowed proportion with its own.
 */
export const anchoredScrollTop = (before: ColumnLayout, after: ColumnLayout, scrollTop: number): number => {
    if (!before.boxes.length || !after.boxes.length) return scrollTop;

    const top = Math.max(0, scrollTop);
    // A document is only ever relaid out, never replaced, but a shorter one would leave the
    // anchor past the end; the last page is the closest thing to where the reader was.
    const index = Math.min(indexAt(before, top), after.boxes.length - 1);
    const from = before.boxes[index];
    const to = after.boxes[index];
    const into = from.height > 0 ? (top - from.top) / from.height : 0;
    return Math.max(0, Math.round(to.top + into * to.height));
};
