import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEAD_BYTES, memorySource, readFrameTimeline, type ByteSource } from './index';

/**
 * Where the images are, read out of real files. Each fixture is a two-second clip ffmpeg wrote, and
 * each is checked against what `ffprobe` says of the same file — the key images were forced at
 * irregular times so that no guess at a regular spacing could pass for reading them.
 *
 *     ffmpeg -f lavfi -i testsrc2=size=64x36:rate=10:duration=2 -c:v libvpx-vp9 -g 100 \
 *            -force_key_frames 0,0.7,1.4 -b:v 20k -pix_fmt yuv420p -an -movflags +faststart vp9.mp4
 *
 * The others are the same with `rate=25` and `libx264 -bf 2 -force_key_frames 0,0.6,1.2` (B-frames,
 * so an edit list and composition offsets; `moov` at the end), that again with
 * `-movflags frag_keyframe+empty_moov+default_base_moof` (fragmented), `mpeg4` into a `.mov`,
 * `libvpx` into a `.webm`, `libx264` into a `.mkv`, and a sine tone into an `.m4a`.
 */

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
        // The whole of it is in the first piece: nothing more is asked for.
        expect(reads).toBe(1);
    });

    // B-frames are decoded before they are shown, and the encoder shifts the track by as much in
    // its edit list: read without either, every image would be two late and out of order.
    it('shows B-frames when they are shown, and takes the edit list’s shift off', async () => {
        const { timeline } = await read('h264-bframes.mp4');
        expectTimes(timeline?.frames, every(50, 0.04));
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
    });

    it('walks past the pictures to a moov written at the end, by their headers alone', async () => {
        const { timeline, reads } = await read('h264-bframes.mp4', 64);
        expectTimes(timeline?.keys, [0, 0.6, 1.2]);
        // ftyp, free and mdat are stepped over from their headers; moov is read whole.
        expect(reads).toBeLessThanOrEqual(5);
    });

    // A fragmented file has an empty table and a moof ahead of each stretch of pictures. ffprobe
    // puts its first image at 0.08: nothing shifts it back, there being no edit list to say so.
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
