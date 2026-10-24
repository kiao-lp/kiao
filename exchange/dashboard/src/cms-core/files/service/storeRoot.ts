import { WorkerClient } from './index';

/**
 * The store root as the *server* sees it, which is the only side that knows it: every path on the
 * wire is root-relative, so a host path exists nowhere in the browser until it is asked for. It
 * cannot change while the service runs, so the request is made once per client and the promise —
 * not the value — is cached, which also collapses concurrent callers into a single round trip. A
 * failed request is not cached: the next caller retries rather than inheriting the error.
 */
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

/**
 * Joins the store root and a root-relative path into the absolute path of the same file on the
 * host. Both sides are normalised for the slash between them, so a root reported with a trailing
 * separator — "/" being the one that really happens — produces no doubled one.
 */
export const absoluteStorePath = (root: string, path: string): string => {
    const base = root.replace(/\/+$/, '');
    const relative = path.replace(/^\/+/, '');
    if (!relative) return base || '/';
    return `${base}/${relative}`;
};
