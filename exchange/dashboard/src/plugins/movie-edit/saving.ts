import type { MediaSegment } from 'kiao-worker';
import { toStoreName } from 'kiao-worker/utils';
import type { Segment } from './segments';

/** What every segment is saved as: AV1 and Opus, in Matroska. */
export const SEGMENT_EXTENSION = '.mkv';

/** The name of the file a segment is saved as, without its extension: the segment's own name, as. */
export const segmentFileName = (name: string): string => toStoreName(name);

export interface SavePlan {

    segments: MediaSegment[];
    files: string[];
    /** Why the save cannot be asked for, when it cannot — said as the reader would fix it. */
    problem: string | null;
}

const called = (segment: Segment): string =>
    segment.name.trim() ? `“${segment.name}”` : 'A segment with no name';

/** What saving these segments asks for — or why it cannot be asked for: a name nothing is left of, two. */
export const planSave = (
    segments: Segment[],
    spanOf: (segment: Segment) => { fromMs: number; toMs: number },
    sourceName: string,
): SavePlan => {
    const refuse = (problem: string): SavePlan => ({ segments: [], files: [], problem });
    if (segments.length === 0) return refuse('There is no segment to save.');

    const planned: MediaSegment[] = [];
    const files: string[] = [];
    const taken = new Map<string, Segment>();
    for (const segment of segments) {
        const name = segmentFileName(segment.name);
        if (!name) return refuse(`${called(segment)} leaves nothing to name a file after: rename it.`);
        const file = `${name}${SEGMENT_EXTENSION}`;
        const key = file.toLowerCase();
        if (key === sourceName.toLowerCase()) {
            return refuse(`${called(segment)} would be saved as ${file}, over the video itself: rename it.`);
        }
        const other = taken.get(key);
        if (other) {
            return refuse(`${called(other)} and ${called(segment)} would both be saved as ${file}: rename one of them.`);
        }
        taken.set(key, segment);
        const { fromMs, toMs } = spanOf(segment);
        if (!(toMs > fromMs)) return refuse(`${called(segment)} ends where it starts: set its end.`);
        planned.push({ name, fromMs, toMs });
        files.push(file);
    }
    return { segments: planned, files, problem: null };
};
