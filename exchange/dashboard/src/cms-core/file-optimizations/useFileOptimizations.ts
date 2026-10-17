import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileOptimizations } from 'kiao-worker';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useRefreshFileList } from '../files/core/CurrentFileList-ctx';
import type { Consolidation, ConsolidationOutcome } from './duplicatesModel';

export interface FileOptimizationsController {
    result: FileOptimizations | null;
    loading: boolean;
    error: string | null;
    /** Ask the server to walk the store again. */
    refresh: () => Promise<void>;
    /**
     * Run a whole plan: reduce each group of identical files to the one at its target. Resolves to
     * one outcome per group, in the order given — it does not reject, because a plan is a set of
     * separate decisions and one refused group says nothing about the others.
     */
    keepOnlyOne: (plan: Consolidation[]) => Promise<ConsolidationOutcome[]>;
    /**
     * Delete these files from the store in one request. Rejects with what the server said when one
     * of them could not go — after the scan has been asked again, since the ones before it did.
     */
    deleteFiles: (paths: string[]) => Promise<void>;
}

/**
 * The view's whole conversation with worker.
 *
 * The scan is asked for **once, when the view opens**, and after that only when someone presses
 * Re-scan. It walks the store and reads every file whose size collides with another's, so it is the
 * most expensive question DCMS answers and the last one that should be asked on a re-render.
 *
 * A consolidation re-runs it, because what it did invalidates the answer that suggested it — the
 * group is gone, and the biggest-files list has a path in it that no longer exists. It also bumps
 * the store revision, which is how the file tree, the browser and anything else drawing the store
 * from its own listing hears that files moved. A plan of twenty consolidations re-runs it **once**,
 * at the end: the scan is the expensive question, and asking it between two groups would pay for
 * the walk twenty times to answer nobody.
 */
export const useFileOptimizations = (enabled: boolean): FileOptimizationsController => {
    const workerClient = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [result, setResult] = useState<FileOptimizations | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // A view closed mid-scan must not set state on its way out; the scan is long enough that this
    // is the ordinary case rather than a race nobody hits.
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

    // Asked for once per opening, and by a ref rather than by "there is no result yet": a scan
    // that failed, or one that legitimately found nothing, must not start itself again on the next
    // render. Closing the view arms the next opening.
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
        // One group at a time. Each consolidation moves files and then rewrites every document that
        // pointed at them, so two running at once would be repairing the same document's links from
        // two separate reads of it — the second write would carry the first one away.
        for (const job of plan) {
            try {
                const done = await workerClient.deduplicate(job.paths, job.target);
                outcomes.push({ target: job.target, removed: done.removed });
            } catch (e: any) {
                // The store may have moved on under the scan for this group and not for the next
                // one, so a refusal is recorded and the plan carries on: every group in it was
                // chosen as deliberately as this one.
                outcomes.push({ target: job.target, removed: [], error: e?.message ?? String(e) });
            }
        }
        refreshFileList();
        await refresh();
        return outcomes;
    }, [workerClient, refreshFileList, refresh]);

    // One `deleteBatch`, as the file browser deletes: every path goes, then one link-fix pass covers
    // the lot — rather than a store-wide pass per file. The server stops at the first path it cannot
    // remove, but the ones before it are gone either way, so the listings are refreshed on the way
    // out whatever happened: a list still showing a file that is not there is how people delete
    // twice.
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
