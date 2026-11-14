import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerClient } from './workerClient';

/** Which calls wait for a fresh token, and which do not. */
describe('createWorkerClient', () => {
    const jsonOk = () =>
        ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}) }) as Response;


    const freshening = (token: { current: string }) => {
        const freshenToken = vi.fn(async () => { token.current = 'fresh'; });
        return { freshenToken, getToken: () => token.current };
    };

    const headersOf = (fetchMock: ReturnType<typeof vi.fn>): Record<string, string> =>
        (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => jsonOk());
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('runs an action on the token the top-up just produced, not the one it replaced', async () => {
        const token = { current: 'stale' };
        const { freshenToken, getToken } = freshening(token);

        await createWorkerClient(getToken, freshenToken).runAction('doc.publish', 'docs/u.md', {});

        expect(freshenToken).toHaveBeenCalledTimes(1);
        expect(headersOf(fetchMock).Authorization).toBe('Bearer fresh');
    });

    it('leaves every other call alone — a listing must not renew a token', async () => {
        const token = { current: 'stale' };
        const { freshenToken, getToken } = freshening(token);

        await createWorkerClient(getToken, freshenToken).listFiles('units');

        expect(freshenToken).not.toHaveBeenCalled();
        expect(headersOf(fetchMock).Authorization).toBe('Bearer stale');
    });

    it('sends no bearer at all in a build without security', async () => {
        await createWorkerClient().listFiles('units');

        const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.headers).toBeUndefined();
    });

    it('uses the session bearer for reading bytes and saving a document', async () => {
        fetchMock.mockResolvedValue(new Response('document', { status: 200 }));
        const client = createWorkerClient(() => 'owner-token');

        expect(await client.getFileText('private/a b.md')).toBe('document');
        await client.update('private/a b.md', 'edited document');

        expect(fetchMock.mock.calls).toHaveLength(2);
        for (const [url, init] of fetchMock.mock.calls) {
            expect(new URL(url).searchParams.get('path')).toBe('private/a b.md');
            expect(init.headers.Authorization).toBe('Bearer owner-token');
        }
        expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    });

    it('carries the current session bearer in media and download URLs', async () => {
        const token = { current: 'owner-token' };
        const client = createWorkerClient(() => token.current);
        const first = new URL(await client.getDownloadUrl('private/épisode.mp3'));
        expect(first.pathname).toBe('/api/files/getFile');
        expect(first.searchParams.get('path')).toBe('private/épisode.mp3');
        expect(first.searchParams.get('access_token')).toBe('owner-token');

        token.current = 'renewed-owner-token';
        expect(new URL(await client.getDownloadUrl('private/épisode.mp3')).searchParams.get('access_token'))
            .toBe('renewed-owner-token');
    });

    it('preserves unauthorized and forbidden statuses for the caller', async () => {
        const client = createWorkerClient(() => 'test-token');
        for (const status of [401, 403]) {
            fetchMock.mockResolvedValue(new Response('', { status }));
            await expect(client.getFileText('private/document.md')).rejects.toMatchObject({ response: { status } });
            await expect(client.update('private/document.md', 'edited')).rejects.toMatchObject({ response: { status } });
        }
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
});
