import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitStatus } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { useGitDiff } from './GitDiff-ctx';

export interface GitStatusState {
    status: GitStatus | null;
    loading: boolean;
    error: string | null;
    /** Re-read `git status`; safe to call concurrently (last request wins). */
    refresh: () => Promise<void>;
}

/**
 * Reads `git status` for the repository `folder` belongs to into React state, and re-reads it
 * whenever the folder changes or the shared refresh token bumps (i.e. after any git mutation).
 * Concurrent reads are request-id guarded so a slow earlier read can't clobber a newer result.
 */
export const useGitStatus = (folder: string): GitStatusState => {
    const workerClient = useWorkerClient();
    const { refreshToken } = useGitDiff();

    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const reqId = useRef(0);

    const refresh = useCallback(async () => {
        const id = ++reqId.current;
        try {
            const s = await workerClient.gitStatus(folder);
            if (id === reqId.current) {
                setStatus(s);
                setError(null);
            }
        } catch (e: any) {
            if (id === reqId.current) setError(e?.message ?? 'Failed to read git status');
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, [workerClient, folder]);

    useEffect(() => {
        refresh();
    }, [refresh, refreshToken]);

    return { status, loading, error, refresh };
};
