/**
 * Line-level diff between HEAD and the working tree, plus the line mapping the
 * two panes scroll by. Kept DOM-free so both stay unit-testable; measuring the
 * panes is `GitDiffBody`'s job.
 */

const MAX_DIFF_LINES = 4000;

/** A pair of lines holding the same content, one on each side of the diff. */
export interface LineAnchor {
    /** 1-based line number in the original. */
    original: number;
    /** 1-based line number in the modified. */
    modified: number;
}

/** Where one side of a change sits: `count` is 0 when that side has nothing here. */
export interface HunkSide {
    /** 1-based first line of the change, or the line it would occupy when `count` is 0. */
    start: number;
    count: number;
}

/**
 * One change as the reader sees it: a run of removed lines and the run of added
 * lines facing it, taken together. This is the unit the navigator steps through.
 */
export interface DiffHunk {
    original: HunkSide;
    modified: HunkSide;
}

export interface DiffMarks {
    removed: Set<number>; // 1-based line numbers in the original
    added: Set<number>;   // 1-based line numbers in the modified
    /** Ends of each unchanged run, in order — what ties the two panes together. */
    anchors: LineAnchor[];
    /** The changes in file order, each grouping the lines that changed together. */
    hunks: DiffHunk[];
}

export type DiffSide = 'original' | 'modified';

export const computeDiff = (original: string, modified: string): DiffMarks => {
    const a = original.split('\n');
    const b = modified.split('\n');
    const removed = new Set<number>();
    const added = new Set<number>();
    const anchors: LineAnchor[] = [];
    const hunks: DiffHunk[] = [];

    // Skip the (expensive) LCS for very large files — just show the panes.
    if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
        return { removed, added, anchors, hunks };
    }

    const n = a.length;
    const m = b.length;
    const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    let i = 0;
    let j = 0;
    // Only a run's two ends are recorded: inside it the sides advance together,
    // and between runs the mapping spreads the added and removed lines evenly.
    let runStart: LineAnchor | null = null;
    const closeRun = () => {
        if (!runStart) return;
        anchors.push(runStart, { original: i, modified: j });
        runStart = null;
    };
    // A hunk stays open across the removals and additions that face each other,
    // so a replaced block counts as one change rather than one per side.
    let hunk: DiffHunk | null = null;
    const openHunk = () => {
        hunk ??= { original: { start: i + 1, count: 0 }, modified: { start: j + 1, count: 0 } };
        return hunk;
    };
    const closeHunk = () => {
        if (hunk) hunks.push(hunk);
        hunk = null;
    };
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            closeHunk();
            runStart ??= { original: i + 1, modified: j + 1 };
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            closeRun();
            openHunk().original.count++;
            removed.add(i + 1);
            i++;
        } else {
            closeRun();
            openHunk().modified.count++;
            added.add(j + 1);
            j++;
        }
    }
    closeRun();
    while (i < n) {
        openHunk().original.count++;
        removed.add(i + 1);
        i++;
    }
    while (j < m) {
        openHunk().modified.count++;
        added.add(j + 1);
        j++;
    }
    closeHunk();
    return { removed, added, anchors, hunks };
};

/**
 * Anchors bracketed by both documents' ends, keeping only pairs that advance on
 * both sides. Interpolating over a strictly increasing series is what makes the
 * mapping invertible, so original -> modified and modified -> original agree.
 */
const series = (anchors: LineAnchor[], originalLines: number, modifiedLines: number): LineAnchor[] => {
    const result: LineAnchor[] = [{ original: 1, modified: 1 }];
    for (const anchor of anchors) {
        const last = result[result.length - 1];
        if (anchor.original > last.original && anchor.modified > last.modified) {
            result.push(anchor);
        }
    }
    // Both documents end together, so the shorter pane reaches its bottom with
    // the other instead of stalling part of the way down.
    const last = result[result.length - 1];
    result.push({
        original: Math.max(originalLines + 1, last.original + 1),
        modified: Math.max(modifiedLines + 1, last.modified + 1),
    });
    return result;
};

const interpolate = (from: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number =>
    toLow + ((from - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow);

/**
 * The (fractional) line on the opposite side showing the same code as `line` on
 * `side` — 3.5 being halfway down line 3.
 */
export const mapDiffLine = (
    anchors: LineAnchor[],
    line: number,
    side: DiffSide,
    originalLines: number,
    modifiedLines: number,
): number => {
    const points = series(anchors, originalLines, modifiedLines);
    const other: DiffSide = side === 'original' ? 'modified' : 'original';
    const first = points[0];
    const last = points[points.length - 1];
    const target = Math.min(Math.max(line, first[side]), last[side]);
    for (let k = 1; k < points.length; k++) {
        if (target <= points[k][side]) {
            return interpolate(target, points[k - 1][side], points[k][side], points[k - 1][other], points[k][other]);
        }
    }
    return last[other];
};
