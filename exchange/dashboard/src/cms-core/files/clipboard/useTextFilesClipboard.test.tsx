import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
    client: {}, refresh: vi.fn(), read: vi.fn(), write: vi.fn(),
    readFiles: vi.fn(), pasteFiles: vi.fn(),
    message: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock('../service/ui', () => ({ useWorkerClient: () => h.client }));
vi.mock('../core/CurrentFileList-ctx', () => ({ useRefreshFileList: () => h.refresh }));
vi.mock('../../lib/clipboard', () => ({ setClipboard: h.write }));
vi.mock('antd', () => ({ message: h.message }));
vi.mock('./textFilesClipboard', async importOriginal => ({
    ...await importOriginal<typeof import('./textFilesClipboard')>(),
    readTextFiles: h.readFiles,
    pasteTextFiles: h.pasteFiles,
}));

import { serializeTextFiles } from './textFilesClipboard';
import { useTextFilesClipboard } from './useTextFilesClipboard';

const files = [{ name: 'note.md', content: '# Hello\n' }];

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: h.read } });
    h.read.mockResolvedValue(serializeTextFiles(files));
    h.write.mockResolvedValue(undefined);
    h.readFiles.mockResolvedValue(files);
    h.pasteFiles.mockResolvedValue(1);
});

describe('system text files clipboard', () => {
    it('detects a copy from another instance and clears it when the OS clipboard changes', async () => {
        const { result } = renderHook(useTextFilesClipboard);
        expect(result.current.hasTextFiles).toBe(false);
        await act(() => result.current.refreshTextFiles());
        expect(result.current.hasTextFiles).toBe(true);
        h.read.mockResolvedValue('unrelated text');
        await act(() => result.current.refreshTextFiles());
        expect(result.current.hasTextFiles).toBe(false);
    });

    it('hides paste when clipboard access is denied, without an unhandled rejection', async () => {
        const { result } = renderHook(useTextFilesClipboard);
        await act(() => result.current.refreshTextFiles());
        h.read.mockRejectedValue(new Error('denied'));
        await act(() => result.current.refreshTextFiles());
        expect(result.current.hasTextFiles).toBe(false);
    });

    it('ignores an older clipboard read that resolves after a newer one', async () => {
        let finish!: (value: string) => void;
        h.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
        const { result } = renderHook(useTextFilesClipboard);
        let pending!: Promise<void>;
        act(() => { pending = result.current.refreshTextFiles(); });
        h.read.mockResolvedValue('unrelated text');
        await act(() => result.current.refreshTextFiles());
        await act(async () => { finish(serializeTextFiles(files)); await pending; });
        expect(result.current.hasTextFiles).toBe(false);
    });

    it('writes names and text to the OS clipboard only after the entire selection was read', async () => {
        const { result } = renderHook(useTextFilesClipboard);
        await act(() => result.current.copyTextFiles(['source/note.md']));
        expect(h.write).toHaveBeenCalledWith(serializeTextFiles(files));
        expect(result.current.hasTextFiles).toBe(true);
        h.readFiles.mockRejectedValueOnce(new Error('unreadable'));
        h.write.mockClear();
        await act(() => result.current.copyTextFiles(['binary.txt']));
        expect(h.write).not.toHaveBeenCalled();
        expect(h.message.error).toHaveBeenCalled();
    });

    it('rereads at paste time so a changed clipboard cannot paste stale files', async () => {
        const { result } = renderHook(useTextFilesClipboard);
        await act(() => result.current.refreshTextFiles());
        h.read.mockResolvedValue('unrelated text');
        await act(() => result.current.pasteTextFiles('target'));
        expect(h.pasteFiles).not.toHaveBeenCalled();
        expect(result.current.hasTextFiles).toBe(false);
    });

    it('pastes without consulting source paths and refreshes the tree', async () => {
        const { result } = renderHook(useTextFilesClipboard);
        await act(() => result.current.pasteTextFiles('target'));
        expect(h.pasteFiles).toHaveBeenCalledWith(h.client, files, 'target', []);
        expect(h.refresh).toHaveBeenCalled();
        expect(h.message.success).toHaveBeenCalled();
    });

    it('reports failures and refreshes after a possibly partial write', async () => {
        h.pasteFiles.mockRejectedValueOnce(new Error('failed'));
        const { result } = renderHook(useTextFilesClipboard);
        await act(() => result.current.pasteTextFiles('target'));
        expect(h.message.success).not.toHaveBeenCalled();
        expect(h.message.error).toHaveBeenCalled();
        expect(h.refresh).toHaveBeenCalled();
    });
});
