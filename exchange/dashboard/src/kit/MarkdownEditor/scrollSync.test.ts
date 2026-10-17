import { describe, it, expect } from 'vitest';
import { offsetToSourceLine, sourceLineToOffset, SourceAnchor } from './scrollSync';

// A heading at line 1, a paragraph at line 3 and a list at line 7, in a 10-line
// document rendering 1000px tall.
const anchors: SourceAnchor[] = [
    { line: 1, top: 0 },
    { line: 3, top: 100 },
    { line: 7, top: 300 },
];
const TOTAL_LINES = 10;
const HEIGHT = 1000;

describe('sourceLineToOffset', () => {
    it('puts an anchored line at its own block, so the same element is topmost', () => {
        expect(sourceLineToOffset(anchors, 3, TOTAL_LINES, HEIGHT)).toBe(100);
        expect(sourceLineToOffset(anchors, 7, TOTAL_LINES, HEIGHT)).toBe(300);
    });

    it('interpolates between anchors', () => {
        expect(sourceLineToOffset(anchors, 2, TOTAL_LINES, HEIGHT)).toBe(50);
        expect(sourceLineToOffset(anchors, 5, TOTAL_LINES, HEIGHT)).toBe(200);
    });

    it('reads a fractional line as a fraction of the way to the next anchor', () => {
        expect(sourceLineToOffset(anchors, 1.5, TOTAL_LINES, HEIGHT)).toBe(25);
    });

    it('maps the document ends to the content ends', () => {
        expect(sourceLineToOffset(anchors, 1, TOTAL_LINES, HEIGHT)).toBe(0);
        expect(sourceLineToOffset(anchors, TOTAL_LINES + 1, TOTAL_LINES, HEIGHT)).toBe(HEIGHT);
    });

    it('clamps lines outside the document', () => {
        expect(sourceLineToOffset(anchors, -5, TOTAL_LINES, HEIGHT)).toBe(0);
        expect(sourceLineToOffset(anchors, 999, TOTAL_LINES, HEIGHT)).toBe(HEIGHT);
    });
});

describe('offsetToSourceLine', () => {
    it('reports the line of the block at the offset', () => {
        expect(offsetToSourceLine(anchors, 100, TOTAL_LINES, HEIGHT)).toBe(3);
        expect(offsetToSourceLine(anchors, 300, TOTAL_LINES, HEIGHT)).toBe(7);
    });

    it('interpolates between anchors', () => {
        expect(offsetToSourceLine(anchors, 50, TOTAL_LINES, HEIGHT)).toBe(2);
        expect(offsetToSourceLine(anchors, 200, TOTAL_LINES, HEIGHT)).toBe(5);
    });

    it('clamps offsets outside the content', () => {
        expect(offsetToSourceLine(anchors, -20, TOTAL_LINES, HEIGHT)).toBe(1);
        expect(offsetToSourceLine(anchors, HEIGHT * 2, TOTAL_LINES, HEIGHT)).toBe(TOTAL_LINES + 1);
    });
});

describe('round trips', () => {
    it('agrees in both directions, so neither pane drags the other away', () => {
        for (const line of [1, 1.5, 2, 3, 4.25, 7, 9, 10]) {
            const offset = sourceLineToOffset(anchors, line, TOTAL_LINES, HEIGHT);
            expect(offsetToSourceLine(anchors, offset, TOTAL_LINES, HEIGHT)).toBeCloseTo(line, 5);
        }
    });
});

describe('degenerate anchors', () => {
    it('still maps when the preview has no blocks at all', () => {
        expect(sourceLineToOffset([], 1, TOTAL_LINES, HEIGHT)).toBe(0);
        expect(sourceLineToOffset([], 6, TOTAL_LINES, HEIGHT)).toBe(500);
        expect(offsetToSourceLine([], 500, TOTAL_LINES, HEIGHT)).toBe(6);
    });

    it('ignores anchors that do not move forward, keeping the mapping invertible', () => {
        // Blocks sharing a line (a list and its first item) or a position must not
        // create a zero-width segment to divide by.
        const collapsed: SourceAnchor[] = [
            { line: 3, top: 100 },
            { line: 3, top: 100 },
            { line: 4, top: 100 },
            { line: 5, top: 200 },
            { line: 2, top: 400 },
        ];
        expect(sourceLineToOffset(collapsed, 3, TOTAL_LINES, HEIGHT)).toBe(100);
        expect(sourceLineToOffset(collapsed, 5, TOTAL_LINES, HEIGHT)).toBe(200);
        expect(Number.isFinite(sourceLineToOffset(collapsed, 4, TOTAL_LINES, HEIGHT))).toBe(true);
        expect(offsetToSourceLine(collapsed, 150, TOTAL_LINES, HEIGHT)).toBe(4);
    });

    it('ignores unparsable anchors', () => {
        const broken: SourceAnchor[] = [{ line: Number.NaN, top: 50 }, { line: 5, top: 200 }];
        expect(sourceLineToOffset(broken, 5, TOTAL_LINES, HEIGHT)).toBe(200);
    });
});
