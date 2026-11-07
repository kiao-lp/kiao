import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEAD_BYTES, memorySource, readFrameTimeline, type ByteSource } from './index';

/** Where the images are, read out of real files. */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** A file served in pieces, counting them: each piece is one request over the wire. */
const served = (name: string) => {
    const file = memorySource(new Uint8Array(readFileSync(join(FIXTURES, name))));
    let reads = 0;
    const source: ByteSource = {
        size: file.size,
        read: (offset, length) => {
            reads++;
            return file.read(offset, length);
        },
    };
    return { source, reads: () => reads };
};

/** The timeline read the way the plugin reads it: a first piece, and whatever else it asks for. */
const read = async (name: string, headLength = HEAD_BYTES) => {
    const { source, reads } = served(name);
    const head = await source.read(0, headLength);
    const timeline = await readFrameTimeline(source, head);
    return { timeline, reads: reads() };
};

const every = (count: number, step: number, from = 0): number[] =>
    Array.from({ length: count }, (_, i) => from + i * step);

const expectTimes = (actual: number[] | undefined, expected: number[]) => {
    expect(actual).toBeDefined();
    expect(actual!.length).toBe(expected.length);
    actual!.forEach((time, i) => expect(time).toBeCloseTo(expected[i], 6));
};

describe('reading where the images of an MP4 are', () => {
    it('lists every image and the key images of a file written for the web', async () => {
        const { timeline, reads } = await read('vp9.mp4');
        expectTimes(timeline?.frames, every(20, 0.1));
        expectTimes(timeline?.keys, [0, 0.7, 1.4]);
        expect(timeline?.frameDuration).toBeCloseTo(0.1, 6);
        expect(reads).toBe(1);
    });

    // its edit list: read without either, every image would be two late and out of order.
    it('shows B-frames when they are shown, and takes the edit list’s shift off', async () => {
        const { timeline } = await read('h264-bframes.mp4');
        expectTimes(timeline?.frames, every(50, 0.04));
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
    });

    it('walks past the pictures to a moov written at the end, by their headers alone', async () => {
        const { timeline, reads } = await read('h264-bframes.mp4', 64);
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
        expect(reads).toBeLessThanOrEqual(5);
    });

    it('reads the images of a fragmented file out of its fragments', async () => {
        const { timeline } = await read('fragmented.mp4', 64);
        expectTimes(timeline?.frames, every(50, 0.04, 0.08));
        expectTimes(timeline?.keys, [0.08, 0.68, 1.28]);
    });

    it('reads a MOV, which is the same boxes', async () => {
        const { timeline } = await read('clip.mov');
        expectTimes(timeline?.frames, every(20, 0.1));
        expectTimes(timeline?.keys, [0, 0.7, 1.4]);
    });

    it('has nothing to say of a file with no video track', async () => {
        const { timeline } = await read('tone.m4a');
        expect(timeline).toBeNull();
    });
});

describe('reading where the images of a Matroska file are', () => {
    // Matroska lists no images, only its cues and how long each image lasts.
    it('takes the key images from the cues of a WebM, and the images from their duration', async () => {
        const { timeline } = await read('clip.webm');
        expect(timeline?.frames).toBeUndefined();
        expectTimes(timeline?.keys, [0, 0.7, 1.4]);
        expect(timeline?.frameDuration).toBeCloseTo(0.1, 6);
    });

    it('finds cues written after the pictures from the seek head', async () => {
        const { timeline, reads } = await read('clip.mkv', 4096);
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
        expect(timeline?.frameDuration).toBeCloseTo(0.04, 6);
        // The first piece, then the cues' header and their body — never the clusters between.
        expect(reads).toBeLessThanOrEqual(3);
    });

    it('reads what the first piece cut in two', async () => {
        const { timeline } = await read('clip.mkv', 256);
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
        expect(timeline?.frameDuration).toBeCloseTo(0.04, 6);
    });
});

describe('a file that is neither', () => {
    it('is not read as one', async () => {
        const text = new TextEncoder().encode('# Not a video\n\nJust some markdown.\n');
        const source = memorySource(text);
        expect(await readFrameTimeline(source, text)).toBeNull();
    });
});
