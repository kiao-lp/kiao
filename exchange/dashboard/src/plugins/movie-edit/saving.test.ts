import { describe, expect, it } from 'vitest';
import { planSave, segmentFileName } from './saving';
import type { Segment } from './segments';

const segment = (name: string, startMs: number, endMs: number): Segment => ({ id: name || 'unnamed', name, startMs, endMs });

/** Images a tenth of a second long: a segment runs on to the end of its last one. */
const spanOf = (s: Segment) => ({ fromMs: s.startMs, toMs: s.endMs + 100 });

describe('the file a segment is saved as', () => {
    it('is named after the segment, as the store names a file after a title', () => {
        expect(segmentFileName('Intro')).toBe('Intro');
        expect(segmentFileName('  Le vrai début  ')).toBe('Le vrai début');
        // A slash would make it two folders deep, and stays one name.
        expect(segmentFileName('Scène 2/3')).toBe('Scène 2-3');
        // A dot in front would hide it.
        expect(segmentFileName('.intro')).toBe('intro');
        expect(segmentFileName('...')).toBe('');
    });
});

describe('a save', () => {
    it('asks for each segment under its file name, over the stretch it covers', () => {
        const plan = planSave([segment('Intro', 0, 600), segment('Scène 2/3', 700, 1400)], spanOf, 'clip.mp4');
        expect(plan.problem).toBeNull();
        expect(plan.segments).toEqual([
            { name: 'Intro', fromMs: 0, toMs: 700 },
            { name: 'Scène 2-3', fromMs: 700, toMs: 1500 },
        ]);
        expect(plan.files).toEqual(['Intro.mkv', 'Scène 2-3.mkv']);
    });

    it('is refused, with the segment to rename', () => {
        expect(planSave([], spanOf, 'clip.mp4').problem).toMatch(/no segment to save/);
        expect(planSave([segment('...', 0, 100)], spanOf, 'clip.mp4').problem).toMatch(/“...” leaves nothing/);
        expect(planSave([segment('', 0, 100)], spanOf, 'clip.mp4').problem).toMatch(/A segment with no name/);
        // Whatever the case, as a Drive or a Windows disk compares names.
        expect(planSave([segment('Intro', 0, 100), segment('intro', 200, 300)], spanOf, 'clip.mp4').problem)
            .toMatch(/“Intro” and “intro” would both be saved as intro\.mkv/);
        expect(planSave([segment('Clip', 0, 100)], spanOf, 'clip.mkv').problem).toMatch(/over the video itself/);
        // A recording's segment has only its two times, and they can be one.
        const asStored = (s: Segment) => ({ fromMs: s.startMs, toMs: s.endMs });
        expect(planSave([segment('Intro', 100, 100)], asStored, 'talk.mp3').problem).toMatch(/ends where it starts/);
    });
});
