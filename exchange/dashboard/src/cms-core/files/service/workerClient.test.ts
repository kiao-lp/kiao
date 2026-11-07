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
});
