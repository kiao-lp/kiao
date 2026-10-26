import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The provider pulls the files client and the file-list refresher from context,
// and antd's notification for progress toasts. Stub all three so the test
// exercises only the clipboard state machine.
const h = vi.hoisted(() => ({
    client: {
        rename: vi.fn(),
        getFileMetadata: vi.fn(),
        getFileBlob: vi.fn(),
        update: vi.fn(),
        createFolder: vi.fn(),
        listFiles: vi.fn(),
        moveBatch: vi.fn(),
        copyBatch: vi.fn(),
    },
    refresh: vi.fn(),
}));

vi.mock('../service/ui', () => ({ useWorkerClient: () => h.client }));
vi.mock('../core/CurrentFileList-ctx', () => ({ useRefreshFileList: () => h.refresh }));
vi.mock('antd', () => ({
    notification: { open: vi.fn(), destroy: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { ClipboardModelProvider, useClipboard } from './ClipboardModel-ctx';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ClipboardModelProvider>{children}</ClipboardModelProvider>
);

const renderClipboard = () => renderHook(() => useClipboard(), { wrapper });

beforeEach(() => {
    vi.clearAllMocks();
    h.client.rename.mockResolvedValue(undefined);
    h.client.update.mockResolvedValue(undefined);
    h.client.getFileBlob.mockResolvedValue(new Blob(['x']));
    h.client.moveBatch.mockResolvedValue([]);
    h.client.copyBatch.mockResolvedValue([]);
});

describe('ClipboardModel – state machine', () => {
    it('starts empty', () => {
        const { result } = renderClipboard();
        expect(result.current.state).toBeNull();
        expect(result.current.hasEntries()).toBe(false);
    });

    it('cut records entries in cut mode', () => {
        const { result } = renderClipboard();
        act(() => result.current.cut(['a/x.txt', 'a/y.txt']));

        expect(result.current.hasEntries()).toBe(true);
        expect(result.current.state?.mode).toBe('cut');
        expect(result.current.isCut('a/x.txt')).toBe(true);
        expect(result.current.isCut('a/other.txt')).toBe(false);
    });

    it('copy records entries in copy mode (isCut stays false)', () => {
        const { result } = renderClipboard();
        act(() => result.current.copy(['a/x.txt']));

        expect(result.current.hasEntries()).toBe(true);
        expect(result.current.state?.mode).toBe('copy');
        expect(result.current.isCut('a/x.txt')).toBe(false);
    });

    it('ignores cut/copy of an empty selection', () => {
        const { result } = renderClipboard();
        act(() => result.current.cut([]));
        act(() => result.current.copy([]));
        expect(result.current.state).toBeNull();
    });

    it('clear empties the clipboard', () => {
        const { result } = renderClipboard();
        act(() => result.current.copy(['a/x.txt']));
        act(() => result.current.clear());
        expect(result.current.state).toBeNull();
        expect(result.current.hasEntries()).toBe(false);
    });

    it('paste with nothing on the clipboard returns null and touches no files', async () => {
        const { result } = renderClipboard();
        let outcome: unknown;
        await act(async () => { outcome = await result.current.paste('dest'); });

        expect(outcome).toBeNull();
        expect(h.client.moveBatch).not.toHaveBeenCalled();
        expect(h.client.copyBatch).not.toHaveBeenCalled();
        expect(h.refresh).not.toHaveBeenCalled();
    });

    it('pasting a cut moves the files, clears the clipboard and refreshes', async () => {
        const { result } = renderClipboard();
        act(() => result.current.cut(['a/x.txt']));

        let outcome: any;
        await act(async () => { outcome = await result.current.paste('dest'); });

        expect(h.client.moveBatch).toHaveBeenCalledWith(['a/x.txt'], 'dest');
        expect(h.client.rename).not.toHaveBeenCalled();
        expect(outcome.succeeded).toBe(1);
        expect(result.current.state).toBeNull(); // cut is consumed
        expect(h.refresh).toHaveBeenCalled();
    });

    it('pasting a copy keeps the clipboard so it can be pasted again', async () => {
        h.client.copyBatch.mockResolvedValue([{ from: 'a/x.txt', to: 'dest/x.txt' }]);
        const { result } = renderClipboard();
        act(() => result.current.copy(['a/x.txt']));

        await act(async () => { await result.current.paste('dest'); });

        expect(h.client.copyBatch).toHaveBeenCalledWith(['a/x.txt'], 'dest');
        expect(result.current.state?.mode).toBe('copy'); // still there
        expect(h.refresh).toHaveBeenCalled();
    });

    // A move runs the link-fixer over the whole store, so even a one-file paste can take seconds.
    // It used to take more than five entries to get any feedback at all, which made a slow paste
    // indistinguishable from one that did nothing.
    it('shows progress and completion for a single-entry paste too', async () => {
        const { notification } = await import('antd');
        const { result } = renderClipboard();
        act(() => result.current.cut(['a/x.txt']));

        await act(async () => { await result.current.paste('dest'); });

        expect(notification.open).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Moving 1 file from a to dest\u2026',
            description: expect.anything(),
        }));
        expect(notification.destroy).toHaveBeenCalled();
        expect(notification.success).toHaveBeenCalledWith({ message: 'Moved 1 file from a to dest' });
        expect(notification.error).not.toHaveBeenCalled();
    });

    // The failure headline must not open with the verb of success: "Moved N files ... with errors"
    // read as a move that mostly worked, when in fact nothing had moved.
    it('leads with the failure when the move is refused', async () => {
        const { notification } = await import('antd');
        h.client.moveBatch.mockRejectedValueOnce(new Error('boom'));
        const { result } = renderClipboard();
        act(() => result.current.cut(['a/x.txt', 'a/y.txt']));

        let outcome: any;
        await act(async () => { outcome = await result.current.paste('dest'); });

        expect(outcome.succeeded).toBe(0);
        expect(notification.success).not.toHaveBeenCalled();
        expect(notification.error).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Could not move 2 files from a to dest',
        }));
        expect(h.client.rename).not.toHaveBeenCalled();
    });

    it('identifies the folders in move progress and completion notifications', async () => {
        const { notification } = await import('antd');
        const { result } = renderClipboard();
        const entries = Array.from({ length: 6 }, (_, i) => `source/file-${i}.txt`);
        act(() => result.current.cut(entries));

        await act(async () => { await result.current.paste('destination'); });

        expect(notification.open).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Moving 6 files from source to destination…',
            description: expect.anything(),
        }));
        expect(notification.success).toHaveBeenCalledWith({
            message: 'Moved 6 files from source to destination',
        });
    });
});
