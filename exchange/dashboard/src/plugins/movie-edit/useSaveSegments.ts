import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { WorkerError, type MediaJob, type MediaSegment, type ToolboxJob } from 'kiao-worker';
import { extractName, useWorkerClient, useRefreshFileList } from '@kiao-dashboard-core';
import type { MovieEditValue } from './MovieEdit-ctx';
import { planSave } from './saving';

/** The configuration panel's row a save runs on: the toolbox component that is ffmpeg. */
export const FFMPEG_COMPONENT = 'ffmpeg';

/** How often a save, or the install before one, is asked after. */
const POLL_MS = 1000;

/** What worker answers a save with when this machine has no ffmpeg able to do it. */
const NEEDS_FFMPEG = 424;

interface SegmentExport {
    path: string;
    segments: MediaSegment[];
}

export type SavePhase =
    | { kind: 'idle' }

    | { kind: 'starting' }

    | { kind: 'confirming'; target: SegmentExport; replaced: string[] }

    | { kind: 'needs-ffmpeg'; target: SegmentExport; why: string; canInstall: boolean; note?: string }
    | { kind: 'installing'; target: SegmentExport; job: ToolboxJob }
    | { kind: 'saving'; job: MediaJob }
    | { kind: 'failed'; message: string };

export interface SegmentsSave {
    phase: SavePhase;

    ready: boolean;
    stopping: boolean;
    save: () => void;
    confirm: () => void;

    install: () => void;
    stop: () => void;
    dismiss: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** The Save button's whole conversation with worker: plan the files, ask before replacing any of them. */
export const useSaveSegments = (movie: Pick<MovieEditValue, 'path' | 'segments' | 'spanOf' | 'loading' | 'invalid' | 'audio' | 'timelineStatus'>): SegmentsSave => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [phase, setPhase] = useState<SavePhase>({ kind: 'idle' });
    const currentPhase = useRef(phase);
    const [stopping, setStopping] = useState(false);
    const stopRequested = useRef<string | null>(null);

