import { describe, it, expect, vi } from 'vitest';
import { collectDeleteScope } from './deleteScope';
import { WorkerClient, FileDto } from '../service';

const entry = (path: string, isDirectory = false): FileDto => ({
    path, isDirectory, size: 0, lastModified: 0,
});

function fakeClient(files: FileDto[], truncated = false) {
    const listRecursive = vi.fn(async () => ({ files, truncated }));
    return { client: { listRecursive } as unknown as WorkerClient, listRecursive };
}

describe('collectDeleteScope', () => {
    // The whole point: whatever the selection, the server is asked once. The recursion this
    // replaced cost one request per directory, before the confirmation had even opened.
    it('asks the server once for the whole selection', async () => {
        const { client, listRecursive } = fakeClient([
            entry('src', true), entry('src/a.txt'), entry('src/sub', true), entry('src/sub/b.txt'),
        ]);

        const scope = await collectDeleteScope(client, ['src', 'loose.txt']);

        expect(listRecursive).toHaveBeenCalledTimes(1);
        expect(listRecursive).toHaveBeenCalledWith(['src', 'loose.txt']);
        expect(scope.selection).toEqual(['src', 'loose.txt']);
        expect(scope.entries.map(e => e.path)).toEqual(['src', 'src/a.txt', 'src/sub', 'src/sub/b.txt']);
        expect(scope.truncated).toBe(false);
    });

    it('carries the truncation flag through', async () => {
        const { client } = fakeClient([entry('big/f1.txt')], true);

        expect((await collectDeleteScope(client, ['big'])).truncated).toBe(true);
    });

    it('asks nothing for an empty selection', async () => {
        const { client, listRecursive } = fakeClient([]);

        const scope = await collectDeleteScope(client, []);

        expect(listRecursive).not.toHaveBeenCalled();
        expect(scope).toEqual({ selection: [], entries: [], truncated: false });
    });
});
