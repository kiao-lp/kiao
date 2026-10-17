import { describe, expect, it } from 'vitest';
import {
    frameAt, frameEnd, frameSeekTime, frameStart, imageSpan, imageTime, lastFrame, seekTimeOf, stepFrame,
    stepKey, timelineOfTimes, type FrameTimeline,
} from './timeline';

/** Ten images a second for two seconds, keys at 0, 0.7 and 1.4 — `vp9.mp4`, as read from its file. */
const listed: FrameTimeline = {
    frames: Array.from({ length: 20 }, (_, i) => i / 10),
    frameDuration: 0.1,
    keys: [0, 0.7, 1.4],
};

/** The same, known only as evenly spaced — a Matroska file's `DefaultDuration`. */
const spaced: FrameTimeline = { frameDuration: 0.1, keys: [0, 0.7, 1.4] };

const DURATION = 2;

describe('where an image ends', () => {
    it('is where the next one starts, and the last one lasts until the file ends', () => {
        expect(frameEnd(listed, 7, DURATION)).toBeCloseTo(0.8, 9);
        expect(frameEnd(listed, 19, DURATION)).toBe(DURATION);
        // A file whose sound outlasts its pictures shows the last one until it ends.
        expect(frameEnd(listed, 19, 2.35)).toBe(2.35);
    });

    it('is its spacing on where the file does not list them, and never past the end of the file', () => {
        expect(frameEnd(spaced, 7, DURATION)).toBeCloseTo(0.8, 9);
        expect(frameEnd(spaced, 19, 1.95)).toBeCloseTo(1.95, 9);
        // While the length is not known.
        expect(frameEnd(spaced, 3, 0)).toBeCloseTo(0.4, 9);
    });

    // The two ends of a segment are images, and both are in it.
    it('makes a span from the start of the first image to the end of the last', () => {
        for (const timeline of [listed, spaced]) {
            const span = imageSpan(timeline, 0.7, 1.4, DURATION);
            expect(span.from).toBeCloseTo(0.7, 9);
            expect(span.to).toBeCloseTo(1.5, 9);
        }
        // Stored to the millisecond, the image at 31/30 s is still the one named, whole.
        const thirty: FrameTimeline = { frames: Array.from({ length: 60 }, (_, i) => i / 30), frameDuration: 1 / 30 };
        const span = imageSpan(thirty, 1.033, 1.033, 2);
        expect(span.from).toBeCloseTo(31 / 30, 9);
        expect(span.to).toBeCloseTo(32 / 30, 9);
    });
});

describe('which image is on screen', () => {
    it('is the last one to start at or before the time', () => {
        for (const timeline of [listed, spaced]) {
            expect(frameAt(timeline, 0)).toBe(0);
            expect(frameAt(timeline, 0.05)).toBe(0);
            expect(frameAt(timeline, 0.35)).toBe(3);
            expect(imageTime(timeline, 0.35)).toBeCloseTo(0.3, 9);
        }
    });

    // A time is stored in whole milliseconds: 1033 for an image starting at 31/30 s, which is
    // 1.0333… A time taken at its word would name the image before.
    it('is the image a time rounded to the millisecond was taken from', () => {
        const thirty: FrameTimeline = { frames: Array.from({ length: 60 }, (_, i) => i / 30), frameDuration: 1 / 30 };
        expect(frameAt(thirty, 1.033)).toBe(31);
        expect(frameAt(thirty, 1.067)).toBe(32);
        const evenly: FrameTimeline = { frameDuration: 1001 / 30000 };
        // An NTSC image at 1001 ms, written as a Matroska block timestamp.
        expect(frameAt(evenly, 1.001)).toBe(30);
    });

    it('is seeked to by its middle, which no rounding can move onto a neighbour', () => {
        expect(frameSeekTime(listed, 3)).toBeCloseTo(0.35, 9);
        expect(frameSeekTime(spaced, 3)).toBeCloseTo(0.35, 9);
        expect(seekTimeOf(listed, 0.7)).toBeCloseTo(0.75, 9);
        // Uneven images — a phone's recording — are seeked to the middle of their own span.
        const uneven: FrameTimeline = { frames: [0, 0.03, 0.1, 0.12], frameDuration: 0.03 };
        expect(frameSeekTime(uneven, 1)).toBeCloseTo(0.065, 9);
        expect(frameSeekTime(uneven, 3)).toBeCloseTo(0.135, 9);
    });

    it('starts where the file lists it, or where the spacing puts it', () => {
        expect(frameStart(listed, 7)).toBeCloseTo(0.7, 9);
        expect(frameStart(spaced, 7)).toBeCloseTo(0.7, 9);
    });
});

describe('stepping an image at a time', () => {
    it('goes one image forward and back', () => {
        for (const timeline of [listed, spaced]) {
            expect(stepFrame(timeline, 0.35, 1, DURATION)).toBeCloseTo(0.45, 9);
            expect(stepFrame(timeline, 0.35, -1, DURATION)).toBeCloseTo(0.25, 9);
        }
    });

    it('stops at either end', () => {
        for (const timeline of [listed, spaced]) {
            expect(stepFrame(timeline, 0, -1, DURATION)).toBeNull();
            expect(stepFrame(timeline, 1.95, 1, DURATION)).toBeNull();
            expect(stepFrame(timeline, 1.85, 1, DURATION)).toBeCloseTo(1.95, 9);
        }
    });

    // 2 / 0.1 is 20.000000000000004 in floating point: twenty images, not twenty-one.
    it('counts evenly spaced images without the floating point’s spare one', () => {
        expect(lastFrame(spaced, 2)).toBe(19);
        expect(lastFrame(listed, 2)).toBe(19);
        expect(lastFrame(spaced, 0)).toBe(-1);
    });
});

describe('stepping a key image at a time', () => {
    it('goes to the next and the previous key image', () => {
        for (const timeline of [listed, spaced]) {
            expect(stepKey(timeline, 0.35, 1, DURATION)).toBeCloseTo(0.75, 9);
            expect(stepKey(timeline, 0.35, -1, DURATION)).toBeCloseTo(0.05, 9);
        }
    });

    // Standing on one, "previous" is the one before it rather than the one underfoot.
    it('leaves the key image it is standing on', () => {
        expect(stepKey(listed, 0.75, -1, DURATION)).toBeCloseTo(0.05, 9);
        expect(stepKey(listed, 0.75, 1, DURATION)).toBeCloseTo(1.45, 9);
    });

    it('has nowhere to go past the last, or before the first', () => {
        expect(stepKey(listed, 1.45, 1, DURATION)).toBeNull();
        expect(stepKey(listed, 0.05, -1, DURATION)).toBeNull();
    });

    it('has nowhere to go in a file that lists none', () => {
        expect(stepKey({ frameDuration: 0.1 }, 0.35, 1, DURATION)).toBeNull();
    });
});

describe('a timeline made of presentation times', () => {
    it('puts them in order, and takes the usual gap for the image duration', () => {
        // Decoding order, B-frames and all, with one image dropped after 0.12.
        const timeline = timelineOfTimes([0, 0.12, 0.04, 0.08, 0.2, 0.24, 0.28], [0.2, 0]);
        expect(timeline.frames).toEqual([0, 0.04, 0.08, 0.12, 0.2, 0.24, 0.28]);
        expect(timeline.keys).toEqual([0, 0.2]);
        expect(timeline.frameDuration).toBeCloseTo(0.04, 9);
    });
});
