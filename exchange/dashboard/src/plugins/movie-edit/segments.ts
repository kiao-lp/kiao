import type { DocumentCodec } from '@kiao-dashboard-core';

/** A named span of a video or a recording. */
export interface Segment {

    id: string;
    name: string;
    startMs: number;
    endMs: number;
}

/** The `<file>. config. */
export interface MediaConfig {
    segments?: Segment[];
    [key: string]: unknown;
}

export const mediaConfigPath = (mediaPath: string): string => `${mediaPath}.config.json`;

/** Segments are kept, and written, in the order they come in the file they cut. */
const chronological = (a: Segment, b: Segment): number =>
    a.startMs - b.startMs || a.endMs - b.endMs || a.name.localeCompare(b.name);

const isTime = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The segments as the file holds them — or a throw when it holds something else. */
const readSegments = (raw: unknown): Segment[] => {
    if (!Array.isArray(raw)) throw new Error('`segments` is not a list');
    const taken = new Set<string>();
    return raw.map((entry: unknown, index): Segment => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`segment ${index + 1} is not an object`);
        }
        const fields = entry as Record<string, unknown>;
        const { id, name, startMs, endMs } = fields;
        if (!isTime(startMs) || !isTime(endMs)) {
            throw new Error(`segment ${index + 1} has no startMs and endMs`);
        }
        const wanted = typeof id === 'string' && id ? id : `segment-${index + 1}`;
        let unique = wanted;
        for (let n = 2; taken.has(unique); n++) unique = `${wanted}-${n}`;
        taken.add(unique);
        return {
            ...fields,
            id: unique,
            name: typeof name === 'string' ? name : '',
            startMs: Math.round(Math.min(startMs, endMs)),
            endMs: Math.round(Math.max(startMs, endMs)),
        };
    }).sort(chronological);
};

/** The sidecar's two arrows, for `useDocumentFileSync`. */
export const mediaConfigCodec: DocumentCodec<MediaConfig> = {
    parse: (text) => {
        if (!text.trim()) return {};
        const raw: unknown = JSON.parse(text);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
        const config = raw as MediaConfig;
        return config.segments === undefined ? config : { ...config, segments: readSegments(config.segments) };
    },
    serialize: (config) => JSON.stringify(config, null, 2),
};

export const segmentsOf = (config: MediaConfig | null): Segment[] => config?.segments ?? [];

const withSegments = (config: MediaConfig, segments: Segment[]): MediaConfig =>
    ({ ...config, segments: [...segments].sort(chronological) });

const updateSegment = (config: MediaConfig, id: string, change: (segment: Segment) => Segment): MediaConfig =>
    withSegments(config, segmentsOf(config).map(segment => (segment.id === id ? change(segment) : segment)));

/** `Segment 1`, `Segment 2`, …: the first number no segment is already called by. */
export const nextSegmentName = (segments: Segment[]): string => {
    const names = new Set(segments.map(segment => segment.name));
    let n = segments.length + 1;
    while (names.has(`Segment ${n}`)) n++;
    return `Segment ${n}`;
};

/** A new segment, both of its ends at `atMs`: where it starts is where the reader stands, and where it. */
export const addSegment = (config: MediaConfig, id: string, atMs: number): MediaConfig => {
    const segments = segmentsOf(config);
    return withSegments(config, [...segments, { id, name: nextSegmentName(segments), startMs: atMs, endMs: atMs }]);
};

/** The start moves to `ms`, and pushes the end along when it would pass it: a segment never ends. */
export const setSegmentStart = (config: MediaConfig, id: string, ms: number): MediaConfig =>
    updateSegment(config, id, segment => ({ ...segment, startMs: ms, endMs: Math.max(segment.endMs, ms) }));

/** The end moves to `ms`, and pushes the start back when it would pass it. */
export const setSegmentEnd = (config: MediaConfig, id: string, ms: number): MediaConfig =>
    updateSegment(config, id, segment => ({ ...segment, endMs: ms, startMs: Math.min(segment.startMs, ms) }));

export const renameSegment = (config: MediaConfig, id: string, name: string): MediaConfig =>
    updateSegment(config, id, segment => ({ ...segment, name }));

export const removeSegment = (config: MediaConfig, id: string): MediaConfig =>
    withSegments(config, segmentsOf(config).filter(segment => segment.id !== id));

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `1:02.345`, or `1:02:03.456` past the hour: a time precise to the image. */
export const formatTime = (ms: number): string => {
    const total = Math.max(0, Math.round(ms));
    const tail = `${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
    const minutes = Math.floor(total / 60_000) % 60;
    const hours = Math.floor(total / 3_600_000);
    return hours > 0 ? `${hours}:${pad(minutes)}:${tail}` : `${minutes}:${tail}`;
};
