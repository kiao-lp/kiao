/** Where the images of a video are, as far as its file says — and the moves between them. */
export interface FrameTimeline {
    frames?: number[];
    frameDuration?: number;
    keys?: number[];
}

/** How far a time may sit from the start of the image it names. */
export const TIME_TOLERANCE = 0.001;

/** The index of the last of `sorted` at or before `t`, or -1. */
const lastAtOrBefore = (sorted: number[], t: number): number => {
    let low = 0;
    let high = sorted.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (sorted[middle] <= t) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
};

const listed = (timeline: FrameTimeline): number[] | null =>
    timeline.frames && timeline.frames.length > 0 ? timeline.frames : null;

const spacing = (timeline: FrameTimeline): number =>
    timeline.frameDuration && timeline.frameDuration > 0 ? timeline.frameDuration : 0;

/** The image on screen at `t`: the last one to start at or before it. */
export const frameAt = (timeline: FrameTimeline, t: number): number => {
    const frames = listed(timeline);
    if (frames) return Math.max(0, lastAtOrBefore(frames, t + TIME_TOLERANCE));
    const duration = spacing(timeline);
    return duration ? Math.max(0, Math.floor((t + TIME_TOLERANCE) / duration)) : 0;
};

/** When image `i` starts. */
export const frameStart = (timeline: FrameTimeline, i: number): number => {
    const frames = listed(timeline);
    if (frames) return frames[Math.min(Math.max(i, 0), frames.length - 1)];
    return Math.max(i, 0) * spacing(timeline);
};

/** Where to seek to show image `i`: its middle. */
export const frameSeekTime = (timeline: FrameTimeline, i: number): number => {
    const frames = listed(timeline);
    const start = frameStart(timeline, i);
    const next = frames && i + 1 < frames.length ? frames[i + 1] : start + spacing(timeline);
    return (start + next) / 2;
};

/** When image `i` ends: where the next one starts. */
export const frameEnd = (timeline: FrameTimeline, i: number, duration: number): number => {
    const frames = listed(timeline);
    if (frames && i + 1 < frames.length) return frames[i + 1];
    const start = frameStart(timeline, i);
    const next = start + spacing(timeline);
    if (!(duration > start)) return next;
    return frames ? duration : Math.min(next, duration);
};

/** The stretch two stored times cover: from the start of the image the first names to the end of. */
export const imageSpan = (
    timeline: FrameTimeline, startT: number, endT: number, duration: number,
): { from: number; to: number } => ({
    from: frameStart(timeline, frameAt(timeline, startT)),
    to: frameEnd(timeline, frameAt(timeline, endT), duration),
});

/** The time of the image on screen at `t` — what a position is shown as, and saved as. */
export const imageTime = (timeline: FrameTimeline, t: number): number =>
    frameStart(timeline, frameAt(timeline, t));

/** Where to seek to show the image a stored time names. */
export const seekTimeOf = (timeline: FrameTimeline, t: number): number =>
    frameSeekTime(timeline, frameAt(timeline, t));

/** The last image there is — the file's list says so, or the duration where they are evenly spaced. -1. */
export const lastFrame = (timeline: FrameTimeline, duration: number): number => {
    const frames = listed(timeline);
    if (frames) return frames.length - 1;
    const each = spacing(timeline);
    if (!each || !(duration > 0)) return -1;
    return Math.max(0, Math.ceil((duration - TIME_TOLERANCE) / each) - 1);
};

/** Where the image one step forward or back from `t` is shown — or null at either end. */
export const stepFrame = (timeline: FrameTimeline, t: number, direction: 1 | -1, duration: number): number | null => {
    const target = frameAt(timeline, t) + direction;
    if (target < 0 || target > lastFrame(timeline, duration)) return null;
    return frameSeekTime(timeline, target);
};

/** Where the next or the previous key image from `t` is shown — or null when the file lists none. */
export const stepKey = (timeline: FrameTimeline, t: number, direction: 1 | -1, duration: number): number | null => {
    const keys = timeline.keys;
    if (!keys || keys.length === 0) return null;
    const here = imageTime(timeline, t);
    const index = direction > 0
        ? lastAtOrBefore(keys, here + TIME_TOLERANCE) + 1
        : lastAtOrBefore(keys, here - TIME_TOLERANCE);
    if (index < 0 || index >= keys.length) return null;
    const target = frameAt(timeline, keys[index]);
    if (target > lastFrame(timeline, duration)) return null;
    return frameSeekTime(timeline, target);
};

/** The timeline a list of presentation times makes: both lists put in order, and the usual gap between. */
export const timelineOfTimes = (frames: number[], keys: number[]): FrameTimeline => {
    const sortedFrames = Float64Array.from(frames).sort();
    const gaps: number[] = [];
    for (let i = 1; i < sortedFrames.length; i++) {
        const gap = sortedFrames[i] - sortedFrames[i - 1];
        if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    return {
        frames: Array.from(sortedFrames),
        frameDuration: gaps.length > 0 ? gaps[gaps.length >> 1] : undefined,
        keys: Array.from(Float64Array.from(keys).sort()),
    };
};
