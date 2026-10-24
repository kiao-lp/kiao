import { type FrameTimeline, timelineOfTimes } from '../timeline';
import type { ByteSource } from './byteSource';

/**
 * MP4, and QuickTime's MOV it descends from (ISO/IEC 14496-12, the "ISO base media file format"):
 * a file made of boxes — a size, a four-letter type, a body — some of them made of boxes in turn.
 *
 * Where the images are is written in the `moov` box, in a table per track:
 *
 *     stts  how long each sample lasts, in decoding order
 *     ctts  how long after its decoding each is shown — a B-frame is decoded before the images
 *           it sits between, and shown after the first of them
 *     stss  which samples are key images; all of them when the box is absent
 *     elst  where the track starts on the movie's timeline — an encoder writing B-frames delays
 *           every image by as much, and says so here for the player to take off again
 *
 * A **fragmented** file keeps those tables empty and writes each stretch of samples in a `moof`
 * box of its own, just ahead of its pictures — what a recorder writes when a recording has to
 * survive being cut off half-way. Each of those is one more request, and they are all read.
 *
 * `moov` is at the start of a file written for the web and at its end otherwise; the boxes before
 * it are walked by their headers, a request each, without reading what they hold.
 */

/** How many pieces a file may take to read — a fragmented recording of a few hours, not more. */
const MAX_READS = 4000;
/** Read past a box header at once: a `moof` and the `mdat` header after it usually fit. */
const READ_AHEAD = 8192;
/** A table this long is a damaged file rather than a video: a day at 60 images a second is five million. */
const MAX_SAMPLES = 10_000_000;

const NON_SYNC_SAMPLE = 0x10000;

interface Box {
    type: string;
    payload: number;
    end: number;
}

const fourcc = (view: DataView, at: number): string =>
    String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** The boxes between `from` and `to`, in order; stops at the first that does not fit. */
const boxesIn = (view: DataView, from: number, to: number): Box[] => {
    const boxes: Box[] = [];
    let at = from;
    while (at + 8 <= to) {
        let size = view.getUint32(at);
        const type = fourcc(view, at + 4);
        let payload = at + 8;
        if (size === 1) {
            if (at + 16 > to) break;
            size = Number(view.getBigUint64(at + 8));
            payload = at + 16;
        } else if (size === 0) {
            size = to - at;
        }
        if (type === 'uuid') payload += 16;
        const end = at + size;
        if (size < payload - at || end > to) break;
        boxes.push({ type, payload, end });
        at = end;
    }
    return boxes;
};

const childBoxes = (view: DataView, parent: Box, type: string): Box[] =>
    boxesIn(view, parent.payload, parent.end).filter(box => box.type === type);

const childBox = (view: DataView, parent: Box, type: string): Box | undefined =>
    boxesIn(view, parent.payload, parent.end).find(box => box.type === type);

/** Throws unless `length` bytes from `at` are inside the box — a table longer than its box is a damaged file. */
const need = (box: Box, at: number, length: number): void => {
    if (at + length > box.end) throw new Error(`The ${box.type} box is shorter than it says`);
};

const versionOf = (view: DataView, box: Box): number => {
    need(box, box.payload, 4);
    return view.getUint8(box.payload);
};

/** `mvhd` and `mdhd` are laid out alike up to the timescale; `tkhd` puts its track id there. */
const fieldAfterDates = (view: DataView, box: Box): number => {
    const at = box.payload + (versionOf(view, box) === 1 ? 20 : 12);
    need(box, at, 4);
    return view.getUint32(at);
};

/** A full box's table: its entry count, having checked the box holds that many entries. */
const entryCount = (view: DataView, box: Box, entrySize: number): number => {
    need(box, box.payload + 4, 4);
    const count = view.getUint32(box.payload + 4);
    need(box, box.payload + 8, count * entrySize);
    return count;
};

/** Presentation times of a track's samples, in its own units, and those of its key images. */
interface Samples {
    times: number[];
    keys: number[];
    /** When the sample after the last would be decoded — where a fragment without a `tfdt` goes on from. */
    end: number;
}

/**
 * Where the track's images land on the movie's timeline, from its edit list read the way players
 * read one: leading empty edits delay the track, and the first real edit says which of its times
 * is shown first. Anything past that — a list of cuts — is a rarity neither the players nor this
 * follow.
 */
const editOf = (view: DataView, trak: Box, movieTimescale: number): { shift: number; delay: number } => {
    const edts = childBox(view, trak, 'edts');
    const elst = edts && childBox(view, edts, 'elst');
    if (!elst) return { shift: 0, delay: 0 };
    const long = versionOf(view, elst) === 1;
    const entrySize = long ? 20 : 12;
    const count = entryCount(view, elst, entrySize);
    let delay = 0;
    for (let i = 0; i < count; i++) {
        const at = elst.payload + 8 + i * entrySize;
        const duration = long ? Number(view.getBigUint64(at)) : view.getUint32(at);
        const mediaTime = long ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
        if (mediaTime === -1) {
            delay += movieTimescale > 0 ? duration / movieTimescale : 0;
            continue;
        }
        return { shift: mediaTime, delay };
    }
    return { shift: 0, delay };
};

