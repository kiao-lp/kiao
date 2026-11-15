import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Document codec cases; shared sync machinery is covered via useTextFileSync.

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

const CODEC: DocumentCodec<Numbers> = {
    parse: (text) => {
        const raw = JSON.parse(text) as Numbers;
        if (!Array.isArray(raw.values)) throw new Error('not a Numbers document');
        return { values: raw.values };
    },
    serialize: (doc) => JSON.stringify(doc, null, 2),
};

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

    // Missing file: metadata is null, text is not read, first edit creates it.
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

        // Reload matches open: unparseable text gives a null document.
        writeOnDisk('broken');
        await tick(POLL_INTERVAL_MS);
        expect(result.current.doc).toBeNull();
        expect(result.current.text).toBe('broken');
    });

    it('announces a change that arrives on top of an unsaved edit, and keeps the edit', async () => {
        const { result } = await openFile();
        writeOnDisk('{"values":[9]}');

        // Continuous typing keeps resetting the debounce, so the edit stays unsaved.
        for (let i = 0; i < 5; i++) {
            act(() => { result.current.onDocChange({ values: [1, i] }); });
            await tick(SAVE_DEBOUNCE_MS / 2);
        }

        expect(result.current.doc).toEqual({ values: [1, 4] });
        expect(notification.warning).toHaveBeenCalledTimes(1);
    });

    // Merge: disjoint field edits are combined instead of reported as a conflict.
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
            // Merged input gives no conflict warning.
            expect(notification.warning).not.toHaveBeenCalled();
        });

        // Write must send current text after a concurrent poll merges, not stale scheduled text.
        it('carries a merge another check made while the write was on its way out', async () => {
            const { result } = await openNote();

            act(() => { result.current.onDocChange({ title: 'typed again', log: '' }); });
            writeOnDisk(note('typed', 'answered'));

            let release: (meta: { lastModified: number }) => void = () => { };
            client.getFileMetadata.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            await tick(SAVE_DEBOUNCE_MS);
            expect(client.update).not.toHaveBeenCalled();

            await tick(POLL_INTERVAL_MS - SAVE_DEBOUNCE_MS);
            expect(result.current.doc).toEqual({ title: 'typed again', log: 'answered' });

            // Held write must send the merge, not its stale scheduled text.
            await act(async () => {
                release({ lastModified: disk.at });
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(lastWrite()).toBe(note('typed again', 'answered'));
            expect(MERGING.parse(disk.text)).toEqual({ title: 'typed again', log: 'answered' });
        });
    });

    it('drops a read that lands after the reader has moved to another file', async () => {
        // Late read for the previous file must not land in the current file.
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
