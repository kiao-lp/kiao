import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileOptimizations } from 'kiao-worker';
import { useWorkerClient, useRefreshFileList } from '@kiao-dashboard-core';
import type { Consolidation, ConsolidationOutcome } from './duplicatesModel';

type Operation = 'scan' | 'consolidate' | 'delete';
const busyError = 'Wait for the current file operation to finish.';

export interface FileOptimizationsController {
    result: FileOptimizations | null;
    operation: Operation | null;
    error: string | null;
    refresh: () => Promise<void>;
    /** Runs the plan; resolves one outcome per group and never rejects. */
    keepOnlyOne: (plan: Consolidation[]) => Promise<ConsolidationOutcome[]>;
    /** Deletes in one request; rejects with the server error after re-scanning. */
    deleteFiles: (paths: string[]) => Promise<void>;
}

/** Scans once per opening; a plan re-scans once at the end. */
export const useFileOptimizations = (enabled: boolean): FileOptimizationsController => {
    const workerClient = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [result, setResult] = useState<FileOptimizations | null>(null);
    const [operation, setOperation] = useState<Operation | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Guards setState after unmount during a long scan.
    const mounted = useRef(true);
    const running = useRef<Operation | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const scan = useCallback(async () => {
        try {
            const next = await workerClient.getFileOptimizations('');
            if (!mounted.current) return;
            setResult(next);
            setError(null);
        } catch (e: any) {
            if (!mounted.current) return;
            setError(e?.message ?? String(e));
        }
    }, [workerClient]);

    const run = useCallback(async <T,>(next: Operation, work: () => Promise<T>) => {
        if (running.current) throw new Error(busyError);
        running.current = next;
        setOperation(next);
        try {
            return await work();
        } finally {
            running.current = null;
            if (mounted.current) setOperation(null);
        }
    }, []);

    const refresh = useCallback(async () => {
        if (!running.current) await run('scan', scan);
    }, [run, scan]);

    // Ref gate scans once per opening; failure or empty results do not retrigger.
    const asked = useRef(false);
    useEffect(() => {
        if (!enabled) {
            asked.current = false;
            return;
        }
        if (asked.current) return;
        asked.current = true;
        void refresh();
    }, [enabled, refresh]);

    const keepOnlyOne = useCallback(async (plan: Consolidation[]): Promise<ConsolidationOutcome[]> => {
        if (running.current) return plan.map(job => ({ target: job.target, removed: [], error: busyError }));
        return run('consolidate', async () => {
            const outcomes: ConsolidationOutcome[] = [];
            // Sequential: concurrent runs would race on shared link rewrites.
            for (const job of plan) {
                try {
                    const done = await workerClient.deduplicate(job.paths, job.target);
                    outcomes.push({ target: job.target, removed: done.removed });
                } catch (e: any) {
                    outcomes.push({ target: job.target, removed: [], error: e?.message ?? String(e) });
                }
            }
            refreshFileList();
            await scan();
            return outcomes;
        });
    }, [workerClient, refreshFileList, run, scan]);

    // One batch with one link-fix pass; listings refresh even on partial failure.
    const deleteFiles = useCallback((paths: string[]) => run('delete', async () => {
        try {
            await workerClient.deleteBatch(paths);
        } finally {
            refreshFileList();
            await scan();
        }
    }), [workerClient, refreshFileList, run, scan]);

    return { result, operation, error, refresh, keepOnlyOne, deleteFiles };
};
