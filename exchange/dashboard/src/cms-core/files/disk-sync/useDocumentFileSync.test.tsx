import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/**
 * The codec layer over the machinery `useTextFileSync.test.tsx` pins down (that suite runs the
 * same code under the identity codec). What is specific to a *document*:
 *  - the text is delivered as it is on disk, the document as its parse — or null when there is
 *    none, at open and at reload alike;
 *  - a structural edit writes its serialization; a source edit writes the text as typed, even
 *    while it does not parse, and the last document the text held stays on screen meanwhile;
 *  - a late read is dropped when the reader has already moved to another file.
 */

const client = vi.hoisted(() => ({
    getFileMetadata: vi.fn<(path: string) => Promise<{ lastModified: number } | null>>(),
    getFileText: vi.fn<(path: string) => Promise<string>>(),
    update: vi.fn<(path: string, content: string) => Promise<void>>(),
}));
const notification = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('../service/ui', () => ({ useWorkerClient: () => client }));
vi.mock('antd', () => ({ notification }));

import { useDocumentFileSync, DocumentCodec } from './useDocumentFileSync';

const SAVE_DEBOUNCE_MS = 1000;
const POLL_INTERVAL_MS = 2000;

interface Numbers { values: number[] }

/** JSON with a shape check: enough of a real codec to have texts that refuse to parse. */
const CODEC: DocumentCodec<Numbers> = {
    parse: (text) => {
        const raw = JSON.parse(text) as Numbers;
        if (!Array.isArray(raw.values)) throw new Error('not a Numbers document');
        return { values: raw.values };
    },
    serialize: (doc) => JSON.stringify(doc, null, 2),
};

/** What the file holds, and when it was last written — the disk the hook is reading. */
const disk = { text: '', at: 0 };

const writeOnDisk = (text: string) => {
    disk.text = text;
    disk.at += 1000;
};

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const openFile = async (path = 'sim/a.doc.json') => {
    const rendered = renderHook(({ p }: { p: string | undefined }) => useDocumentFileSync(p, CODEC), {
        initialProps: { p: path as string | undefined },
    });
    await act(async () => { await Promise.resolve(); });
    return rendered;
};