const sampleTableOf = (view: DataView, stbl: Box | undefined): Samples => {
    const samples: Samples = { times: [], keys: [], end: 0 };
    const stts = stbl && childBox(view, stbl, 'stts');
    if (!stbl || !stts) return samples;
    const ctts = childBox(view, stbl, 'ctts');
    const stss = childBox(view, stbl, 'stss');

    const sttsCount = entryCount(view, stts, 8);
    const cttsCount = ctts ? entryCount(view, ctts, 8) : 0;
    const stssCount = stss ? entryCount(view, stss, 4) : 0;

    // The composition offsets run beside the durations, in runs of their own.
    let run = 0;
    let runLeft = 0;
    let runOffset = 0;
    const nextOffset = (): number => {
        while (runLeft === 0 && run < cttsCount) {
            runLeft = view.getUint32(ctts!.payload + 8 + run * 8);
            // Signed in both versions: a version-0 offset over 2^31 is a negative one written unsigned.
            runOffset = view.getInt32(ctts!.payload + 12 + run * 8);
            run++;
        }
        if (runLeft === 0) return 0;
        runLeft--;
        return runOffset;
    };

    // The key images, by sample number counted from one, in ascending order.
    let sync = 0;
    const isSync = (sample: number): boolean => {
        if (!stss) return true;
        while (sync < stssCount && view.getUint32(stss.payload + 8 + sync * 4) < sample) sync++;
        return sync < stssCount && view.getUint32(stss.payload + 8 + sync * 4) === sample;
    };

    let decodeTime = 0;
    let sample = 1;
    for (let entry = 0; entry < sttsCount; entry++) {
        const count = view.getUint32(stts.payload + 8 + entry * 8);
        const delta = view.getUint32(stts.payload + 12 + entry * 8);
        if (samples.times.length + count > MAX_SAMPLES) throw new Error('More samples than any video holds');
        for (let k = 0; k < count; k++, sample++) {
            const time = decodeTime + nextOffset();
            samples.times.push(time);
            if (isSync(sample)) samples.keys.push(time);
            decodeTime += delta;
        }
    }
    samples.end = decodeTime;
    return samples;
};

interface VideoTrack {
    id: number;
    timescale: number;
    shift: number;
    delay: number;
    samples: Samples;
    /** What a fragment's samples are when neither the fragment nor the sample says (`trex`). */
    defaultDuration: number;
    defaultFlags: number;
}

interface Movie {
    video: VideoTrack | null;
    fragmented: boolean;
}

const defaultsOf = (view: DataView, mvex: Box | undefined, trackId: number): { defaultDuration: number; defaultFlags: number } => {
    for (const trex of mvex ? childBoxes(view, mvex, 'trex') : []) {
        need(trex, trex.payload + 4, 20);
        if (view.getUint32(trex.payload + 4) === trackId) {
            return { defaultDuration: view.getUint32(trex.payload + 12), defaultFlags: view.getUint32(trex.payload + 20) };
        }
    }
    return { defaultDuration: 0, defaultFlags: 0 };
};

/** The movie, from a view holding its whole `moov` box: its first video track, and whether fragments follow. */
const readMovie = (view: DataView): Movie => {
    const [moov] = boxesIn(view, 0, view.byteLength);
    if (!moov) return { video: null, fragmented: false };
    const mvhd = childBox(view, moov, 'mvhd');
    const movieTimescale = mvhd ? fieldAfterDates(view, mvhd) : 0;
    const mvex = childBox(view, moov, 'mvex');

    for (const trak of childBoxes(view, moov, 'trak')) {
        const mdia = childBox(view, trak, 'mdia');
        const hdlr = mdia && childBox(view, mdia, 'hdlr');
        if (!mdia || !hdlr) continue;
        need(hdlr, hdlr.payload + 8, 4);
        if (fourcc(view, hdlr.payload + 8) !== 'vide') continue;
        const tkhd = childBox(view, trak, 'tkhd');
        const mdhd = childBox(view, mdia, 'mdhd');
        if (!tkhd || !mdhd) continue;
        const minf = childBox(view, mdia, 'minf');
        const id = fieldAfterDates(view, tkhd);
        return {
            video: {
                id,
                timescale: fieldAfterDates(view, mdhd),
                ...editOf(view, trak, movieTimescale),
                samples: sampleTableOf(view, minf && childBox(view, minf, 'stbl')),
                ...defaultsOf(view, mvex, id),
            },
            fragmented: !!mvex,
        };
    }
    return { video: null, fragmented: !!mvex };
};

/**
 * Adds the video track's samples in one `moof` to what is known, going on from `decodeTime` where
 * the fragment does not say where it starts. Returns where the next fragment goes on from.
 */