    // A panel closed while something runs must not set state; what runs carries on in the service.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const settle = useCallback((next: SavePhase) => {
        if (!mounted.current) return;
        currentPhase.current = next;
        setPhase(next);
        if (next.kind !== 'saving') {
            stopRequested.current = null;
            setStopping(false);
        }
    }, []);

    const { path, segments, spanOf, loading, invalid, audio, timelineStatus } = movie;
    const sourceName = extractName(path);
    const plan = useCallback(() => planSave(segments, spanOf, sourceName), [segments, spanOf, sourceName]);


    const offerFFmpeg = useCallback(async (target: SegmentExport, why: string) => {
        try {
            const toolbox = await client.getToolbox();
            const row = toolbox.components.find(component => component.id === FFMPEG_COMPONENT);
            if (!toolbox.enabled) {
                settle({
                    kind: 'needs-ffmpeg', target, why, canInstall: false,
                    note: 'This deployment installs nothing, because KIAO_WORKER_TOOLBOX_PATH is not set: '
                        + 'install FFmpeg on the machine, or set it and restart the service.',
                });
            } else if (!row || row.state === 'blocked' || row.state === 'unavailable') {
                settle({ kind: 'needs-ffmpeg', target, why, canInstall: false, note: row?.reason || 'FFmpeg cannot be installed here.' });
            } else {
                settle({ kind: 'needs-ffmpeg', target, why, canInstall: true });
            }
        } catch (error) {
            settle({ kind: 'needs-ffmpeg', target, why, canInstall: false, note: `The configuration could not be read: ${messageOf(error)}` });
        }
    }, [client, settle]);

    /** Asks the service for the save — and answers a machine without ffmpeg by offering one. */
    const start = useCallback(async (target: SegmentExport) => {
        settle({ kind: 'starting' });
        try {
            settle({ kind: 'saving', job: await client.saveMediaSegments(target.path, target.segments) });
        } catch (error) {
            if (error instanceof WorkerError && error.response.status === NEEDS_FFMPEG) {
                await offerFFmpeg(target, error.message);
            } else {
                settle({ kind: 'failed', message: messageOf(error) });
            }
        }
    }, [client, settle, offerFFmpeg]);

    const save = useCallback(async () => {
        if (currentPhase.current.kind !== 'idle' && currentPhase.current.kind !== 'failed') return;
        const planned = plan();
        if (planned.problem) {
            settle({ kind: 'failed', message: planned.problem });
            return;
        }
        const target = { path, segments: planned.segments };
        settle({ kind: 'starting' });
        let replaced: string[];
        try {
            const there = new Set((await client.listFiles(folderOf(path)))
                .filter(entry => !entry.isDirectory)
                .map(entry => extractName(entry.path).toLowerCase()));
            replaced = planned.files.filter(file => there.has(file.toLowerCase()));
        } catch (error) {
            settle({ kind: 'failed', message: `The folder could not be read: ${messageOf(error)}` });
            return;
        }
        if (replaced.length > 0) settle({ kind: 'confirming', target, replaced });
        else await start(target);
    }, [plan, client, path, settle, start]);

    const install = useCallback(async () => {
        const waiting = currentPhase.current;
        if (waiting.kind !== 'needs-ffmpeg' || !waiting.canInstall) return;
        settle({ kind: 'starting' });
        try {
            settle({ kind: 'installing', target: waiting.target, job: await client.installToolboxComponents([FFMPEG_COMPONENT]) });
        } catch (error) {
            settle({ kind: 'failed', message: messageOf(error) });
        }
    }, [client, settle]);


    const ended = useCallback((job: MediaJob) => {
        const name = extractName(job.path);
        if (job.done > 0) refreshFileList();
        if (job.state === 'done') {
            message.success(job.files.length === 1
                ? `Saved ${extractName(job.files[0])} beside ${name}`
                : `Saved ${job.files.length} segments beside ${name}`);
            settle({ kind: 'idle' });
        } else if (job.state === 'stopped') {
            message.info(`Stopped: ${job.done} of ${job.files.length} saved`);
            settle({ kind: 'idle' });
        } else {
            settle({ kind: 'failed', message: job.error || 'The save failed.' });
        }
    }, [refreshFileList, settle]);

    const runningKind = phase.kind === 'saving' || phase.kind === 'installing' ? phase.kind : null;
    const runningId = phase.kind === 'saving' || phase.kind === 'installing' ? phase.job.id : null;
    const installingFor = phase.kind === 'installing' ? phase.target : null;
    useEffect(() => {
        if (!runningKind || !runningId) return;
        let cancelled = false;
        let asking = false;
        const timer = window.setInterval(async () => {
            if (asking) return;
            asking = true;
            try {
                if (installingFor) {
                    const job = await client.getToolboxJob(runningId);
                    if (cancelled) return;
                    if (job.state === 'running') settle({ kind: 'installing', target: installingFor, job });
                    else if (job.state === 'done') await start(installingFor);
                    else settle({ kind: 'failed', message: `FFmpeg could not be installed${job.error ? `: ${job.error}` : '.'}` });
                } else {
                    const job = await client.getMediaJob(runningId);
                    if (cancelled) return;
                    if (job.state === 'running') settle({ kind: 'saving', job });
                    else ended(job);
                }
            } catch (error) {
                if (!cancelled) settle({ kind: 'failed', message: messageOf(error) });
            } finally {
                asking = false;
            }
        }, POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [runningKind, runningId, installingFor, client, settle, start, ended]);

    const stop = useCallback(async () => {
        const active = currentPhase.current;
        if (active.kind !== 'saving' || stopRequested.current) return;
        const id = active.job.id;
        stopRequested.current = id;
        setStopping(true);
        try {
            await client.stopMediaJob(id);
        } catch (error) {
            message.error(messageOf(error));
            if (mounted.current && stopRequested.current === id) {
                stopRequested.current = null;
                setStopping(false);
            }
        }
    }, [client]);

    const dismiss = () => {
        const kind = currentPhase.current.kind;
        if (kind === 'confirming' || kind === 'needs-ffmpeg' || kind === 'failed') settle({ kind: 'idle' });
    };

    const ready = !loading && !invalid && segments.length > 0 && (audio || timelineStatus !== 'loading')
        && (phase.kind === 'idle' || phase.kind === 'failed');

    return {
        phase,
        ready,
        stopping,
        save: () => void save(),
        confirm: () => {
            const waiting = currentPhase.current;
            if (waiting.kind === 'confirming') void start(waiting.target);
        },
        install: () => void install(),
        stop: () => void stop(),
        dismiss,
    };
};
