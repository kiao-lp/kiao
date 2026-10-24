import { describe, it, expect, vi } from 'vitest';
import { performCut, performCopy } from './clipboardOps';
import { WorkerClient, FileDto } from '../service';

/**
 * In-memory WorkerClient stand-in. Only the methods clipboardOps touches are
 * implemented; enough to exercise path handling and the batch calls without a
 * real backend. `copyBatch` is deliberately shallow — recursion, collision
 * resolution and the copy-into-itself guard are worker's job now, and are
 * covered by its Go tests (`service_test.go`).
 */
type Entry = { isDirectory: boolean; blob?: Blob };

function makeFs(initial: Record<string, 'dir' | 'file'> = {}) {
    const fs = new Map<string, Entry>();
    for (const [path, kind] of Object.entries(initial)) {
        fs.set(path, { isDirectory: kind === 'dir', blob: kind === 'file' ? new Blob(['x']) : undefined });
    }

    const meta = (path: string): FileDto => ({
        path,
        isDirectory: !!fs.get(path)?.isDirectory,
        size: 0,
        lastModified: 0,
    });

    const client = {
        getFileMetadata: vi.fn(async (path: string): Promise<FileDto> => {
            if (!fs.has(path)) throw new Error(`404 ${path}`);
            return meta(path);
        }),
        listFiles: vi.fn(async (path: string): Promise<FileDto[]> => {
            const prefix = path === '' ? '' : `${path}/`;
            return Array.from(fs.keys())
                .filter(p => p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
                .map(meta);
        }),
        getFileBlob: vi.fn(async (path: string): Promise<Blob> => {
            const e = fs.get(path);
            if (!e || e.isDirectory) throw new Error(`not a file ${path}`);
            return e.blob!;
        }),
        update: vi.fn(async (path: string, content: Blob): Promise<void> => {
            fs.set(path, { isDirectory: false, blob: content as Blob });
        }),
        createFolder: vi.fn(async (path: string): Promise<void> => {
            fs.set(path, { isDirectory: true });
        }),
        rename: vi.fn(async (from: string, to: string): Promise<void> => {
            if (!fs.has(from)) throw new Error(`404 ${from}`);
            for (const [p, e] of Array.from(fs.entries())) {
                if (p === from) {
                    fs.delete(p);
                    fs.set(to, e);
                } else if (p.startsWith(`${from}/`)) {
                    fs.delete(p);
                    fs.set(to + p.slice(from.length), e);
                }
            }
        }),
        copyBatch: vi.fn(async (paths: string[], targetFolder?: string): Promise<any> => {
            const cleanTarget = (targetFolder || '').replace(/\/$/, '');
            return paths.map(from => {
                const to = cleanTarget ? `${cleanTarget}/${from.split('/').pop()}` : from.split('/').pop()!;
                fs.set(to, fs.get(from)!);
                return { from, to };
            });
        }),
        moveBatch: vi.fn(async (pathsOrReq: any, targetFolder?: string): Promise<any> => {
            const paths: string[] = Array.isArray(pathsOrReq) ? pathsOrReq : pathsOrReq.paths;
            const target: string = (typeof pathsOrReq === 'object' && !Array.isArray(pathsOrReq) ? pathsOrReq.targetFolder : targetFolder) || '';
            for (const src of paths) {
                const basename = src.split('/').pop()!;
                const cleanTarget = target.endsWith('/') ? target.slice(0, -1) : target;
                const to = cleanTarget ? `${cleanTarget}/${basename}` : basename;
                await client.rename(src, to);
            }
            return [];
        }),
    };

    return { client: client as unknown as WorkerClient, fs, spies: client };
}

describe('clipboardOps – performCut', () => {
    it('moves each entry into the target folder keeping its basename', async () => {
        const { client, fs, spies } = makeFs({ 'a/b/file.txt': 'file', 'dest': 'dir' });

        const outcome = await performCut(client, ['a/b/file.txt'], 'dest');

        expect(outcome).toEqual({ succeeded: 1, failed: [] });
        expect(spies.moveBatch).toHaveBeenCalledWith(['a/b/file.txt'], 'dest');
        expect(fs.has('dest/file.txt')).toBe(true);
        expect(fs.has('a/b/file.txt')).toBe(false);
    });

    it('moves into the repository root when the target folder is empty', async () => {
        const { client, spies } = makeFs({ 'a/file.txt': 'file' });

        await performCut(client, ['a/file.txt'], '');

        expect(spies.moveBatch).toHaveBeenCalledWith(['a/file.txt'], '');
    });

    it('strips a trailing slash on the target folder', async () => {
        const { client, spies } = makeFs({ 'a/file.txt': 'file' });

        await performCut(client, ['a/file.txt'], 'dest/');

        expect(spies.moveBatch).toHaveBeenCalledWith(['a/file.txt'], 'dest/');
    });

    it('skips an entry already living in the target folder (no move, not counted)', async () => {
        const { client, spies } = makeFs({ 'dest/file.txt': 'file' });

        const outcome = await performCut(client, ['dest/file.txt'], 'dest');

        expect(spies.moveBatch).not.toHaveBeenCalled();
        expect(outcome).toEqual({ succeeded: 0, failed: [] });
    });

    // A refused batch is reported as a whole, with no per-entry retry: worker link-fixes
    // the whole store once per request, so retrying entry by entry repeats that walk N times —
    // and the usual reason the batch failed is that it was already too slow. Same choice as
    // performCopy below.
    it('reports every entry as failed when the batch is refused, without retrying one by one', async () => {
        const { client, spies } = makeFs({ 'a/ok.txt': 'file', 'a/bad.txt': 'file' });
        (spies.moveBatch as any).mockImplementationOnce(async () => { throw new Error('batch error'); });

        const outcome = await performCut(client, ['a/bad.txt', 'a/ok.txt'], 'dest');

        expect(outcome.succeeded).toBe(0);
        expect(outcome.failed.map(f => f.path)).toEqual(['a/bad.txt', 'a/ok.txt']);
        expect(spies.rename).not.toHaveBeenCalled();
    });
});

describe('clipboardOps – performCopy', () => {
    it('hands the whole selection to the service in a single copyBatch call', async () => {
        const { client, spies } = makeFs({ 'a/file.txt': 'file', 'a/dir': 'dir' });

        const outcome = await performCopy(client, ['a/file.txt', 'a/dir'], 'dest');

        expect(outcome).toEqual({ succeeded: 2, failed: [] });
        expect(spies.copyBatch).toHaveBeenCalledTimes(1);
        expect(spies.copyBatch).toHaveBeenCalledWith(['a/file.txt', 'a/dir'], 'dest');
    });

    it('never walks the tree itself — no per-file read or write', async () => {
        const { client, spies } = makeFs({
            'src': 'dir',
            'src/a.txt': 'file',
            'src/sub': 'dir',
            'src/sub/b.txt': 'file',
        });

        await performCopy(client, ['src'], 'dest');

        expect(spies.listFiles).not.toHaveBeenCalled();
        expect(spies.getFileMetadata).not.toHaveBeenCalled();
        expect(spies.getFileBlob).not.toHaveBeenCalled();
        expect(spies.createFolder).not.toHaveBeenCalled();
    });

    it('copies into the repository root when the target folder is empty', async () => {
        const { client, spies } = makeFs({ 'src/file.txt': 'file' });

        await performCopy(client, ['src/file.txt'], '');

        expect(spies.copyBatch).toHaveBeenCalledWith(['src/file.txt'], '');
    });

    it('does nothing at all for an empty selection', async () => {
        const { client, spies } = makeFs();

        const outcome = await performCopy(client, [], 'dest');

        expect(outcome).toEqual({ succeeded: 0, failed: [] });
        expect(spies.copyBatch).not.toHaveBeenCalled();
    });

    it('reports every entry as failed when the batch is refused', async () => {
        const { client, spies } = makeFs({ 'src/a.txt': 'file', 'src/b.txt': 'file' });
        (spies.copyBatch as any).mockImplementationOnce(async () => { throw new Error('copy failed'); });

        const outcome = await performCopy(client, ['src/a.txt', 'src/b.txt'], 'dest');

        expect(outcome.succeeded).toBe(0);
        expect(outcome.failed.map(f => f.path)).toEqual(['src/a.txt', 'src/b.txt']);
    });
});