const readFragment = (view: DataView, video: VideoTrack, decodeTime: number): number => {
    const [moof] = boxesIn(view, 0, view.byteLength);
    if (!moof) return decodeTime;
    const { samples } = video;
    for (const traf of childBoxes(view, moof, 'traf')) {
        const tfhd = childBox(view, traf, 'tfhd');
        if (!tfhd) continue;
        need(tfhd, tfhd.payload, 8);
        if (view.getUint32(tfhd.payload + 4) !== video.id) continue;
        const flags = view.getUint32(tfhd.payload) & 0xffffff;
        let at = tfhd.payload + 8;
        if (flags & 0x01) at += 8; // base data offset
        if (flags & 0x02) at += 4; // sample description index
        let defaultDuration = video.defaultDuration;
        let defaultFlags = video.defaultFlags;
        if (flags & 0x08) {
            need(tfhd, at, 4);
            defaultDuration = view.getUint32(at);
            at += 4;
        }
        if (flags & 0x10) at += 4; // default sample size
        if (flags & 0x20) {
            need(tfhd, at, 4);
            defaultFlags = view.getUint32(at);
        }

        let time = decodeTime;
        const tfdt = childBox(view, traf, 'tfdt');
        if (tfdt) {
            const long = versionOf(view, tfdt) === 1;
            need(tfdt, tfdt.payload + 4, long ? 8 : 4);
            time = long ? Number(view.getBigUint64(tfdt.payload + 4)) : view.getUint32(tfdt.payload + 4);
        }

        for (const trun of childBoxes(view, traf, 'trun')) {
            need(trun, trun.payload, 8);
            const runFlags = view.getUint32(trun.payload) & 0xffffff;
            const count = view.getUint32(trun.payload + 4);
            let p = trun.payload + 8;
            if (runFlags & 0x01) p += 4; // data offset
            let firstFlags: number | null = null;
            if (runFlags & 0x04) {
                need(trun, p, 4);
                firstFlags = view.getUint32(p);
                p += 4;
            }
            const fields = [0x100, 0x200, 0x400, 0x800].filter(bit => runFlags & bit).length;
            need(trun, p, count * fields * 4);
            if (samples.times.length + count > MAX_SAMPLES) throw new Error('More samples than any video holds');
            for (let i = 0; i < count; i++) {
                let duration = defaultDuration;
                let sampleFlags = i === 0 && firstFlags !== null ? firstFlags : defaultFlags;
                let offset = 0;
                if (runFlags & 0x100) { duration = view.getUint32(p); p += 4; }
                if (runFlags & 0x200) p += 4; // size
                if (runFlags & 0x400) { sampleFlags = view.getUint32(p); p += 4; }
                if (runFlags & 0x800) { offset = view.getInt32(p); p += 4; }
                samples.times.push(time + offset);
                if (!(sampleFlags & NON_SYNC_SAMPLE)) samples.keys.push(time + offset);
                time += duration;
            }
        }
        decodeTime = time;
    }
    return decodeTime;
};

/**
 * The timeline of the first video track of an MP4 or MOV file — null when it has none (a
 * recording in an `.m4a`), or when the file cannot be read that far. `head` is the first bytes of
 * the file, already read.
 */
export const readIsoBmffTimeline = async (source: ByteSource, head: Uint8Array): Promise<FrameTimeline | null> => {
    let piece = { at: 0, bytes: head };
    let reads = 0;

    /** `length` bytes from `at`, out of the piece in hand when they are in it. */
    const bytesAt = async (at: number, length: number): Promise<DataView> => {
        if (at < piece.at || at + length > piece.at + piece.bytes.length) {
            if (++reads > MAX_READS) throw new Error('The file takes too many pieces to read');
            piece = { at, bytes: await source.read(at, Math.max(length, READ_AHEAD)) };
            if (piece.bytes.length < length) throw new Error('The file ends inside a box');
        }
        return new DataView(piece.bytes.buffer, piece.bytes.byteOffset + (at - piece.at), length);
    };

    let movie: Movie | null = null;
    let decodeTime = 0;
    for (let at = 0; at + 8 <= source.size;) {
        const header = await bytesAt(at, Math.min(16, source.size - at));
        let size = header.getUint32(0);
        const type = fourcc(header, 4);
        if (size === 1) {
            if (header.byteLength < 16) break;
            size = Number(header.getBigUint64(8));
        } else if (size === 0) {
            size = source.size - at;
        }
        if (size < 8) break;

        if (type === 'moov' && !movie) {
            movie = readMovie(await bytesAt(at, Math.min(size, source.size - at)));
            if (!movie.video) return null;
            decodeTime = movie.video.samples.end;
            if (!movie.fragmented) break;
        } else if (type === 'moof' && movie?.video) {
            decodeTime = readFragment(await bytesAt(at, Math.min(size, source.size - at)), movie.video, decodeTime);
        }
        at += size;
    }

    const video = movie?.video;
    if (!video || video.timescale === 0 || video.samples.times.length === 0) return null;
    const seconds = (time: number) => (time - video.shift) / video.timescale + video.delay;
    return timelineOfTimes(video.samples.times.map(seconds), video.samples.keys.map(seconds));
};
