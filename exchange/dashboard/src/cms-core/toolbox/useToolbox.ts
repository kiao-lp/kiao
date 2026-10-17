import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { Toolbox, ToolboxJob } from 'kiao-worker';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { TOOLBOX_CHANGED_EVENT } from './events';

/** How often the panel asks after a running install. */
const POLL_MS = 1200;

export interface ToolboxController {
    toolbox: Toolbox | null;
    loading: boolean;
    /** The install in flight, or the last one to have finished. */
    job: ToolboxJob | null;
    busy: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    install: (ids: string[]) => Promise<void>;
    uninstall: (ids: string[]) => Promise<void>;
    setRegistered: (id: string, enabled: boolean) => Promise<void>;
}

/**
 * The configuration panel's whole conversation with worker.
 *
 * An install takes minutes, so the service answers a job and the panel polls it — the idiom the Git
 * monitor and the Claude sign-in probe already use, and the only one available: DCMS has no
 * streaming transport but the Claude socket, which is a turn's channel and not a place to put a
 * package manager. Polling stops the moment the job ends, and one last full read picks up the rows
 * that changed.
 *
 * The job outlives the panel, because it lives in the service. Closing the tab mid-install and
 * opening it again finds the same job still running, with its log where it left off.
 */
export const useToolbox = (): ToolboxController => {
    const workerClient = useWorkerClient();
    const [toolbox, setToolbox] = useState<Toolbox | null>(null);
    const [job, setJob] = useState<ToolboxJob | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // A panel unmounted mid-poll must not set state, and must not keep a timer alive.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        try {
            const next = await workerClient.getToolbox();
            if (!mounted.current) return;
            setToolbox(next);
            setJob(next.job ?? null);
            setError(null);
        } catch (e: any) {
            if (!mounted.current) return;
            setError(e?.message ?? String(e));
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, [workerClient]);

    useEffect(() => { void refresh(); }, [refresh]);

    // While a job runs, ask after it; when it ends, read the whole panel once more so the rows
    // catch up with what the job did.
    const running = job?.state === 'running';
    useEffect(() => {
        if (!running || !job) return;
        const id = window.setInterval(async () => {
            try {
                const next = await workerClient.getToolboxJob(job.id);
                if (!mounted.current) return;
                setJob(next);
                if (next.state !== 'running') {
                    window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
                    void refresh();
                }
            } catch {
                // A job the service no longer keeps, or a request that failed while the panel was
                // open: the next full read settles it, and an error banner over a finished install
                // would say nothing useful.
                if (mounted.current) void refresh();
            }
        }, POLL_MS);
        return () => window.clearInterval(id);
    }, [running, job, workerClient, refresh]);

    const start = useCallback(async (
        run: () => Promise<ToolboxJob>,
    ) => {
        try {
            const started = await run();
            if (!mounted.current) return;
            setJob(started);
        } catch (e: any) {
            message.error(e?.message ?? String(e));
        }
    }, []);

    const install = useCallback((ids: string[]) =>
        start(() => workerClient.installToolboxComponents(ids)), [start, workerClient]);

    const uninstall = useCallback((ids: string[]) =>
        start(() => workerClient.uninstallToolboxComponents(ids)), [start, workerClient]);

    const setRegistered = useCallback(async (id: string, enabled: boolean) => {
        try {
            const next = await workerClient.setToolboxRegistration([id], enabled);
            window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
            if (!mounted.current) return;
            setToolbox(next);
        } catch (e: any) {
            message.error(e?.message ?? String(e));
        }
    }, [workerClient]);

    return { toolbox, loading, job, busy: running, error, refresh, install, uninstall, setRegistered };
};
