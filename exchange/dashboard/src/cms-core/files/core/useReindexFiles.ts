import { useCallback } from 'react';
import { message } from 'antd';
import { isIndexable } from 'kiao-worker';
import { WorkerClient } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useRefreshFileList } from './CurrentFileList-ctx';

/**
 * Whether "Rebuild search index" applies to a selection.
 *
 * A folder always does — what it holds is not known here, and asking the server about every entry
 * to draw a menu is exactly the round trip the store's other rules avoid. A file does when the
 * service can convert its type; the list is `INDEXABLE_EXTENSIONS`, which mirrors the service's
 * own table.
 */
export const canReindex = (entries: { path: string; isDirectory: boolean }[]): boolean =>
    entries.some(entry => entry.isDirectory || isIndexable(entry.path));

/** What to tell the user a reindex did. */
const outcomeMessage = (indexed: number, upToDate: number, failed: number, truncated: boolean): string => {
    const parts: string[] = [];
    if (indexed > 0) parts.push(`${indexed} document${indexed > 1 ? 's' : ''} indexed`);
    if (upToDate > 0) parts.push(`${upToDate} already up to date`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (parts.length === 0) parts.push('nothing to index');
    if (truncated) parts.push('stopped at the server limit — run it again to continue');
    return parts.join(', ');
};

/**
 * Converts the selected documents — or everything under the selected folders — into their sibling
 * `.index.md` / `.index.csv`, and refreshes the listing so the new companions appear.
 *
 * Search does this on its own for anything missing or out of date, so this is for the two cases it
 * will not cover: doing a whole folder now instead of on the next search, and converting indexes an
 * older version of the service wrote as flat text. Neither touches an index somebody edited.
 */
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
                // Name the first one: "3 failed" with no path is not something anybody can act on.
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
