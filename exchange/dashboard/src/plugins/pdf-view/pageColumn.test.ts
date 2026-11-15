import { describe, it, expect } from 'vitest';
import {
    anchoredScrollTop,
    columnRatios,
    DEFAULT_RATIO,
    layOutColumn,
    pageAt,
    pageInFocus,
    pagesInView,
    scrollTopFor,
} from './pageColumn';

/** Ten pages 100px wide and 200px tall, 10px apart: page n starts at 10 + (n - 1) * 210. */
const uniform = layOutColumn(new Array(10).fill(2), 100, 10);

describe('columnRatios', () => {
    it('falls back to A4 until any page has been measured', () => {
        expect(columnRatios(3, new Map())).toEqual([DEFAULT_RATIO, DEFAULT_RATIO, DEFAULT_RATIO]);
    });

    it('lends the first page\'s proportion to every page not measured yet', () => {
        expect(columnRatios(3, new Map([[1, 1.5]]))).toEqual([1.5, 1.5, 1.5]);
    });

    it('prefers a page\'s own proportion over the borrowed one', () => {
        expect(columnRatios(3, new Map([[1, 1.5], [2, 0.7]]))).toEqual([1.5, 0.7, 1.5]);
    });

    it('is empty for a document that has not loaded', () => {
        expect(columnRatios(0, new Map())).toEqual([]);
    });
});

describe('layOutColumn', () => {
    it('stacks the pages with a gap above, below and between', () => {
        expect(uniform.boxes[0]).toEqual({ top: 10, height: 200 });
        expect(uniform.boxes[1]).toEqual({ top: 220, height: 200 });
        expect(uniform.boxes[9]).toEqual({ top: 1900, height: 200 });
        expect(uniform.height).toBe(2110);
    });

    it('gives a landscape page a box of its own shape', () => {
        const mixed = layOutColumn([2, 0.5, 2], 100, 10);
        expect(mixed.boxes.map(b => b.height)).toEqual([200, 50, 200]);
        expect(mixed.boxes.map(b => b.top)).toEqual([10, 220, 280]);
    });

    it('lays out nothing before the width or the page count is known', () => {
        expect(layOutColumn([2, 2], 0, 10).boxes).toEqual([]);
        expect(layOutColumn([], 100, 10).boxes).toEqual([]);
    });
});

describe('pageAt', () => {
    it('finds the page holding an offset', () => {
        expect(pageAt(uniform, 0)).toBe(1);
        expect(pageAt(uniform, 209)).toBe(1);
        expect(pageAt(uniform, 220)).toBe(2);
        expect(pageAt(uniform, 1999)).toBe(10);
    });

    it('has no page to name for an empty column', () => {
        expect(pageAt(layOutColumn([], 100, 10), 0)).toBe(0);
    });
});

describe('pagesInView', () => {
    it('mounts what the viewport shows, plus the overscan either side', () => {
        // A 400px viewport at page 3 shows pages 3 and 4.
        expect(pagesInView(uniform, 430, 400, 1)).toEqual({ first: 2, last: 5 });
    });

    it('mounts only the visible pages when nothing is overscanned', () => {
        expect(pagesInView(uniform, 430, 400, 0)).toEqual({ first: 3, last: 4 });
    });

    it('does not run off either end of the document', () => {
        expect(pagesInView(uniform, 0, 400, 2)).toEqual({ first: 1, last: 4 });
        expect(pagesInView(uniform, 1900, 400, 2)).toEqual({ first: 8, last: 10 });
    });

    it('mounts nothing while the column is empty', () => {
        const { first, last } = pagesInView(layOutColumn([], 100, 10), 0, 400, 1);
        expect(last).toBeLessThan(first);
    });
});

describe('pageInFocus', () => {
    it('names the page covering most of the viewport', () => {
        expect(pageInFocus(uniform, 10, 300)).toBe(1);
        // 20px of page 1 left against 200px of page 2.
        expect(pageInFocus(uniform, 190, 300)).toBe(2);
    });

    it('turns the page as its successor takes over the screen', () => {
        // Page 1 keeps 105 of the 200px viewport…
        expect(pageInFocus(uniform, 105, 200)).toBe(1);
        // …and loses it ten pixels later.
        expect(pageInFocus(uniform, 125, 200)).toBe(2);
    });

    it('answers from the offset alone before the viewport has been measured', () => {
        expect(pageInFocus(uniform, 640, 0)).toBe(4);
    });
});

describe('scrollTopFor', () => {
    it('brings a page to the top of the viewport, its gap above it', () => {
        expect(scrollTopFor(uniform, 1)).toBe(0);
        expect(scrollTopFor(uniform, 3)).toBe(420);
    });

    it('clamps a page number the document does not have', () => {
        expect(scrollTopFor(uniform, 0)).toBe(0);
        expect(scrollTopFor(uniform, 99)).toBe(scrollTopFor(uniform, 10));
    });
});

describe('anchoredScrollTop', () => {
    it('keeps the reading position across a zoom step', () => {
        const zoomed = layOutColumn(new Array(10).fill(2), 200, 10);
        // Half way down page 3 (430 + 100) stays half way down page 3 (830 + 200).
        expect(anchoredScrollTop(uniform, zoomed, 530)).toBe(1030);
    });

    it('absorbs a page above the viewport turning out to be shorter than it was assumed', () => {
        const corrected = layOutColumn([2, 0.5, 2, 2, 2, 2, 2, 2, 2, 2], 100, 10);
        // Reading the top of page 3, which page 2 shrinking by 150px pulls up by exactly that.
        expect(anchoredScrollTop(uniform, corrected, 430)).toBe(280);
    });

    it('leaves the offset alone while either column is empty', () => {
        expect(anchoredScrollTop(layOutColumn([], 100, 10), uniform, 430)).toBe(430);
        expect(anchoredScrollTop(uniform, layOutColumn([], 100, 10), 430)).toBe(430);
    });
});
