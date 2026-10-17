import { describe, it, expect } from 'vitest';
import { computeDiff, mapDiffLine, LineAnchor } from './gitDiffLines';

describe('computeDiff', () => {
    it('marks nothing and anchors the whole file when the sides are equal', () => {
        const { removed, added, anchors } = computeDiff('a\nb\nc', 'a\nb\nc');
        expect(removed.size).toBe(0);
        expect(added.size).toBe(0);
        expect(anchors).toEqual([{ original: 1, modified: 1 }, { original: 3, modified: 3 }]);
    });

    it('marks an insertion and anchors the runs around it', () => {
        // b is new, so the lines after it sit one lower on the modified side.
        const { removed, added, anchors } = computeDiff('a\nc', 'a\nb\nc');
        expect([...removed]).toEqual([]);
        expect([...added]).toEqual([2]);
        expect(anchors).toEqual([
            { original: 1, modified: 1 },
            { original: 1, modified: 1 },
            { original: 2, modified: 3 },
            { original: 2, modified: 3 },
        ]);
    });

    it('marks a deletion', () => {
        const { removed, added } = computeDiff('a\nb\nc', 'a\nc');
        expect([...removed]).toEqual([2]);
        expect([...added]).toEqual([]);
    });

    it('marks trailing lines left over on either side', () => {
        expect([...computeDiff('a\nb\nc', 'a').removed]).toEqual([2, 3]);
        expect([...computeDiff('a', 'a\nb\nc').added]).toEqual([2, 3]);
    });

    it('gives up on files past the size limit rather than running the LCS', () => {
        const huge = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join('\n');
        const { removed, added, anchors } = computeDiff(huge, `${huge}\nextra`);
        expect(removed.size).toBe(0);
        expect(added.size).toBe(0);
        expect(anchors).toEqual([]);
    });
});

describe('computeDiff hunks', () => {
    it('reports no change when the sides are equal', () => {
        expect(computeDiff('a\nb\nc', 'a\nb\nc').hunks).toEqual([]);
    });

    it('groups a replaced block as one change rather than one per side', () => {
        // Lines 2-3 give way to a single line, which is one change to step onto.
        const { hunks } = computeDiff('a\nb\nc\nd', 'a\nB\nd');
        expect(hunks).toEqual([
            { original: { start: 2, count: 2 }, modified: { start: 2, count: 1 } },
        ]);
    });

    it('gives an insertion an empty original side, pointing at where it lands', () => {
        const { hunks } = computeDiff('a\nc', 'a\nb\nc');
        expect(hunks).toEqual([
            { original: { start: 2, count: 0 }, modified: { start: 2, count: 1 } },
        ]);
    });

    it('gives a deletion an empty modified side', () => {
        const { hunks } = computeDiff('a\nb\nc', 'a\nc');
        expect(hunks).toEqual([
            { original: { start: 2, count: 1 }, modified: { start: 2, count: 0 } },
        ]);
    });

    it('separates changes that unchanged lines keep apart', () => {
        const { hunks } = computeDiff('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE');
        expect(hunks).toEqual([
            { original: { start: 2, count: 1 }, modified: { start: 2, count: 1 } },
            { original: { start: 5, count: 1 }, modified: { start: 5, count: 1 } },
        ]);
    });

    it('closes the change left open at the end of a file', () => {
        expect(computeDiff('a\nb\nc', 'a').hunks).toEqual([
            { original: { start: 2, count: 2 }, modified: { start: 2, count: 0 } },
        ]);
        expect(computeDiff('a', 'a\nb\nc').hunks).toEqual([
            { original: { start: 2, count: 0 }, modified: { start: 2, count: 2 } },
        ]);
    });

    it('covers every marked line exactly once', () => {
        const { removed, added, hunks } = computeDiff('a\nb\nc\nd\ne\nf', 'a\nX\nc\nd\nY\nZ\nf');
        const spread = (sides: { start: number; count: number }[]) =>
            sides.flatMap(s => Array.from({ length: s.count }, (_, k) => s.start + k));
        expect(spread(hunks.map(h => h.original)).sort((x, y) => x - y)).toEqual([...removed].sort((x, y) => x - y));
        expect(spread(hunks.map(h => h.modified)).sort((x, y) => x - y)).toEqual([...added].sort((x, y) => x - y));
    });

    it('reports no change for files past the size limit, like the marks', () => {
        const huge = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join('\n');
        expect(computeDiff(huge, `${huge}\nextra`).hunks).toEqual([]);
    });
});

