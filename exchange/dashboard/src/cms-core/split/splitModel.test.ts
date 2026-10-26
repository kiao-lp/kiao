import { describe, it, expect } from 'vitest';
import { DEFAULT_PART_WEIGHT, MIN_PART_SIZE, weightOf, weightsAfterDrag } from './splitModel';

/** Two parts of a 1000px row, sharing it evenly — the state a row opens in. */
const evenPair = {
    beforeSize: 500, afterSize: 500, beforeExtra: 0, afterExtra: 0, beforeWeight: 1, afterWeight: 1,
};

describe('part weights', () => {
    it('gives a part nobody has dragged the same share as every other', () => {
        expect(weightOf({}, 'preview')).toBe(DEFAULT_PART_WEIGHT);
        expect(weightOf({ source: 1.4 }, 'preview')).toBe(DEFAULT_PART_WEIGHT);
        expect(weightOf({ source: 1.4 }, 'source')).toBe(1.4);
    });
});

describe('dragging a handle', () => {
    it('moves what one part gains off the other, and nothing else', () => {
        const { before, after } = weightsAfterDrag(evenPair, 100);
        // 600px of the 1000 the pair holds, out of the two weights they held between them.
        expect(before).toBeCloseTo(1.2);
        expect(after).toBeCloseTo(0.8);
        expect(before + after).toBeCloseTo(2);
    });

    it('reads the new share off the width, whatever the pair was worth', () => {
        // A pair already dragged: the same gesture must still describe the widths on screen.
        const pair = {
            beforeSize: 200, afterSize: 800, beforeExtra: 0, afterExtra: 0,
            beforeWeight: 0.5, afterWeight: 2,
        };
        const { before, after } = weightsAfterDrag(pair, 300);
        expect(before).toBeCloseTo(1.25);
        expect(after).toBeCloseTo(1.25);
    });

    // What a part is inset by is width its weight never bought: the preview pane's 20 pixels of
    // padding are there whatever it is worth, and only the 960 left of the row are shared out.
    // The handle has to land under the cursor all the same.
    it('leaves what a part is inset by out of the share', () => {
        const inset = {
            beforeSize: 520, afterSize: 480, beforeExtra: 40, afterExtra: 0,
            beforeWeight: 1, afterWeight: 1,
        };
        const { before, after } = weightsAfterDrag(inset, 100);
        // 620 on screen, of which 580 is share: 580 of the 960 the two of them share out.
        expect(before).toBeCloseTo((2 * 580) / 960);
        expect(before + after).toBeCloseTo(2);
    });

    it('never drags a part away to nothing', () => {
        const dragged = weightsAfterDrag(evenPair, -900);
        // 80px of 1000, and the handle is still there to bring the pane back.
        expect(dragged.before).toBeCloseTo((2 * MIN_PART_SIZE) / 1000);
        expect(dragged.after).toBeCloseTo(2 - dragged.before);
    });

    it('splits the difference in a row too narrow to hold two of them', () => {
        const pair = {
            beforeSize: 50, afterSize: 50, beforeExtra: 0, afterExtra: 0,
            beforeWeight: 1, afterWeight: 1,
        };
        expect(weightsAfterDrag(pair, -80)).toEqual({ before: 1, after: 1 });
    });

    it('leaves a pair that is not on screen alone', () => {
        const offScreen = {
            beforeSize: 0, afterSize: 0, beforeExtra: 0, afterExtra: 0,
            beforeWeight: 1, afterWeight: 1,
        };
        expect(weightsAfterDrag(offScreen, 100)).toEqual({ before: 1, after: 1 });
    });
});
