import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from './index';
import { getStoreRoot, absoluteStorePath } from './storeRoot';

const clientReturning = (rootPath: string, getStoreInfo = vi.fn().mockResolvedValue({ rootPath })) =>
    ({ client: { getStoreInfo } as unknown as WorkerClient, getStoreInfo });

describe('absoluteStorePath', () => {
    it('joins the root and a root-relative path', () => {
        expect(absoluteStorePath('/srv/store', '/docs/note.md')).toBe('/srv/store/docs/note.md');
    });

    it('does not double the separator when the root ends with one', () => {
        expect(absoluteStorePath('/srv/store/', '/docs/note.md')).toBe('/srv/store/docs/note.md');
    });

    it('keeps a single slash when the store is served from the filesystem root', () => {
        expect(absoluteStorePath('/', '/docs/note.md')).toBe('/docs/note.md');
    });

    it('returns the root itself for the empty path', () => {
        expect(absoluteStorePath('/srv/store', '')).toBe('/srv/store');
    });
});

describe('getStoreRoot', () => {
    it('asks the server once and reuses the answer', async () => {
        const { client, getStoreInfo } = clientReturning('/srv/store');

        await expect(getStoreRoot(client)).resolves.toBe('/srv/store');
        await expect(getStoreRoot(client)).resolves.toBe('/srv/store');
        expect(getStoreInfo).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent callers into one request', async () => {
        const { client, getStoreInfo } = clientReturning('/srv/store');

        await Promise.all([getStoreRoot(client), getStoreRoot(client)]);
        expect(getStoreInfo).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failure, so the next caller retries', async () => {
        const getStoreInfo = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ rootPath: '/srv/store' });
        const { client } = clientReturning('/srv/store', getStoreInfo);

        await expect(getStoreRoot(client)).rejects.toThrow('offline');
        await expect(getStoreRoot(client)).resolves.toBe('/srv/store');
        expect(getStoreInfo).toHaveBeenCalledTimes(2);
    });
});
