import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/**
 * What the hook has to get right, beyond reading and debounce-saving a file:
 *  - a file that moves on disk under a clean editor is read back into it, so the store can be
 *    watched while something else writes it;
 *  - a write of its own, whose modification time moves exactly like an outside change, is not
 *    mistaken for one — including while it is still in flight;
 *  - an outside change arriving on top of unsaved edits is announced, never applied;
 *  - leaving the file flushes the write it made, onto the path it was made in.
 */

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

/** What the file holds, and when it was last written — the disk the hook is reading. */
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
        // The write lands on disk but its promise never settles, so the editor is still holding
        // text the poll has no other reason to recognise.
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

        // More typing before the poll comes round: the editor is dirty again, and the disk
        // holds our own write — not a change from elsewhere.
        act(() => { result.current.onChange('typed here and more'); });
        await tick(POLL_INTERVAL_MS);

        expect(result.current.content).toBe('typed here and more');
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('announces a change that arrives on top of unsaved edits, and keeps them', async () => {
        const { result } = await openFile();
        writeOnDisk('written by Claude');

        // Typing without a pause: the trailing debounce keeps being pushed back, so the edit is
        // on screen and not on disk for as long as it lasts — which is where the two can differ.
        for (let i = 0; i < 5; i++) {
            act(() => { result.current.onChange(`typed here ${i}`); });
            await tick(SAVE_DEBOUNCE_MS / 2);
        }

        expect(result.current.content).toBe('typed here 4');
        expect(notification.warning).toHaveBeenCalledTimes(1);
        expect(notification.warning).toHaveBeenCalledWith(expect.objectContaining({
            message: 'a.md changed on disk',
        }));

        // The typing stops, its write lands, and the file is in sync again — without the same
        // disk state being announced once per tick in the meantime.
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
