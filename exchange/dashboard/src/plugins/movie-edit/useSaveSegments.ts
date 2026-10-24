import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { WorkerError, type MediaJob, type ToolboxJob } from 'kiao-worker';
import { extractName, useWorkerClient, useRefreshFileList } from '@cms-core';
import type { MovieEditValue } from './MovieEdit-ctx';
import { planSave } from './saving';

/** The configuration panel's row a save runs on: the toolbox component that is ffmpeg. */
export const FFMPEG_COMPONENT = 'ffmpeg';

/** How often a save, or the install before one, is asked after. */
const POLL_MS = 1000;

/** What worker answers a save with when this machine has no ffmpeg able to do it. */
const NEEDS_FFMPEG = 424;

export type SavePhase =
    | { kind: 'idle' }
    /** A request is on its way, and nothing is to be pressed until it is answered. */
    | { kind: 'starting' }
    /** The files already in the folder that the save would replace, waiting for a yes. */
    | { kind: 'confirming'; replaced: string[] }
    /** No ffmpeg able to save: the service's sentence, and whether this deployment can install one. */
    | { kind: 'needs-ffmpeg'; why: string; canInstall: boolean; note?: string }
    | { kind: 'installing'; job: ToolboxJob }
    | { kind: 'saving'; job: MediaJob }
    | { kind: 'failed'; message: string };

export interface SegmentsSave {
    phase: SavePhase;
    /** Whether Save can be pressed: segments to save, their times known, and nothing under way. */
    ready: boolean;
    save: () => void;
    /** Yes to replacing the files already there. */
    confirm: () => void;
    /** Yes to installing ffmpeg — after which the save starts by itself. */
    install: () => void;
    stop: () => void;
    dismiss: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/**
 * The Save button's whole conversation with worker: plan the files, ask before replacing any
 * of them, start the save and follow it — and, when the machine has no ffmpeg able to do it, offer to
 * install the configuration panel's before trying again.
 *
 * The save is a job in the service, polled as the configuration panel polls an install: encoding
 * AV1 takes minutes, and a request held open that long is what nginx would cut. It outlives the
 * panel — closing the video leaves it running, and its files still arrive.
 */
export const useSaveSegments = (movie: MovieEditValue): SegmentsSave => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [phase, setPhase] = useState<SavePhase>({ kind: 'idle' });

    // A panel closed while something runs must not set state; what runs carries on in the service.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const settle = useCallback((next: SavePhase) => {
        if (mounted.current) setPhase(next);
    }, []);

    const { path, segments, spanOf, loading, invalid, audio, timelineStatus } = movie;
    const sourceName = extractName(path);
    const plan = useCallback(() => planSave(segments, spanOf, sourceName), [segments, spanOf, sourceName]);

    /** Reads the configuration panel's ffmpeg row, to say what can be done about it from here. */
    const offerFFmpeg = useCallback(async (why: string) => {
        try {
            const toolbox = await client.getToolbox();
            const row = toolbox.components.find(component => component.id === FFMPEG_COMPONENT);
            if (!toolbox.enabled) {
                settle({
                    kind: 'needs-ffmpeg', why, canInstall: false,
                    note: 'This deployment installs nothing, because KIAO_WORKER_TOOLBOX_PATH is not set: '
                        + 'install FFmpeg on the machine, or set it and restart the service.',
                });
            } else if (!row || row.state === 'blocked' || row.state === 'unavailable') {
                settle({ kind: 'needs-ffmpeg', why, canInstall: false, note: row?.reason || 'FFmpeg cannot be installed here.' });
            } else {
                settle({ kind: 'needs-ffmpeg', why, canInstall: true });
            }
        } catch (error) {
            settle({ kind: 'needs-ffmpeg', why, canInstall: false, note: `The configuration could not be read: ${messageOf(error)}` });
        }
    }, [client, settle]);

    /** Asks the service for the save — and answers a machine without ffmpeg by offering one. */
    const start = useCallback(async () => {
        const planned = plan();
        if (planned.problem) {
            settle({ kind: 'failed', message: planned.problem });
            return;
        }
        settle({ kind: 'starting' });
        try {
            settle({ kind: 'saving', job: await client.saveMediaSegments(path, planned.segments) });
        } catch (error) {
            if (error instanceof WorkerError && error.response.status === NEEDS_FFMPEG) {
                await offerFFmpeg(error.message);
            } else {
                settle({ kind: 'failed', message: messageOf(error) });
            }
        }
    }, [plan, client, path, settle, offerFFmpeg]);

    const save = useCallback(async () => {
        const planned = plan();
        if (planned.problem) {
            settle({ kind: 'failed', message: planned.problem });
            return;
        }
        settle({ kind: 'starting' });
        // Said before it happens: a name the folder already has may be an earlier save of the same
        // segment, and it may be something else altogether.
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
        if (replaced.length > 0) settle({ kind: 'confirming', replaced });
        else await start();
    }, [plan, client, path, settle, start]);

    const install = useCallback(async () => {
        settle({ kind: 'starting' });
        try {
            settle({ kind: 'installing', job: await client.installToolboxComponents([FFMPEG_COMPONENT]) });
        } catch (error) {
            settle({ kind: 'failed', message: messageOf(error) });
        }
    }, [client, settle]);

    /** How a save ended, said once, with the tree brought up to date with what it wrote. */
    const ended = useCallback((job: MediaJob) => {
        if (job.done > 0) refreshFileList();
        if (job.state === 'done') {
            message.success(job.files.length === 1
                ? `Saved ${extractName(job.files[0])} beside ${sourceName}`
                : `Saved ${job.files.length} segments beside ${sourceName}`);
            settle({ kind: 'idle' });
        } else if (job.state === 'stopped') {
            message.info(`Stopped: ${job.done} of ${job.files.length} saved`);
            settle({ kind: 'idle' });
        } else {
            settle({ kind: 'failed', message: job.error || 'The save failed.' });
        }
    }, [refreshFileList, sourceName, settle]);

    // While something runs, it is asked after; an install that ends well is followed by the save it
    // was for.
    const runningKind = phase.kind === 'saving' || phase.kind === 'installing' ? phase.kind : null;
    const runningId = phase.kind === 'saving' || phase.kind === 'installing' ? phase.job.id : null;
    useEffect(() => {
        if (!runningKind || !runningId) return;
        let cancelled = false;
        let asking = false;
        const timer = window.setInterval(async () => {
            if (asking) return;
            asking = true;
            try {
                if (runningKind === 'installing') {
                    const job = await client.getToolboxJob(runningId);
                    if (cancelled) return;
                    if (job.state === 'running') settle({ kind: 'installing', job });
                    else if (job.state === 'done') await start();
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
    }, [runningKind, runningId, client, settle, start, ended]);

    const stop = useCallback(async () => {
        if (phase.kind !== 'saving') return;
        try {
            await client.stopMediaJob(phase.job.id);
        } catch (error) {
            message.error(messageOf(error));
        }
    }, [client, phase]);

    const dismiss = useCallback(() => settle({ kind: 'idle' }), [settle]);

    const ready = !loading && !invalid && segments.length > 0 && (audio || timelineStatus !== 'loading')
        && (phase.kind === 'idle' || phase.kind === 'failed');

    return {
        phase,
        ready,
        save: () => void save(),
        confirm: () => void start(),
        install: () => void install(),
        stop: () => void stop(),
        dismiss,
    };
};
