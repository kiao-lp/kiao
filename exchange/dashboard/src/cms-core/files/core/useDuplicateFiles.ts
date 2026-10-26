import { useCallback, useMemo } from 'react';
import { message } from 'antd';
import { extractName, WorkerClient } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { usePluginListContext } from 'src/cms-core/core/PluginList-ctx';
import { useRefreshFileList } from './CurrentFileList-ctx';
import { DuplicateItem, duplicateItemsIn } from './duplicateName';

const folderOf = (path: string): string => {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.slice(0, cut);
};

/**
 * Where every entry of a selection should land, its folder listed once however many entries it
 * holds. The listings are read rather than taken from the browsed one: a row can come from a
 * search result, and then the folder holding it is not the one on screen — and a selection can
 * span several folders anyway.
 */
const duplicationItems = async (
    client: WorkerClient,
    paths: string[],
    knownExtensions: string[],
): Promise<DuplicateItem[]> => {
    const byFolder = new Map<string, string[]>();
    for (const path of paths) {
        const folder = folderOf(path);
        byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    }

    const perFolder = await Promise.all(
        Array.from(byFolder.entries()).map(async ([folder, folderPaths]) => {
            const siblings = await client.listFiles(folder);
            return duplicateItemsIn(folderPaths, siblings.map(file => file.path), knownExtensions);
        }),
    );
    return perFolder.flat();
};

/**
 * Copies entries beside themselves under numbered names.
 *
 * `copyBatch` carries whole entries — a file with its subsidiaries, a directory with everything
 * under it — and takes the batch in one request, so a selection of any size costs one round trip
 * per folder it spans plus one for the copy itself.
 */
export const useDuplicateFiles = (): ((paths: string[]) => Promise<void>) => {
    const client = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();
    const { knownExtensions } = usePluginListContext();

    return useCallback(async (paths: string[]) => {
        const targets = paths.filter(Boolean); // The store root is not an entry anything can copy.
        if (targets.length === 0) return;
        try {
            const items = await duplicationItems(client, targets, knownExtensions);
            const results = await client.copyBatch({ items });
            refreshFileList();
            message.success(results.length === 1
                ? `Duplicated as ${extractName(results[0]?.to ?? items[0].to)}`
                : `${results.length} items duplicated`);
        } catch (error) {
            console.error('Duplicate failed', targets, error);
            message.error(targets.length === 1
                ? `Could not duplicate ${extractName(targets[0])}`
                : `Could not duplicate ${targets.length} items`);
        }
    }, [client, refreshFileList, knownExtensions]);
};
