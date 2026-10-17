import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthenticatedFileUrl, useDocumentFileSync, useFileViewState } from '@cms-core';
import {
    addSegment, mediaConfigCodec, mediaConfigPath, removeSegment, renameSegment, segmentsOf,
    setSegmentEnd, setSegmentStart, type MediaConfig, type Segment,
} from './segments';
import { imageSpan, imageTime, seekTimeOf, stepFrame, stepKey, type FrameTimeline } from './timeline';
import { useFrameTimeline } from './useFrameTimeline';

/** How long an image is taken to last in a file that does not say, until one has been seen to. */
const ASSUMED_FRAME_DURATION = 1 / 30;
/** Two images presented closer together than this are one image told twice, not a frame rate. */
const MIN_MEASURED_GAP = 0.002;

type Step = (timeline: FrameTimeline, t: number, duration: number) => number | null;

export interface MovieEditValue {
    /** The file being played, and the sidecar its segments are kept in. */
    path: string;
    sidecarPath: string;
    /** The URL the player fetches the file through. */
    url: string;
    /** A recording has no images to step between; it is played and cut all the same. */
    audio: boolean;
    /** The player hands its element over through this — a callback ref. */
    attach: (element: HTMLMediaElement | null) => void;

    paused: boolean;
    /** The time of the image on screen — of the playhead, for a recording — in seconds. */
    time: number;
    duration: number;
    togglePlay: () => void;

    /** How far the file has told where its images are. */
    timelineStatus: 'loading' | 'ready' | 'unknown';
    /** Whether the file lists its key images at all. */
    hasKeys: boolean;
    can: { previousImage: boolean; nextImage: boolean; previousKey: boolean; nextKey: boolean };
    stepImage: (direction: 1 | -1) => void;
    stepKeyImage: (direction: 1 | -1) => void;

    segments: Segment[];
    /** True until the sidecar has been read. */
    loading: boolean;
    /** The sidecar holds something other than segments, and is left alone until it reads again. */
    invalid: boolean;
    /** The current segment: the one Start and End are saved into. */
    selected: Segment | null;
    select: (id: string | null) => void;
    add: () => void;
    remove: (id: string) => void;
    rename: (id: string, name: string) => void;
    /** Saves the image on screen — the playhead, for a recording — as the current segment's start. */
    setStart: () => void;
    /** Saves it as the current segment's end. */
    setEnd: () => void;
    goToStart: (id: string) => void;
    goToEnd: (id: string) => void;
    /**
     * The stretch of the file a segment covers, in milliseconds: from the start of its first image
     * to the end of its last — a recording's, from one of its times to the other. What a save cuts.
     */
    spanOf: (segment: Segment) => { fromMs: number; toMs: number };
}

const MovieEditContext = createContext<MovieEditValue | null>(null);

export const useMovieEdit = (): MovieEditValue => {
    const context = useContext(MovieEditContext);
    if (!context) throw new Error('useMovieEdit must be used within a MovieEditProvider');
    return context;
};

/** For the segments panel: it is a tool bar tab, drawn whatever document is open. */
export const useMovieEditOptional = (): MovieEditValue | null => useContext(MovieEditContext);

/**
 * The open video — or recording — and its segments, for the three things that read them: the
 * player in the document area, the transport in the banner, and the segments panel in a tool bar.
 *
 * Mounted by the main view around its layout rather than for the life of the app: all of it is
 * about the file on screen, and none of it has anything to say once another is opened.
 *
 * **Where the reader stands** is the image on screen, not `currentTime`. A seek puts `currentTime`
 * wherever it was asked to — the middle of an image, for a step — and a pause leaves it a little
 * past the image last shown. So the start of the image the browser last presented is kept, as
 * `requestVideoFrameCallback` tells it, and a position is saved and shown as the start of its
 * image: a segment's ends are images, and the times of images.
 */
