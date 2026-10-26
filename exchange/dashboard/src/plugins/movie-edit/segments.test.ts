import { describe, expect, it } from 'vitest';
import {
    addSegment, formatTime, mediaConfigCodec, mediaConfigPath, nextSegmentName, removeSegment,
    renameSegment, segmentsOf, setSegmentEnd, setSegmentStart, type MediaConfig, type Segment,
} from './segments';

const { parse, serialize } = mediaConfigCodec;

const segment = (id: string, startMs: number, endMs: number, name = id): Segment => ({ id, name, startMs, endMs });

describe('the sidecar', () => {
    it('sits beside the file it cuts, under its whole name', () => {
        expect(mediaConfigPath('/films/clip.mp4')).toBe('/films/clip.mp4.config.json');
    });

    // A video nobody has cut has no sidecar, and a file that is not there reads as empty.
    it('reads an empty file as no segments rather than as a broken one', () => {
        expect(parse('')).toEqual({});
        expect(parse('  \n')).toEqual({});
        expect(segmentsOf(parse(''))).toEqual([]);
    });

    it('refuses what is not a sidecar, so that nothing is written over it', () => {
        expect(() => parse('{ "segments": [')).toThrow();
        expect(() => parse('[]')).toThrow();
        expect(() => parse('{ "segments": {} }')).toThrow();
        expect(() => parse('{ "segments": [{ "name": "Intro", "start": 1.2 }] }')).toThrow();
    });

    it('forgives what has one obvious reading', () => {
        const config = parse('{ "segments": [{ "startMs": 900, "endMs": 400.4 }, { "id": "a", "name": "A", "startMs": 100, "endMs": 200 }] }');
        expect(segmentsOf(config)).toEqual([
            segment('a', 100, 200, 'A'),
            segment('segment-1', 400, 900, ''),
        ]);
    });

    it('gives each segment an identity of its own', () => {
        const config = parse('{ "segments": [{ "id": "x", "startMs": 0, "endMs": 1 }, { "id": "x", "startMs": 2, "endMs": 3 }] }');
        expect(segmentsOf(config).map(s => s.id)).toEqual(['x', 'x-2']);
    });

    // The sidecar is the file's, not this plugin's.
    it('carries what it does not know through, at both levels', () => {
        const text = '{ "title": "Holiday", "segments": [{ "id": "a", "name": "A", "startMs": 0, "endMs": 5, "note": "keep" }] }';
        const back = JSON.parse(serialize(renameSegment(parse(text), 'a', 'B')));
        expect(back).toEqual({ title: 'Holiday', segments: [{ id: 'a', name: 'B', startMs: 0, endMs: 5, note: 'keep' }] });
    });
});

describe('editing the segments', () => {
    const empty: MediaConfig = {};

    it('adds a segment where the reader stands, named for the next free number', () => {
        const once = addSegment(empty, 'a', 1200);
        expect(segmentsOf(once)).toEqual([segment('a', 1200, 1200, 'Segment 1')]);
        const twice = addSegment(once, 'b', 300);
        // In the order they come in the video, not in the order they were made.
        expect(segmentsOf(twice).map(s => s.name)).toEqual(['Segment 2', 'Segment 1']);
    });

    it('names a new segment after a number nobody holds', () => {
        expect(nextSegmentName([segment('a', 0, 1, 'Segment 2')])).toBe('Segment 3');
        expect(nextSegmentName([segment('a', 0, 1, 'Intro'), segment('b', 2, 3, 'Segment 3')])).toBe('Segment 4');
    });

    it('never lets a segment end before it starts', () => {
        const config: MediaConfig = { segments: [segment('a', 1000, 2000)] };
        expect(segmentsOf(setSegmentStart(config, 'a', 1500))[0]).toMatchObject({ startMs: 1500, endMs: 2000 });
        // A start set past the end takes the end along with it.
        expect(segmentsOf(setSegmentStart(config, 'a', 2500))[0]).toMatchObject({ startMs: 2500, endMs: 2500 });
        expect(segmentsOf(setSegmentEnd(config, 'a', 1800))[0]).toMatchObject({ startMs: 1000, endMs: 1800 });
        // And an end set before the start takes the start back.
        expect(segmentsOf(setSegmentEnd(config, 'a', 400))[0]).toMatchObject({ startMs: 400, endMs: 400 });
    });

    it('keeps the list in order as a start moves', () => {
        const config: MediaConfig = { segments: [segment('a', 1000, 2000), segment('b', 3000, 4000)] };
        expect(segmentsOf(setSegmentStart(config, 'b', 500)).map(s => s.id)).toEqual(['b', 'a']);
    });

    it('renames and removes by identity', () => {
        const config: MediaConfig = { segments: [segment('a', 0, 1, 'Same'), segment('b', 2, 3, 'Same')] };
        expect(segmentsOf(renameSegment(config, 'b', 'Other')).map(s => s.name)).toEqual(['Same', 'Other']);
        expect(segmentsOf(removeSegment(config, 'a')).map(s => s.id)).toEqual(['b']);
    });
});

describe('a time as it is shown', () => {
    it('is precise to the millisecond, with hours only when there are some', () => {
        expect(formatTime(0)).toBe('0:00.000');
        expect(formatTime(700)).toBe('0:00.700');
        expect(formatTime(62_345)).toBe('1:02.345');
        expect(formatTime(3_723_456)).toBe('1:02:03.456');
    });
});
