import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranch } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';

export interface GitBranchesState {
    branches: GitBranch[];
    loading: boolean;
    /** Reads the branch list of the repository the panel is scoped to. */
    load: () => Promise<void>;
}

/**
 * The branches the selector offers. They are read when the selector opens rather than alongside
 * the status: which branches exist changes only on a fetch, a pull or a checkout, so paying a git
 * command for it on every status refresh — every navigation, every 15-second poll — would buy
 * nothing. Moving to another folder drops the list, since the next one belongs to another
 * repository.
 */
export const useGitBranches = (folder: string): GitBranchesState => {
    const workerClient = useWorkerClient();
    const [branches, setBranches] = useState<GitBranch[]>([]);
    const [loading, setLoading] = useState(false);
    const reqId = useRef(0);

    useEffect(() => {
        // Invalidate whatever is in flight too: its answer describes the folder we just left.
        reqId.current++;
        setBranches([]);
    }, [folder]);

    const load = useCallback(async () => {
        const id = ++reqId.current;
        setLoading(true);
        try {
            const { branches: list } = await workerClient.gitBranches(folder);
            if (id === reqId.current) setBranches(list ?? []);
        } catch {
            // The selector keeps showing the current branch from the status; a failed list is
            // an empty dropdown, not an error the user has to dismiss.
            if (id === reqId.current) setBranches([]);
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, [workerClient, folder]);

    return { branches, loading, load };
};
