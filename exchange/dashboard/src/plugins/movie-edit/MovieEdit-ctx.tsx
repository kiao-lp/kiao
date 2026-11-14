import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthenticatedFileUrl, useDocumentFileSync, useFileViewState } from '@kiao-dashboard-core';
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

    path: string;
    sidecarPath: string;

    url: string;

    audio: boolean;

    attach: (element: HTMLMediaElement | null) => void;

    paused: boolean;

    time: number;
    duration: number;
    togglePlay: () => void;


    timelineStatus: 'loading' | 'ready' | 'unknown';

    hasKeys: boolean;
    can: { previousImage: boolean; nextImage: boolean; previousKey: boolean; nextKey: boolean };
    stepImage: (direction: 1 | -1) => void;
    stepKeyImage: (direction: 1 | -1) => void;

    segments: Segment[];
    loading: boolean;

    invalid: boolean;

    selected: Segment | null;
    select: (id: string | null) => void;
    add: () => void;
    remove: (id: string) => void;
    rename: (id: string, name: string) => void;

    setStart: () => void;
    setEnd: () => void;
    goToStart: (id: string) => void;
    goToEnd: (id: string) => void;

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

/** The open video — or recording — and its segments, for the three things that read them: the player. */
export const MovieEditProvider: React.FC<{ path: string; audio: boolean; children: React.ReactNode }> = ({
    path, audio, children,
}) => {
    const url = useAuthenticatedFileUrl(path);
    const [media, setMedia] = useState<HTMLMediaElement | null>(null);
    const [paused, setPaused] = useState(true);
    const [playhead, setPlayhead] = useState(0);
    const [duration, setDuration] = useState(0);

    const [measured, setMeasured] = useState<number | null>(null);

    const presented = useRef<number | null>(null);

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

    useEffect(() => {
        if (!(media instanceof HTMLVideoElement) || typeof media.requestVideoFrameCallback !== 'function') return;
        let stopped = false;
        let handle = 0;
        let last: { time: number; count: number } | null = null;
        const onFrame = (_now: number, frame: VideoFrameCallbackMetadata) => {
            if (stopped) return;
            presented.current = frame.mediaTime;
            if (media.paused) {
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


    const position = useCallback((): number => presented.current ?? mediaRef.current?.currentTime ?? 0, []);


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

    const configRef = useRef(config);
    configRef.current = config;
    const { onDocChange } = sidecar;
    const change = useCallback((edit: (current: MediaConfig) => MediaConfig): boolean => {
        const current = configRef.current;
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
