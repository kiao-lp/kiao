/**
 * Source <-> preview offset mapping for the markdown editor's synchronized
 * scrolling. Kept DOM-free so the interpolation is unit-testable; measuring the
 * two panes is `useMarkdownScrollSync`'s job.
 */

/** A rendered block, tying the markdown line it came from to where it ended up. */
export interface SourceAnchor {
    /** 1-based markdown source line. */
    line: number;
    /** Pixel offset of the block's top within the preview's scrollable content. */
    top: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * Anchors bracketed by the document's two ends, keeping only entries that advance
 * both line and offset. Interpolating over a strictly increasing series is what
 * makes the mapping invertible, so preview -> source and source -> preview agree.
 */
const points = (anchors: SourceAnchor[], totalLines: number, contentHeight: number): SourceAnchor[] => {
    const result: SourceAnchor[] = [{ line: 1, top: 0 }];
    for (const anchor of anchors) {
        const last = result[result.length - 1];
        if (Number.isFinite(anchor.line) && Number.isFinite(anchor.top) && anchor.line > last.line && anchor.top > last.top) {
            result.push(anchor);
        }
    }
    // The end of the last line maps to the end of the content, so the panes reach
    // their bottoms together instead of the shorter one stalling.
    const last = result[result.length - 1];
    result.push({ line: Math.max(totalLines + 1, last.line + 1), top: Math.max(contentHeight, last.top + 1) });
    return result;
};

const interpolate = (from: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number =>
    toLow + ((from - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow);

/**
 * Preview offset that puts `line` (fractional: 3.5 is halfway down line 3) at the
 * top of the preview.
 */
export const sourceLineToOffset = (
    anchors: SourceAnchor[],
    line: number,
    totalLines: number,
    contentHeight: number,
): number => {
    const series = points(anchors, totalLines, contentHeight);
    const target = clamp(line, series[0].line, series[series.length - 1].line);
    for (let i = 1; i < series.length; i++) {
        if (target <= series[i].line) {
            return interpolate(target, series[i - 1].line, series[i].line, series[i - 1].top, series[i].top);
        }
    }
    return series[series.length - 1].top;
};

/**
 * The (fractional) source line rendered at preview offset `offset` — the inverse
 * of `sourceLineToOffset`.
 */
export const offsetToSourceLine = (
    anchors: SourceAnchor[],
    offset: number,
    totalLines: number,
    contentHeight: number,
): number => {
    const series = points(anchors, totalLines, contentHeight);
    const target = clamp(offset, series[0].top, series[series.length - 1].top);
    for (let i = 1; i < series.length; i++) {
        if (target <= series[i].top) {
            return interpolate(target, series[i - 1].top, series[i].top, series[i - 1].line, series[i].line);
        }
    }
    return series[series.length - 1].line;
};