describe('useDocumentFileSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        disk.text = '{"values":[1]}';
        disk.at = 1000;
        client.getFileMetadata.mockImplementation(async () => ({ lastModified: disk.at }));
        client.getFileText.mockImplementation(async () => disk.text);
        client.update.mockImplementation(async (path, content) => { writeOnDisk(content); });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('opens the file as the document its text holds, and keeps the text as it came', async () => {
        const { result } = await openFile();

        expect(result.current.loading).toBe(false);
        expect(result.current.doc).toEqual({ values: [1] });
        expect(result.current.text).toBe('{"values":[1]}');
    });

    it('opens a text that holds no document as text alone', async () => {
        disk.text = 'not a document';
        const { result } = await openFile();

        expect(result.current.doc).toBeNull();
        expect(result.current.text).toBe('not a document');
    });

    // A sidecar nothing has been written into yet is not there at all. `/info` says so, and the
    // text is not asked for — that request could only fail — and the first edit creates the file.
    it('opens a file the store does not hold as empty, and creates it with the first edit', async () => {
        client.getFileMetadata.mockResolvedValue(null);
        const { result } = await openFile('sim/new.doc.json');

        expect(client.getFileText).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
        expect(result.current.text).toBe('');

        act(() => { result.current.onDocChange({ values: [3] }); });
        await tick(SAVE_DEBOUNCE_MS);
        expect(client.update).toHaveBeenCalledWith('sim/new.doc.json', CODEC.serialize({ values: [3] }));
    });

    it('writes a structural edit as its serialization, after the debounce', async () => {
        const { result } = await openFile();

        act(() => { result.current.onDocChange({ values: [1, 2] }); });
        expect(result.current.text).toBe(CODEC.serialize({ values: [1, 2] }));
        await tick(SAVE_DEBOUNCE_MS);
        expect(client.update).toHaveBeenCalledWith('sim/a.doc.json', CODEC.serialize({ values: [1, 2] }));

        // Its own write landing is not read back as a change.
        await tick(POLL_INTERVAL_MS * 2);
        expect(result.current.doc).toEqual({ values: [1, 2] });
        expect(notification.warning).not.toHaveBeenCalled();
    });

    it('keeps the last document while a source edit does not parse, and still writes the text as typed', async () => {
        const { result } = await openFile();

        act(() => { result.current.onTextChange('{"values":[1,'); });
        expect(result.current.doc).toEqual({ values: [1] });
        expect(result.current.text).toBe('{"values":[1,');

        await tick(SAVE_DEBOUNCE_MS);
        expect(client.update).toHaveBeenCalledWith('sim/a.doc.json', '{"values":[1,');

        act(() => { result.current.onTextChange('{"values":[1,3]}'); });
        expect(result.current.doc).toEqual({ values: [1, 3] });
    });

    it('follows a disk change into the document, and drops the document when the new text holds none', async () => {
        const { result } = await openFile();

        writeOnDisk('{"values":[7]}');
        await tick(POLL_INTERVAL_MS);
        expect(result.current.doc).toEqual({ values: [7] });

        // Reload behaves like open: the file is the truth, and it says "not a document".
        writeOnDisk('broken');
        await tick(POLL_INTERVAL_MS);
        expect(result.current.doc).toBeNull();
        expect(result.current.text).toBe('broken');
    });

    it('announces a change that arrives on top of an unsaved edit, and keeps the edit', async () => {
        const { result } = await openFile();
        writeOnDisk('{"values":[9]}');

        // Editing without a pause: the trailing debounce keeps being pushed back, so the edit is
        // on screen and not on disk for as long as it lasts — which is where the two can differ.
        for (let i = 0; i < 5; i++) {
            act(() => { result.current.onDocChange({ values: [1, i] }); });
            await tick(SAVE_DEBOUNCE_MS / 2);
        }

        expect(result.current.doc).toEqual({ values: [1, 4] });
        expect(notification.warning).toHaveBeenCalledTimes(1);
    });

    /**
     * The fourth outcome, for a document written from both ends at once — a board being
     * played is the one that needs it. The two writers touch fields of their own, so what arrives
     * is put together with what is on screen instead of one of them being announced and dropped.
     */
    describe('a document with a second writer of its own', () => {
        interface Note { title: string; log: string }

        /** The title is only ever typed here; the log is only ever appended there. */
        const MERGING: DocumentCodec<Note> = {
            parse: (text) => {
                const raw = JSON.parse(text) as Note;
                if (typeof raw.title !== 'string' || typeof raw.log !== 'string') {
                    throw new Error('not a Note document');
                }
                return { title: raw.title, log: raw.log };
            },
            serialize: (doc) => JSON.stringify(doc, null, 2),
            merge: (base, ours, theirs) => ({
                title: ours.title === base.title ? theirs.title : ours.title,
                log: ours.log === base.log ? theirs.log : ours.log,
            }),
        };

        const note = (title: string, log: string) => MERGING.serialize({ title, log });

        const openNote = async (path = 'sim/a.note.json') => {
            const rendered = renderHook(() => useDocumentFileSync(path, MERGING));
            await act(async () => { await Promise.resolve(); });
            return rendered;
        };

        const lastWrite = () => client.update.mock.calls.at(-1)?.[1];

        beforeEach(() => { disk.text = note('typed', ''); });

        it('puts the arrival together with the edit on screen, and writes the two back', async () => {
            const { result } = await openNote();

            act(() => { result.current.onDocChange({ title: 'typed again', log: '' }); });
            writeOnDisk(note('typed', 'answered'));
            await tick(SAVE_DEBOUNCE_MS);

            expect(result.current.doc).toEqual({ title: 'typed again', log: 'answered' });
            expect(lastWrite()).toBe(note('typed again', 'answered'));
            // Merged rather than announced: nothing was left for the writer to lose.
            expect(notification.warning).not.toHaveBeenCalled();
        });

        /**
         * The write and the poll look at the file at the same moment, and only one of them finds
         * anything: whichever gets there first merges and moves the modification time, so the
         * other's check comes back with nothing to do. What goes out has to be what the editor
         * holds *now* — the text the write was scheduled with is the one from before the merge, and
         * writing it puts the un-merged document on the file and takes the other writer's log off
         * it.
         */
        it('carries a merge another check made while the write was on its way out', async () => {
            const { result } = await openNote();

            act(() => { result.current.onDocChange({ title: 'typed again', log: '' }); });
            writeOnDisk(note('typed', 'answered'));

            // The write goes first and is held inside its own look at the file.
            let release: (meta: { lastModified: number }) => void = () => { };
            client.getFileMetadata.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            await tick(SAVE_DEBOUNCE_MS);
            expect(client.update).not.toHaveBeenCalled();

            // The poll comes round meanwhile, merges, and leaves the modification time looked at.
            await tick(POLL_INTERVAL_MS - SAVE_DEBOUNCE_MS);
            expect(result.current.doc).toEqual({ title: 'typed again', log: 'answered' });

            // The held write now finds a file that has not moved since — and must still write the
            // merge rather than the text it set out with.
            await act(async () => {
                release({ lastModified: disk.at });
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(lastWrite()).toBe(note('typed again', 'answered'));
            expect(MERGING.parse(disk.text)).toEqual({ title: 'typed again', log: 'answered' });
        });
    });

    it('drops a read that lands after the reader has moved to another file', async () => {
        // The first file answers only after the second is already open: the late text must not
        // land in — and then be saved onto — the file that replaced it.
        let releaseA: (text: string) => void = () => { };
        client.getFileText.mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }));

        const { result, rerender } = await openFile('sim/a.doc.json');
        await act(async () => { rerender({ p: 'sim/b.doc.json' }); });
        expect(result.current.doc).toEqual({ values: [1] });

        act(() => { releaseA('{"values":[666]}'); });
        await act(async () => { await Promise.resolve(); });

        expect(result.current.doc).toEqual({ values: [1] });
        expect(result.current.text).toBe('{"values":[1]}');
    });
});
