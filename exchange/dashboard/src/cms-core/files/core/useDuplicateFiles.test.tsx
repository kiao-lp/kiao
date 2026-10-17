import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    client: { listFiles: vi.fn(), copyBatch: vi.fn() },
    refresh: vi.fn(),
    message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('antd', () => ({ message: h.message }));
vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: () => h.client }));
vi.mock('./CurrentFileList-ctx', () => ({ useRefreshFileList: () => h.refresh }));
vi.mock('src/cms-core/core/PluginList-ctx', () => ({
    usePluginListContext: () => ({ knownExtensions: ['.mmap.json', '.md'] }),
}));

import { useDuplicateFiles } from './useDuplicateFiles';

describe('useDuplicateFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.client.copyBatch.mockImplementation(async (req: { items: { from: string; to: string }[] }) =>
            req.items.map(item => ({ from: item.from, to: item.to })));
    });

    it('copies the entry beside itself under the first free number', async () => {
        h.client.listFiles.mockResolvedValue([
            { path: 'docs/notes.md' }, { path: 'docs/notes 1.md' },
        ]);

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['docs/notes.md']); });

        expect(h.client.listFiles).toHaveBeenCalledWith('docs');
        expect(h.client.copyBatch).toHaveBeenCalledWith({
            items: [{ from: 'docs/notes.md', to: 'docs/notes 2.md' }],
        });
        expect(h.refresh).toHaveBeenCalled();
        expect(h.message.success).toHaveBeenCalledWith('Duplicated as notes 2.md');
    });

    it('keeps a compound extension a plugin declared', async () => {
        h.client.listFiles.mockResolvedValue([{ path: 'plan.mmap.json' }]);

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['plan.mmap.json']); });

        expect(h.client.listFiles).toHaveBeenCalledWith('');
        expect(h.client.copyBatch).toHaveBeenCalledWith({
            items: [{ from: 'plan.mmap.json', to: 'plan 1.mmap.json' }],
        });
    });

    it('lists a folder once for the whole selection and numbers the entries apart', async () => {
        h.client.listFiles.mockResolvedValue([{ path: 'docs/a.md' }, { path: 'docs/a 1.md' }]);

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['docs/a.md', 'docs/a 1.md']); });

        expect(h.client.listFiles).toHaveBeenCalledTimes(1);
        expect(h.client.copyBatch).toHaveBeenCalledWith({
            items: [
                { from: 'docs/a.md', to: 'docs/a 2.md' },
                { from: 'docs/a 1.md', to: 'docs/a 3.md' },
            ],
        });
        expect(h.message.success).toHaveBeenCalledWith('2 items duplicated');
    });

    it('lists every folder a selection spans', async () => {
        h.client.listFiles.mockImplementation(async (folder: string) =>
            folder === 'docs' ? [{ path: 'docs/a.md' }] : [{ path: 'notes/a.md' }]);

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['docs/a.md', 'notes/a.md']); });

        expect(h.client.listFiles).toHaveBeenCalledWith('docs');
        expect(h.client.listFiles).toHaveBeenCalledWith('notes');
        expect(h.client.copyBatch).toHaveBeenCalledWith({
            items: [
                { from: 'docs/a.md', to: 'docs/a 1.md' },
                { from: 'notes/a.md', to: 'notes/a 1.md' },
            ],
        });
    });

    it('leaves the store root alone rather than copying the whole store', async () => {
        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['']); });

        expect(h.client.listFiles).not.toHaveBeenCalled();
        expect(h.client.copyBatch).not.toHaveBeenCalled();
    });

    it('reports the name the service settled on when it differs', async () => {
        h.client.listFiles.mockResolvedValue([{ path: 'notes.md' }]);
        h.client.copyBatch.mockResolvedValue([{ from: 'notes.md', to: 'notes 1 (copy).md' }]);

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['notes.md']); });

        expect(h.message.success).toHaveBeenCalledWith('Duplicated as notes 1 (copy).md');
    });

    it('says so rather than throwing when the copy fails', async () => {
        h.client.listFiles.mockResolvedValue([{ path: 'notes.md' }]);
        h.client.copyBatch.mockRejectedValue(new Error('boom'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });

        const { result } = renderHook(() => useDuplicateFiles());
        await act(async () => { await result.current(['notes.md']); });

        expect(h.message.error).toHaveBeenCalledWith('Could not duplicate notes.md');
        expect(h.refresh).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
