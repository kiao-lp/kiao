import { useCallback } from 'react';
import { message } from 'antd';
import { isIndexable } from 'kiao-worker';
import { WorkerClient } from 'src/core/files/service';
import { useWorkerClient } from 'src/core/files/service/ui';
import { useRefreshFileList } from './CurrentFileList-ctx';

/** Whether "Rebuild search index" applies to a selection. Folders always apply; files apply when `isIndexable` matches the service table. */
export const canReindex = (entries: { path: string; isDirectory: boolean }[]): boolean =>
    entries.some(entry => entry.isDirectory || isIndexable(entry.path));

const outcomeMessage = (indexed: number, upToDate: number, failed: number, truncated: boolean): string => {
    const parts: string[] = [];
    if (indexed > 0) parts.push(`${indexed} document${indexed > 1 ? 's' : ''} indexed`);
    if (upToDate > 0) parts.push(`${upToDate} already up to date`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (parts.length === 0) parts.push('nothing to index');
    if (truncated) parts.push('stopped at the server limit — run it again to continue');
    return parts.join(', ');
};

/** Converts selected documents to sibling `.index.md`/`.index.csv` and refreshes the listing. Never overwrites a user-edited index. */
export const useReindexFiles = (): ((paths: string[]) => Promise<void>) => {
    const client = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();

    return useCallback(async (paths: string[]) => {
        if (paths.length === 0) return;
        const hide = message.loading('Indexing documents…', 0);
        try {
            const result = await client.reindex(paths);
            refreshFileList();
            const text = outcomeMessage(
                result.indexed.length, result.upToDate, result.failed.length, result.truncated);
            if (result.failed.length > 0) {
                // Include the first failing path.
                message.warning(`${text} — ${result.failed[0].path}: ${result.failed[0].error}`);
            } else {
                message.success(text);
            }
        } catch (e) {
            message.error(e instanceof Error ? e.message : 'Indexing failed');
        } finally {
            hide();
        }
    }, [client, refreshFileList]);
};
