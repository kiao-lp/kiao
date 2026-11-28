import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from './index';
import { getDcmsRoot, absoluteStorePath } from './dcmsRoot';

const clientReturning = (dcmsRoot: string, getStoreInfo = vi.fn().mockResolvedValue({ rootPath: dcmsRoot })) =>
    ({ client: { getStoreInfo } as unknown as WorkerClient, getStoreInfo });

describe('absoluteStorePath', () => {
    it('joins a path to the DCMS root', () => {
        expect(absoluteStorePath('/srv/store', '/docs/note.md')).toBe('/srv/store/docs/note.md');
    });

    it('does not double the separator when the DCMS root ends with one', () => {
        expect(absoluteStorePath('/srv/store/', '/docs/note.md')).toBe('/srv/store/docs/note.md');
    });

    it('keeps a single slash when the DCMS root is the filesystem root', () => {
        expect(absoluteStorePath('/', '/docs/note.md')).toBe('/docs/note.md');
    });

    it('returns the DCMS root for the empty path', () => {
        expect(absoluteStorePath('/srv/store', '')).toBe('/srv/store');
    });
});

describe('getDcmsRoot', () => {
    it('asks the server once and reuses the answer', async () => {
        const { client, getStoreInfo } = clientReturning('/srv/store');

        await expect(getDcmsRoot(client)).resolves.toBe('/srv/store');
        await expect(getDcmsRoot(client)).resolves.toBe('/srv/store');
        expect(getStoreInfo).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent callers into one request', async () => {
        const { client, getStoreInfo } = clientReturning('/srv/store');

        await Promise.all([getDcmsRoot(client), getDcmsRoot(client)]);
        expect(getStoreInfo).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failure, so the next caller retries', async () => {
        const getStoreInfo = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ rootPath: '/srv/store' });
        const { client } = clientReturning('/srv/store', getStoreInfo);

        await expect(getDcmsRoot(client)).rejects.toThrow('offline');
        await expect(getDcmsRoot(client)).resolves.toBe('/srv/store');
        expect(getStoreInfo).toHaveBeenCalledTimes(2);
    });
});
