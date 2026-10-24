import { describe, expect, it } from 'vitest';
import { indexForSlot, moveInArray, slotAt } from './reorder';

const row = (top: number, height = 20) => ({ top, bottom: top + height });

describe('moveInArray', () => {
    it('moves an item down, closing the gap behind it', () => {
        expect(moveInArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves an item up, pushing the others down', () => {
        expect(moveInArray(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('returns the very same list when nothing moves', () => {
        const list = ['a', 'b'];
        expect(moveInArray(list, 1, 1)).toBe(list);
        expect(moveInArray(list, 0, 5)).toBe(list);
        expect(moveInArray(list, -1, 0)).toBe(list);
    });
});

describe('indexForSlot', () => {
    // Slots above the row are indices already; below it they count one more than the landing
    // index, because the row itself is no longer in the way.
    it('reads a slot above the dragged row as the index itself', () => {
        expect(indexForSlot(3, 0)).toBe(0);
        expect(indexForSlot(3, 3)).toBe(3);
    });

    it('discounts the gap the row leaves behind for a slot below it', () => {
        expect(indexForSlot(0, 4)).toBe(3);
        expect(indexForSlot(1, 2)).toBe(1);
    });

    // The two slots touching the row both mean "leave it where it is".
    it('makes both slots around the row a no-op', () => {
        expect(indexForSlot(2, 2)).toBe(2);
        expect(indexForSlot(2, 3)).toBe(2);
    });
});

describe('slotAt', () => {
    const rows = [row(0), row(20), row(40)];

    it('puts the pointer in the gap above the row whose middle it has not passed', () => {
        expect(slotAt(5, rows)).toBe(0);
        expect(slotAt(15, rows)).toBe(1);
        expect(slotAt(35, rows)).toBe(2);
    });

    it('falls through to the gap below the last row', () => {
        expect(slotAt(55, rows)).toBe(3);
    });

    it('hands neighbouring rows the two halves of the gap they share', () => {
        expect(slotAt(9, rows)).toBe(0);
        expect(slotAt(10, rows)).toBe(1);
    });

    it('skips rows that are not mounted', () => {
        expect(slotAt(35, [row(0), null, row(40)])).toBe(2);
    });
});
