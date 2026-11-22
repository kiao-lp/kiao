/** Source/preview offset mapping for scroll sync. DOM measurement is in `useMarkdownScrollSync`. */

export interface SourceAnchor {
    /** 1-based source line. */
    line: number;
    /** Px offset from the content top. */
    top: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

// Keep only anchors advancing both line and top; a strictly increasing series keeps the mapping invertible.
const points = (anchors: SourceAnchor[], totalLines: number, contentHeight: number): SourceAnchor[] => {
    const result: SourceAnchor[] = [{ line: 1, top: 0 }];
    for (const anchor of anchors) {
        const last = result[result.length - 1];
        if (Number.isFinite(anchor.line) && Number.isFinite(anchor.top) && anchor.line > last.line && anchor.top > last.top) {
            result.push(anchor);
        }
    }
    // Last line end maps to content end so both panes reach the bottom together.
    const last = result[result.length - 1];
    result.push({ line: Math.max(totalLines + 1, last.line + 1), top: Math.max(contentHeight, last.top + 1) });
    return result;
};

const interpolate = (from: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number =>
    toLow + ((from - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow);

/** Preview offset for `line`; 3.5 is halfway down line 3. */
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

/** Fractional source line at a preview offset; inverse of `sourceLineToOffset`. */
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
