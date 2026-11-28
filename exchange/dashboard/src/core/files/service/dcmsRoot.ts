import type { WorkerClient } from 'kiao-worker';

// Caches the DCMS root per client, collapsing concurrent calls.
// Failures are not cached; the next call retries.
const dcmsRootByClient = new WeakMap<WorkerClient, Promise<string>>();

export const getDcmsRoot = (client: WorkerClient): Promise<string> => {
    const cached = dcmsRootByClient.get(client);
    if (cached) return cached;

    const pending = client.getStoreInfo()
        .then(info => info.rootPath)
        .catch(error => {
            dcmsRootByClient.delete(client);
            throw error;
        });
    dcmsRootByClient.set(client, pending);
    return pending;
};

/** Builds an absolute host path from the DCMS root and a path in the store. */
export const absoluteStorePath = (dcmsRoot: string, path: string): string => {
    const base = dcmsRoot.replace(/\/+$/, '');
    const relative = path.replace(/^\/+/, '');
    if (!relative) return base || '/';
    return `${base}/${relative}`;
};
