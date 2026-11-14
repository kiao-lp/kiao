import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileOptimizations } from 'kiao-worker';
import { useWorkerClient, useRefreshFileList } from '@kiao-dashboard-core';
import type { Consolidation, ConsolidationOutcome } from './duplicatesModel';

export interface FileOptimizationsController {
    result: FileOptimizations | null;
    loading: boolean;
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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Guards setState after unmount during a long scan.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const next = await workerClient.getFileOptimizations('');
            if (!mounted.current) return;
            setResult(next);
            setError(null);
        } catch (e: any) {
            if (!mounted.current) return;
            setError(e?.message ?? String(e));
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, [workerClient]);

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
        await refresh();
        return outcomes;
    }, [workerClient, refreshFileList, refresh]);

    // One batch with one link-fix pass; listings refresh even on partial failure.
    const deleteFiles = useCallback(async (paths: string[]): Promise<void> => {
        try {
            await workerClient.deleteBatch(paths);
        } finally {
            refreshFileList();
            await refresh();
        }
    }, [workerClient, refreshFileList, refresh]);

    return { result, loading, error, refresh, keepOnlyOne, deleteFiles };
};