export const MovieEditProvider: React.FC<{ path: string; audio: boolean; children: React.ReactNode }> = ({
    path, audio, children,
}) => {
    const url = useAuthenticatedFileUrl(path);
    const [media, setMedia] = useState<HTMLMediaElement | null>(null);
    const [paused, setPaused] = useState(true);
    const [playhead, setPlayhead] = useState(0);
    const [duration, setDuration] = useState(0);
    /** The spacing of the images seen while the video played, for a file that does not state one. */
    const [measured, setMeasured] = useState<number | null>(null);
    /** The start of the image last put on screen, while no seek has moved away from it. */
    const presented = useRef<number | null>(null);

    // Nothing seen of one file says anything about the next one opened in the same view.
    useEffect(() => {
        presented.current = null;
        setMeasured(null);
    }, [path]);

    useEffect(() => {
        if (!media) return;
        const follow = () => {
            setPaused(media.paused);
            setDuration(Number.isFinite(media.duration) ? media.duration : 0);
            setPlayhead(presented.current ?? media.currentTime);
        };
        const events = ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'ended', 'emptied'];
        events.forEach(event => media.addEventListener(event, follow));
        follow();
        return () => events.forEach(event => media.removeEventListener(event, follow));
    }, [media]);

    // Every image the browser puts on screen, with the time it starts at — which is also what a
    // file that states no frame rate is stepped through by, once a few have gone past.
    useEffect(() => {
        if (!(media instanceof HTMLVideoElement) || typeof media.requestVideoFrameCallback !== 'function') return;
        let stopped = false;
        let handle = 0;
        let last: { time: number; count: number } | null = null;
        const onFrame = (_now: number, frame: VideoFrameCallbackMetadata) => {
            if (stopped) return;
            presented.current = frame.mediaTime;
            if (media.paused) {
                // A seek has landed: what is on screen is what the banner shows.
                setPlayhead(frame.mediaTime);
            } else if (last && frame.presentedFrames === last.count + 1) {
                const gap = frame.mediaTime - last.time;
                if (gap > MIN_MEASURED_GAP) setMeasured(known => (known === null || gap < known ? gap : known));
            }
            last = { time: frame.mediaTime, count: frame.presentedFrames };
            handle = media.requestVideoFrameCallback(onFrame);
        };
        handle = media.requestVideoFrameCallback(onFrame);
        return () => {
            stopped = true;
            media.cancelVideoFrameCallback(handle);
        };
    }, [media]);

    const file = useFrameTimeline(path, url, !audio);
    const timeline = useMemo<FrameTimeline | null>(() => (audio ? null : {
        ...(file.timeline ?? {}),
        frameDuration: file.timeline?.frameDuration ?? measured ?? ASSUMED_FRAME_DURATION,
    }), [audio, file.timeline, measured]);

    const mediaRef = useRef(media);
    mediaRef.current = media;
    const timelineRef = useRef(timeline);
    timelineRef.current = timeline;

    /** Where the reader stands: the image last put on screen, or the playhead where none has been since a seek. */
    const position = useCallback((): number => presented.current ?? mediaRef.current?.currentTime ?? 0, []);

    /** The time a position is shown and saved as: the start of its image, for a video. */
    const imageOf = useCallback((t: number): number => {
        const known = timelineRef.current;
        return known ? imageTime(known, t) : t;
    }, []);

    const seek = useCallback((t: number) => {
        const element = mediaRef.current;
        if (!element) return;
        const end = Number.isFinite(element.duration) ? element.duration : t;
        presented.current = null;
        element.currentTime = Math.min(Math.max(t, 0), end);
        setPlayhead(element.currentTime);
    }, []);

    const togglePlay = useCallback(() => {
        const element = mediaRef.current;
        if (!element) return;
        if (element.paused) element.play()?.catch(error => console.debug('The player would not start', error));
        else element.pause();
    }, []);

    /** A step is taken from a still image: the player stops, and the step starts where it stopped. */
    const step = useCallback((move: Step) => {
        const element = mediaRef.current;
        const known = timelineRef.current;
        if (!element || !known) return;
        element.pause();
        const target = move(known, position(), Number.isFinite(element.duration) ? element.duration : 0);
        if (target !== null) seek(target);
    }, [position, seek]);

    const stepImage = useCallback((direction: 1 | -1) => {
        step((known, t, length) => stepFrame(known, t, direction, length));
    }, [step]);
    const stepKeyImage = useCallback((direction: 1 | -1) => {
        step((known, t, length) => stepKey(known, t, direction, length));
    }, [step]);

    const can = useMemo(() => {
        const allowed = (move: Step) => !!timeline && duration > 0 && move(timeline, playhead, duration) !== null;
        return {
            previousImage: allowed((known, t, length) => stepFrame(known, t, -1, length)),
            nextImage: allowed((known, t, length) => stepFrame(known, t, 1, length)),
            previousKey: allowed((known, t, length) => stepKey(known, t, -1, length)),
            nextKey: allowed((known, t, length) => stepKey(known, t, 1, length)),
        };
    }, [timeline, playhead, duration]);

    const sidecarPath = mediaConfigPath(path);
    const sidecar = useDocumentFileSync(sidecarPath, mediaConfigCodec);
    const config = sidecar.doc;
    const segments = useMemo(() => segmentsOf(config), [config]);
    const invalid = !sidecar.loading && config === null;

    const [chosen, setChosen] = useFileViewState('media.segments', { selected: null as string | null });
    const selected = segments.find(segment => segment.id === chosen.selected) ?? null;

    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    // Two edits in one event build on each other rather than on the last render, or the second
    // would write the first away.
    const configRef = useRef(config);
    configRef.current = config;
    const { onDocChange } = sidecar;
    const change = useCallback((edit: (current: MediaConfig) => MediaConfig): boolean => {
        const current = configRef.current;
        // A sidecar that does not read is not written over: it is somebody's, half-way through.
        if (!current) return false;
        const next = edit(current);
        configRef.current = next;
        onDocChange(next);
        return true;
    }, [onDocChange]);

    const positionMs = useCallback(() => Math.round(imageOf(position()) * 1000), [imageOf, position]);

    const select = useCallback((id: string | null) => setChosen({ selected: id }), [setChosen]);

    const add = useCallback(() => {
        const id = crypto.randomUUID();
        if (change(current => addSegment(current, id, positionMs()))) select(id);
    }, [change, positionMs, select]);

    const remove = useCallback((id: string) => {
        change(current => removeSegment(current, id));
        if (selectedRef.current?.id === id) select(null);
    }, [change, select]);

    const rename = useCallback((id: string, name: string) => {
        change(current => renameSegment(current, id, name));
    }, [change]);

    const setStart = useCallback(() => {
        const segment = selectedRef.current;
        if (segment) change(current => setSegmentStart(current, segment.id, positionMs()));
    }, [change, positionMs]);

    const setEnd = useCallback(() => {
        const segment = selectedRef.current;
        if (segment) change(current => setSegmentEnd(current, segment.id, positionMs()));
    }, [change, positionMs]);

    /** Shows the image a stored time names — by its middle, which no rounding can miss. */
    const goTo = useCallback((ms: number) => {
        const known = timelineRef.current;
        seek(known ? seekTimeOf(known, ms / 1000) : ms / 1000);
    }, [seek]);

    const goToStart = useCallback((id: string) => {
        const segment = segmentsRef.current.find(candidate => candidate.id === id);
        if (!segment) return;
        select(id);
        goTo(segment.startMs);
    }, [goTo, select]);

    const goToEnd = useCallback((id: string) => {
        const segment = segmentsRef.current.find(candidate => candidate.id === id);
        if (!segment) return;
        select(id);
        goTo(segment.endMs);
    }, [goTo, select]);

    const spanOf = useCallback((segment: Segment) => {
        const known = timelineRef.current;
        if (!known) return { fromMs: segment.startMs, toMs: segment.endMs };
        const element = mediaRef.current;
        const length = element && Number.isFinite(element.duration) ? element.duration : 0;
        const { from, to } = imageSpan(known, segment.startMs / 1000, segment.endMs / 1000, length);
        // To the microsecond, which is what the service cuts to.
        return { fromMs: Math.round(from * 1e6) / 1e3, toMs: Math.round(to * 1e6) / 1e3 };
    }, []);

    const value = useMemo<MovieEditValue>(() => ({
        path,
        sidecarPath,
        url,
        audio,
        attach: setMedia,
        paused,
        time: timeline ? imageTime(timeline, playhead) : playhead,
        duration,
        togglePlay,
        timelineStatus: audio ? 'unknown' : file.status,
        hasKeys: !!timeline?.keys?.length,
        can,
        stepImage,
        stepKeyImage,
        segments,
        loading: sidecar.loading,
        invalid,
        selected,
        select,
        add,
        remove,
        rename,
        setStart,
        setEnd,
        goToStart,
        goToEnd,
        spanOf,
    }), [
        path, sidecarPath, url, audio, paused, timeline, playhead, duration, togglePlay, file.status, can,
        stepImage, stepKeyImage, segments, sidecar.loading, invalid, selected, select, add, remove, rename,
        setStart, setEnd, goToStart, goToEnd, spanOf,
    ]);

    return <MovieEditContext.Provider value={value}>{children}</MovieEditContext.Provider>;
};