describe('mapDiffLine', () => {
    // Lines 1-3 are common, the original then has 4 lines the modified lacks,
    // and lines 8-10 / 4-6 are common again.
    const anchors: LineAnchor[] = [
        { original: 1, modified: 1 },
        { original: 3, modified: 3 },
        { original: 8, modified: 4 },
        { original: 10, modified: 6 },
    ];
    const ORIGINAL_LINES = 10;
    const MODIFIED_LINES = 6;

    it('holds unchanged lines opposite themselves', () => {
        expect(mapDiffLine(anchors, 2, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(2);
        expect(mapDiffLine(anchors, 8, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(4);
        expect(mapDiffLine(anchors, 4, 'modified', ORIGINAL_LINES, MODIFIED_LINES)).toBe(8);
    });

    it('spreads a removed block across the gap it leaves on the other side', () => {
        // Scrolling through the original's lines 3-8 walks the modified's 3-4.
        expect(mapDiffLine(anchors, 5.5, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(3.5);
    });

    it('reads a fractional line as a fraction of the way to the next anchor', () => {
        expect(mapDiffLine(anchors, 1.5, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(1.5);
        expect(mapDiffLine(anchors, 8.5, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(4.5);
    });

    it('maps the documents ends to each other, so the panes bottom out together', () => {
        expect(mapDiffLine(anchors, 1, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(1);
        expect(mapDiffLine(anchors, ORIGINAL_LINES + 1, 'original', ORIGINAL_LINES, MODIFIED_LINES))
            .toBe(MODIFIED_LINES + 1);
    });

    it('clamps lines outside the document', () => {
        expect(mapDiffLine(anchors, -5, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(1);
        expect(mapDiffLine(anchors, 999, 'original', ORIGINAL_LINES, MODIFIED_LINES)).toBe(MODIFIED_LINES + 1);
    });

    it('agrees in both directions, so neither pane drags the other away', () => {
        for (const line of [1, 1.5, 3, 5.5, 8, 9.25, 10]) {
            const other = mapDiffLine(anchors, line, 'original', ORIGINAL_LINES, MODIFIED_LINES);
            expect(mapDiffLine(anchors, other, 'modified', ORIGINAL_LINES, MODIFIED_LINES)).toBeCloseTo(line, 5);
        }
    });

    it('falls back to spreading the files over each other without anchors', () => {
        // What a file past the diff size limit, or a total rewrite, is left with.
        expect(mapDiffLine([], 1, 'original', 10, 20)).toBe(1);
        expect(mapDiffLine([], 6, 'original', 10, 20)).toBe(11);
        expect(mapDiffLine([], 11, 'original', 10, 20)).toBe(21);
    });

    it('ignores anchors that do not advance both sides, keeping the mapping invertible', () => {
        // The runs of a one-line match repeat a pair; a stale anchor may also sit
        // behind the previous one. Neither may create a segment to divide by.
        const degenerate: LineAnchor[] = [
            { original: 2, modified: 2 },
            { original: 2, modified: 2 },
            { original: 4, modified: 3 },
            { original: 3, modified: 9 },
        ];
        expect(mapDiffLine(degenerate, 2, 'original', 10, 10)).toBe(2);
        expect(mapDiffLine(degenerate, 4, 'original', 10, 10)).toBe(3);
        expect(Number.isFinite(mapDiffLine(degenerate, 3, 'original', 10, 10))).toBe(true);
    });
});

describe('computeDiff feeding mapDiffLine', () => {
    it('keeps the tail of an edited file aligned', () => {
        const head = 'one\ntwo\nthree\nfour\nfive';
        const working = 'one\ninserted\ntwo\nthree\nfour\nfive';
        const { anchors } = computeDiff(head, working);
        const lines = (text: string) => text.split('\n').length;
        // Everything from "two" on is pushed down one line in the working tree.
        for (const line of [3, 4, 5]) {
            expect(mapDiffLine(anchors, line, 'original', lines(head), lines(working))).toBe(line + 1);
        }
    });
});
