import { WorkerClient } from './index';

// Caches the root promise per client, collapsing concurrent calls.
// Failures are not cached; the next call retries.
const rootByClient = new WeakMap<WorkerClient, Promise<string>>();

export const getStoreRoot = (client: WorkerClient): Promise<string> => {
    const cached = rootByClient.get(client);
    if (cached) return cached;

    const pending = client.getStoreInfo()
        .then(info => info.rootPath)
        .catch(error => {
            rootByClient.delete(client);
            throw error;
        });
    rootByClient.set(client, pending);
    return pending;
};

/** Joins root and a root-relative path. Normalizes the joining slash. */
export const absoluteStorePath = (root: string, path: string): string => {
    const base = root.replace(/\/+$/, '');
    const relative = path.replace(/^\/+/, '');
    if (!relative) return base || '/';
    return `${base}/${relative}`;
};
