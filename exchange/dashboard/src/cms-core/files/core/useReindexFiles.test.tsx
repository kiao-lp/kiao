import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    client: { reindex: vi.fn() },
    refresh: vi.fn(),
    hide: vi.fn(),
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}));

vi.mock('antd', () => ({ message: h.message }));
vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: () => h.client }));
vi.mock('./CurrentFileList-ctx', () => ({ useRefreshFileList: () => h.refresh }));

import { canReindex, useReindexFiles } from './useReindexFiles';

const result = (over: Partial<{ indexed: string[]; upToDate: number; failed: { path: string; error: string }[]; truncated: boolean }> = {}) =>
    ({ indexed: [], upToDate: 0, failed: [], truncated: false, ...over });

describe('canReindex', () => {
    it('offers the command for a folder, whatever it holds', () => {
        expect(canReindex([{ path: 'docs', isDirectory: true }])).toBe(true);
    });

    it('offers it for a file the service can convert', () => {
        expect(canReindex([{ path: 'docs/runbook.docx', isDirectory: false }])).toBe(true);
        expect(canReindex([{ path: 'mail/Re: budget.MSG', isDirectory: false }])).toBe(true);
    });

    it('withholds it for a file that is already text, or is nothing this converts', () => {
        expect(canReindex([{ path: 'notes.md', isDirectory: false }])).toBe(false);
        expect(canReindex([{ path: 'photo.png', isDirectory: false }])).toBe(false);
        // .doc is an OLE2 container like .msg, but its body is a piece table: not indexable.
        expect(canReindex([{ path: 'legacy.doc', isDirectory: false }])).toBe(false);
    });

    it('offers it for a mixed selection holding at least one convertible entry', () => {
        expect(canReindex([
            { path: 'photo.png', isDirectory: false },
            { path: 'report.pdf', isDirectory: false },
        ])).toBe(true);
    });
});

describe('useReindexFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.message.loading.mockReturnValue(h.hide);
    });

    it('converts the selection, refreshes the listing and says what it did', async () => {
        h.client.reindex.mockResolvedValue(result({ indexed: ['docs/a.docx.index.md'], upToDate: 2 }));

        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current(['docs']); });

        expect(h.client.reindex).toHaveBeenCalledWith(['docs']);
        // The new index files are companions of the documents beside them, so the listing has no
        // other way of hearing that they appeared.
        expect(h.refresh).toHaveBeenCalled();
        expect(h.message.success).toHaveBeenCalledWith('1 document indexed, 2 already up to date');
        expect(h.hide).toHaveBeenCalled();
    });

    it('names the first failure, because a count is not something anybody can act on', async () => {
        h.client.reindex.mockResolvedValue(result({
            indexed: ['a.docx.index.md'],
            failed: [{ path: 'broken.docx', error: 'not a readable zip container' }],
        }));

        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current(['']); });

        expect(h.message.warning).toHaveBeenCalledWith(
            '1 document indexed, 1 failed — broken.docx: not a readable zip container');
    });

    it('says so when the run stopped at the server limit', async () => {
        h.client.reindex.mockResolvedValue(result({ indexed: ['a.docx.index.md'], truncated: true }));

        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current(['']); });

        expect(h.message.success).toHaveBeenCalledWith(
            '1 document indexed, stopped at the server limit — run it again to continue');
    });

    it('reports a folder with nothing to convert rather than claiming success', async () => {
        h.client.reindex.mockResolvedValue(result());

        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current(['photos']); });

        expect(h.message.success).toHaveBeenCalledWith('nothing to index');
    });

    it('surfaces a transport failure and still takes the spinner down', async () => {
        h.client.reindex.mockRejectedValue(new Error('Reindex failed: Bad Gateway'));

        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current(['docs']); });

        expect(h.message.error).toHaveBeenCalledWith('Reindex failed: Bad Gateway');
        expect(h.refresh).not.toHaveBeenCalled();
        expect(h.hide).toHaveBeenCalled();
    });

    it('does nothing at all for an empty selection', async () => {
        const { result: hook } = renderHook(() => useReindexFiles());
        await act(async () => { await hook.current([]); });
        expect(h.client.reindex).not.toHaveBeenCalled();
    });
});
