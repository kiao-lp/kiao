import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { Toolbox, ToolboxJob } from 'kiao-worker';
import { useWorkerClient } from 'src/core/files/service/ui';
import { TOOLBOX_CHANGED_EVENT } from './events';

/** How often the panel asks after a running install. */
const POLL_MS = 1200;

export type ToolboxRequest =
    | { kind: 'install' | 'uninstall'; ids: string[] }
    | { kind: 'registration'; id: string };

export interface ToolboxController {
    toolbox: Toolbox | null;
    loading: boolean;
    /** The install in flight, or the last one to have finished. */
    job: ToolboxJob | null;
    request: ToolboxRequest | null;
    busy: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    install: (ids: string[]) => Promise<void>;
    uninstall: (ids: string[]) => Promise<void>;
    setRegistered: (id: string, enabled: boolean) => Promise<void>;
}

/** Configuration panel state and worker calls. Installs run as polled jobs in the service; jobs outlive the panel. */
export const useToolbox = (): ToolboxController => {
    const workerClient = useWorkerClient();
    const [toolbox, setToolbox] = useState<Toolbox | null>(null);
    const [job, setJob] = useState<ToolboxJob | null>(null);
    const [request, setRequest] = useState<ToolboxRequest | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards setState and timers after unmount.
    const mounted = useRef(true);
    const latestRead = useRef(0);
    const requesting = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        const read = ++latestRead.current;
        setLoading(true);
        try {
            const next = await workerClient.getToolbox();
            if (!mounted.current || read !== latestRead.current) return;
            setToolbox(next);
            setJob(next.job ?? null);
            setError(null);
        } catch (e: any) {
            if (!mounted.current || read !== latestRead.current) return;
            setError(e?.message ?? String(e));
        } finally {
            if (mounted.current && read === latestRead.current) setLoading(false);
        }
    }, [workerClient]);

    useEffect(() => { void refresh(); }, [refresh]);

    // Poll while running; full refresh on completion.
    const runningJobId = job?.state === 'running' ? job.id : undefined;
    useEffect(() => {
        if (!runningJobId) return;
        let cancelled = false;
        let reading = false;
        const id = window.setInterval(async () => {
            if (reading) return;
            reading = true;
            try {
                const next = await workerClient.getToolboxJob(runningJobId);
                if (cancelled) return;
                setJob(next);
                if (next.state !== 'running') {
                    window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
                    void refresh();
                }
            } catch {
                // Stale job or transient failure; a full read settles state.
                if (!cancelled) await refresh();
            } finally {
                reading = false;
            }
        }, POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [runningJobId, workerClient, refresh]);

    const runRequest = useCallback(async (next: ToolboxRequest, work: () => Promise<void>) => {
        if (requesting.current || runningJobId || loading) return;
        requesting.current = true;
        setRequest(next);
        try {
            await work();
        } catch (e: any) {
            message.error(e?.message ?? String(e));
        } finally {
            requesting.current = false;
            if (mounted.current) setRequest(null);
        }
    }, [loading, runningJobId]);

    const start = useCallback((kind: 'install' | 'uninstall', ids: string[]) =>
        runRequest({ kind, ids }, async () => {
            const started = await (kind === 'install'
                ? workerClient.installToolboxComponents(ids)
                : workerClient.uninstallToolboxComponents(ids));
            if (!mounted.current) return;
            setJob(started);
            if (started.state !== 'running') {
                window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
                await refresh();
            }
        }), [runRequest, workerClient, refresh]);

    const install = useCallback((ids: string[]) => start('install', ids), [start]);
    const uninstall = useCallback((ids: string[]) => start('uninstall', ids), [start]);

    const setRegistered = useCallback((id: string, enabled: boolean) =>
        runRequest({ kind: 'registration', id }, async () => {
            const next = await workerClient.setToolboxRegistration([id], enabled);
            window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
            if (mounted.current) setToolbox(next);
        }), [runRequest, workerClient]);

    return { toolbox, loading, job, request, busy: loading || !!runningJobId || !!request, error, refresh, install, uninstall, setRegistered };
};
