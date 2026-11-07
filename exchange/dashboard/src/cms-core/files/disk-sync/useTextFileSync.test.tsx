import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Sync cases: reload, own-write detection, conflict warning, flush on leave.

const client = vi.hoisted(() => ({
    getFileMetadata: vi.fn<(path: string) => Promise<{ lastModified: number } | null>>(),
    getFileText: vi.fn<(path: string) => Promise<string>>(),
    update: vi.fn<(path: string, content: string) => Promise<void>>(),
}));
const notification = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('../service/ui', () => ({ useWorkerClient: () => client }));
vi.mock('antd', () => ({ notification }));

import { useTextFileSync } from './useTextFileSync';

const SAVE_DEBOUNCE_MS = 1000;
const POLL_INTERVAL_MS = 2000;

const disk = { text: '', at: 0 };

const writeOnDisk = (text: string) => {
    disk.text = text;
    disk.at += 1000;
};

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const openFile = async (path = 'notes/a.md') => {
    const rendered = renderHook(({ p }: { p: string | undefined }) => useTextFileSync(p), {
        initialProps: { p: path as string | undefined },
    });
    await act(async () => { await Promise.resolve(); });
    return rendered;
};

describe('useTextFileSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        disk.text = 'as opened';
        disk.at = 1000;
        client.getFileMetadata.mockImplementation(async () => ({ lastModified: disk.at }));
        client.getFileText.mockImplementation(async () => disk.text);
        client.update.mockImplementation(async (path, content) => { writeOnDisk(content); });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reads the file, then follows a change made to it elsewhere', async () => {
        const { result } = await openFile();
        expect(result.current.loading).toBe(false);
        expect(result.current.content).toBe('as opened');

        writeOnDisk('written by Claude');
        await tick(POLL_INTERVAL_MS);

        expect(result.current.content).toBe('written by Claude');
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('reads the modification time before the text, so a write between the two is not missed', async () => {
        const calls: string[] = [];
        client.getFileMetadata.mockImplementation(async () => { calls.push('meta'); return { lastModified: disk.at }; });
        client.getFileText.mockImplementation(async () => { calls.push('text'); return disk.text; });

        await openFile();

        expect(calls).toEqual(['meta', 'text']);
    });

    it('leaves the file alone when its modification time has not moved', async () => {
        const { result } = await openFile();
        client.getFileText.mockClear();

        await tick(POLL_INTERVAL_MS * 3);

        expect(client.getFileText).not.toHaveBeenCalled();
        expect(result.current.content).toBe('as opened');
    });

    it('saves an edit after the debounce, and does not read its own write back as a change', async () => {
        const { result } = await openFile();

        act(() => { result.current.onChange('typed here'); });
        await tick(SAVE_DEBOUNCE_MS);
        expect(client.update).toHaveBeenCalledWith('notes/a.md', 'typed here');

        await tick(POLL_INTERVAL_MS * 2);

        expect(result.current.content).toBe('typed here');
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('does not mistake a write still in flight for a change made elsewhere', async () => {
        // Write lands on disk but never settles; poll must still treat it as own write.
        client.update.mockImplementation((path, content) => {
            writeOnDisk(content);
            return new Promise<void>(() => { });
        });
        const { result } = await openFile();

        act(() => { result.current.onChange('typed here'); });
        await tick(SAVE_DEBOUNCE_MS);
        await tick(POLL_INTERVAL_MS);

        expect(result.current.content).toBe('typed here');
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('does not announce its own write landing while further edits are unsaved', async () => {
        const { result } = await openFile();

        act(() => { result.current.onChange('typed here'); });
        await tick(SAVE_DEBOUNCE_MS);
        expect(client.update).toHaveBeenCalledWith('notes/a.md', 'typed here');

        // Disk holds own write while the editor is dirty again; not an external change.
        act(() => { result.current.onChange('typed here and more'); });
        await tick(POLL_INTERVAL_MS);

        expect(result.current.content).toBe('typed here and more');
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('announces a change that arrives on top of unsaved edits, and keeps them', async () => {
        const { result } = await openFile();
        writeOnDisk('written by Claude');

        // Continuous typing keeps resetting the debounce, so the edit stays unsaved.
        for (let i = 0; i < 5; i++) {
            act(() => { result.current.onChange(`typed here ${i}`); });
            await tick(SAVE_DEBOUNCE_MS / 2);
        }

        expect(result.current.content).toBe('typed here 4');
        expect(notification.warning).toHaveBeenCalledTimes(1);
        expect(notification.warning).toHaveBeenCalledWith(expect.objectContaining({
            message: 'a.md changed on disk',
        }));

        // After the write lands, the same disk state must not warn again.
        await tick(SAVE_DEBOUNCE_MS + POLL_INTERVAL_MS * 2);
        expect(notification.warning).toHaveBeenCalledTimes(1);
        expect(result.current.content).toBe('typed here 4');
    });

    it('flushes a pending write onto the file it was made in when another is opened', async () => {
        const { result, rerender } = await openFile('notes/a.md');

        act(() => { result.current.onChange('typed here'); });
        await act(async () => { rerender({ p: 'notes/b.md' }); });

        expect(client.update).toHaveBeenCalledWith('notes/a.md', 'typed here');
    });

    it('stops reading the file once the editor is gone', async () => {
        const { unmount } = await openFile();
        unmount();
        client.getFileMetadata.mockClear();

        await tick(POLL_INTERVAL_MS * 3);

        expect(client.getFileMetadata).not.toHaveBeenCalled();
    });
});
