import { describe, it, expect } from 'vitest';

import { UserBounds } from '../model';
import {
    MIN_NOTE_SIZE, centreOf, drawnSize, resizedAroundCentre, resizedByEdge
} from './note-resize';

/** Where the note's middle sits, of whatever a resize gave back. */
const centre = (bounds: UserBounds, measured?: [number, number]) =>
    centreOf(bounds, drawnSize(bounds, measured && [bounds[0], bounds[1], ...measured])!);

describe('drawnSize', () => {
    it('takes the size the note was given', () => {
        expect(drawnSize([10, 20, 300, 100], [10, 20, 42, 42])).toEqual([300, 100]);
    });

    it('falls back to the measured size for a dimension left to grow with the text', () => {
        expect(drawnSize([10, 20, null, null], [10, 20, 113, 95])).toEqual([113, 95]);
        expect(drawnSize([10, 20, 300, null], [10, 20, 300, 95])).toEqual([300, 95]);
    });

    it('has no answer before the note has been measured', () => {
        expect(drawnSize([10, 20, null, null])).toBeUndefined();
    });
});

describe('resizedAroundCentre', () => {
    // The whole promise: whichever way a note is resized, it is still centred where it was.
    it('keeps the middle where it was when the note grows', () => {
        const before: UserBounds = [100, 100, 200, 80];

        const after = resizedAroundCentre(before, [200, 80], [300, 80]);

        expect(centre(after)).toEqual(centre(before));
        expect(after).toEqual([50, 100, 300, 80]);
    });

    it('keeps the middle where it was when the note shrinks', () => {
        const before: UserBounds = [100, 100, 200, 80];

        const after = resizedAroundCentre(before, [200, 80], [200, 40]);

        expect(centre(after)).toEqual(centre(before));
        expect(after).toEqual([100, 120, 200, 40]);
    });

    // A first resize of a note that had never been given a size starts from what it measured,
    // so it does not jump the moment it is touched.
    it('centres the first size on the measured one', () => {
        const before: UserBounds = [100, 100, null, null];

        const after = resizedAroundCentre(before, [113, 95], [213, null]);

        expect(after).toEqual([50, 100, 213, null]);
        expect(centre(after, [213, 95])).toEqual(centre(before, [113, 95]));
    });

    // Nothing said where that edge should go, so the note keeps the corner it grows from.
    it('leaves the corner alone on a dimension left auto', () => {
        expect(resizedAroundCentre([100, 100, null, null], [113, 95], [null, 195]))
            .toEqual([100, 50, null, 195]);
    });

    it('never makes a note smaller than its floor', () => {
        expect(resizedAroundCentre([100, 100, 200, 80], [200, 80], [-40, 2]))
            .toEqual([200 - MIN_NOTE_SIZE / 2, 140 - MIN_NOTE_SIZE / 2, MIN_NOTE_SIZE, MIN_NOTE_SIZE]);
    });

    it('writes whole pixels for a size', () => {
        expect(resizedAroundCentre([100, 100, 200, 80], [200, 80], [201.4, 80.6]))
            .toEqual([99.5, 99.5, 201, 81]);
    });
});

describe('resizedByEdge', () => {
    const note: UserBounds = [100, 100, 200, 80];   // middle at (200, 140)

    it('follows the hand with the edge dragged, mirroring the one opposite', () => {
        expect(resizedByEdge(note, [200, 80], 'right', [350, 140])).toEqual([50, 100, 300, 80]);
        expect(resizedByEdge(note, [200, 80], 'left', [50, 140])).toEqual([50, 100, 300, 80]);
    });

    it('resizes the same way by the top and by the bottom', () => {
        expect(resizedByEdge(note, [200, 80], 'bottom', [200, 200])).toEqual([100, 80, 200, 120]);
        expect(resizedByEdge(note, [200, 80], 'top', [200, 80])).toEqual([100, 80, 200, 120]);
    });

    it('leaves the note centred where it was, whichever edge is pulled', () => {
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
            expect(centre(resizedByEdge(note, [200, 80], edge, [312, 47]))).toEqual(centre(note));
        }
    });

    // A note widened by its side goes on growing downwards with its text.
    it('says nothing of the dimension the edge dragged is not about', () => {
        // Middle at (156.5, 147.5); the right edge pulled to 200 makes it 87 wide about that.
        expect(resizedByEdge([100, 100, null, null], [113, 95], 'right', [200, 147]))
            .toEqual([113, 100, 87, null]);
    });

    it('stops at the floor rather than turning the note inside out', () => {
        const crossed = resizedByEdge(note, [200, 80], 'right', [150, 140]);

        expect(crossed[2]).toBe(MIN_NOTE_SIZE);
        expect(centre(crossed)).toEqual(centre(note));
    });
});
