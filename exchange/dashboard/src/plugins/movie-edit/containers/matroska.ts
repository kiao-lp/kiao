import type { FrameTimeline } from '../timeline';
import type { ByteSource } from './byteSource';

/**
 * Matroska, and WebM, which is Matroska with fewer codecs (EBML, RFC 8794; its elements, RFC
 * 9559): a tree of elements, each an id, a length and a body, the first two written in as few
 * bytes as they need.
 *
 * Its images are listed nowhere short of every block of the file, which is to say the whole file.
 * What is listed is the **cues** — the file's own index of the places a player can start from —
 * and on a video track those are its key images, a cue being only ever written where decoding can
 * begin. With the track's `DefaultDuration`, how long each image lasts, that is enough for both
 * moves: an image at a time, and a key image at a time.
 *
 * The cues are usually written last. The **seek head**, at the start, says where: two requests
 * past the first, whatever the length of the file.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const SEEK = 0x4dbb;
const SEEK_ID = 0x53ab;
const SEEK_POSITION = 0x53ac;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_TYPE = 0x83;
const DEFAULT_DURATION = 0x23e383;
const CUES = 0x1c53bb6b;
const CUE_POINT = 0xbb;
const CUE_TIME = 0xb3;
const CUE_TRACK_POSITIONS = 0xb7;
const CUE_TRACK = 0xf7;
const CLUSTER = 0x1f43b675;

const VIDEO_TRACK = 1;
/** Unless the file says otherwise, its times are counted in milliseconds. */
const DEFAULT_TIMESTAMP_SCALE = 1_000_000;
/** An index larger than this is a damaged file, not an index. */
const MAX_ELEMENT = 64 * 1024 * 1024;
/** An element's id is at most four bytes long and its length at most eight. */
const MAX_HEADER = 12;

const WANTED = new Set([SEEK_HEAD, INFO, TRACKS, CUES]);

interface Element {
    id: number;
    /** Where its body starts, in the bytes it was read from. */
    data: number;
    /** Where its body ends — null when the file does not say, which a live recording may not. */
    end: number | null;
}

/** How many bytes a variable-size integer takes: one more than the zeros its first byte starts with. */
const vintLength = (first: number): number => {
    for (let n = 1; n <= 8; n++) {
        if (first & (0x100 >> n)) return n;
    }
    return 0;
};

/** The element whose header starts at `at` in `bytes`, or null when the header does not fit. */
const elementAt = (bytes: Uint8Array, at: number): Element | null => {
    if (at >= bytes.length) return null;
    const idLength = vintLength(bytes[at]);
    if (!idLength || idLength > 4 || at + idLength >= bytes.length) return null;
    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + bytes[at + i];

    const s = at + idLength;
    const sizeLength = vintLength(bytes[s]);
    if (!sizeLength || s + sizeLength > bytes.length) return null;
    const firstBits = 0xff >> sizeLength;
    let size = bytes[s] & firstBits;
    let unknown = size === firstBits;
    for (let i = 1; i < sizeLength; i++) {
        size = size * 256 + bytes[s + i];
        unknown = unknown && bytes[s + i] === 0xff;
    }
    const data = s + sizeLength;
    return { id, data, end: unknown ? null : data + size };
};

/** The elements in `bytes[from, to)`, in order; stops at the first that does not fit. */
const childrenOf = (bytes: Uint8Array, from: number, to: number): Element[] => {
    const found: Element[] = [];
    for (let at = from; at < to;) {
        const element = elementAt(bytes, at);
        if (!element || element.end === null || element.end > to) break;
        found.push(element);
        at = element.end;
    }
    return found;
};

const fieldsOf = (bytes: Uint8Array, parent: Element): Element[] => childrenOf(bytes, parent.data, parent.end ?? parent.data);

/** An unsigned integer, big-endian, as long as its element. A seek entry's id is read this way too. */
const uintOf = (bytes: Uint8Array, element: Element): number => {
    let value = 0;
    for (let i = element.data; i < (element.end ?? element.data); i++) value = value * 256 + bytes[i];
    return value;
};

/** What a seek head says: an element's id, and where it is in the file. */
const readSeekHead = (body: Uint8Array, origin: number, into: Map<number, number>): void => {
    for (const entry of childrenOf(body, 0, body.length)) {
        if (entry.id !== SEEK) continue;
        let id: number | undefined;
        let position: number | undefined;
        for (const field of fieldsOf(body, entry)) {
            if (field.id === SEEK_ID) id = uintOf(body, field);
            else if (field.id === SEEK_POSITION) position = uintOf(body, field);
        }
        if (id !== undefined && position !== undefined && !into.has(id)) into.set(id, origin + position);
    }
};

const timestampScaleOf = (info: Uint8Array): number => {
    const field = childrenOf(info, 0, info.length).find(element => element.id === TIMESTAMP_SCALE);
    return (field && uintOf(info, field)) || DEFAULT_TIMESTAMP_SCALE;
};

/** The first video track: its number, and how long each of its images lasts, in nanoseconds. */
const videoTrackOf = (tracks: Uint8Array): { number: number; defaultDuration: number } | null => {
    for (const entry of childrenOf(tracks, 0, tracks.length)) {
        if (entry.id !== TRACK_ENTRY) continue;
        let number = 0;
        let type = 0;
        let defaultDuration = 0;
        for (const field of fieldsOf(tracks, entry)) {
            if (field.id === TRACK_NUMBER) number = uintOf(tracks, field);
            else if (field.id === TRACK_TYPE) type = uintOf(tracks, field);
            else if (field.id === DEFAULT_DURATION) defaultDuration = uintOf(tracks, field);
        }
        if (type === VIDEO_TRACK && number) return { number, defaultDuration };
    }
    return null;
};

/** The times of the cue points on `track`, in the file's own units. */
const cueTimesOf = (cues: Uint8Array, track: number): number[] => {
    const times: number[] = [];
    for (const point of childrenOf(cues, 0, cues.length)) {
        if (point.id !== CUE_POINT) continue;
        let time: number | undefined;
        let onTrack = false;
        for (const field of fieldsOf(cues, point)) {
            if (field.id === CUE_TIME) {
                time = uintOf(cues, field);
            } else if (field.id === CUE_TRACK_POSITIONS) {
                onTrack = onTrack || fieldsOf(cues, field)
                    .some(position => position.id === CUE_TRACK && uintOf(cues, position) === track);
            }
        }
        if (time !== undefined && onTrack) times.push(time);
    }
    return times;
};

/**
 * The timeline of the first video track of a Matroska or WebM file — null when it has none. The
 * key images are left out when the file has no cues (a browser's own recordings have none), and
 * the image duration when its track does not state one.
 */
export const readMatroskaTimeline = async (source: ByteSource, head: Uint8Array): Promise<FrameTimeline | null> => {
    const ebml = elementAt(head, 0);
    if (!ebml || ebml.id !== EBML || ebml.end === null) return null;
    const segment = elementAt(head, ebml.end);
    if (!segment || segment.id !== SEGMENT) return null;
    // What a seek head counts its positions from.
    const origin = segment.data;

    const bodies = new Map<number, Uint8Array>();
    const positions = new Map<number, number>();
    const keep = (id: number, body: Uint8Array) => {
        if (bodies.has(id)) return;
        bodies.set(id, body);
        if (id === SEEK_HEAD) readSeekHead(body, origin, positions);
    };

    // What a muxer writes ahead of the first cluster: the seek head, the file's info, its tracks —
    // and, from some, the cues.
    for (let at = origin; at < head.length;) {
        const element = elementAt(head, at);
        if (!element || element.end === null || element.id === CLUSTER) break;
        const length = element.end - element.data;
        if (WANTED.has(element.id) && length <= MAX_ELEMENT) {
            keep(element.id, element.end <= head.length
                ? head.subarray(element.data, element.end)
                : await source.read(element.data, length));
        }
        at = element.end;
    }

    // The rest, from where the seek head says it is.
    for (const id of [INFO, TRACKS, CUES]) {
        const at = positions.get(id);
        if (bodies.has(id) || at === undefined || at >= source.size) continue;
        const header = elementAt(await source.read(at, MAX_HEADER), 0);
        if (!header || header.id !== id || header.end === null) continue;
        const length = header.end - header.data;
        if (length > MAX_ELEMENT) continue;
        keep(id, await source.read(at + header.data, length));
    }

    const tracks = bodies.get(TRACKS);
    const video = tracks && videoTrackOf(tracks);
    if (!video) return null;
    const info = bodies.get(INFO);
    const scale = info ? timestampScaleOf(info) : DEFAULT_TIMESTAMP_SCALE;
    const cues = bodies.get(CUES);
    const keys = cues ? cueTimesOf(cues, video.number).map(time => (time * scale) / 1e9) : [];
    return {
        frameDuration: video.defaultDuration > 0 ? video.defaultDuration / 1e9 : undefined,
        keys: keys.length > 0 ? [...new Set(keys)].sort((a, b) => a - b) : undefined,
    };
};
