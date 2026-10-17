import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkerClient } from '@cms-core';
import { BookmarksProvider, useBookmarks } from './Bookmarks-ctx';
import { BOOKMARKS_PATH, bookmarksFileText } from './bookmarksFile';

// The shell is stood in for, but not the link writer: what a bookmark's link says is what
// these tests read, and it is `storedLinkOf` that writes it.
vi.mock('@cms-core', async importOriginal => ({
    useWorkerClient: vi.fn(),
    storedLinkOf: (await importOriginal<typeof import('@cms-core')>()).storedLinkOf,
}));

/** The store, as far as this test is concerned: the bookmarks file, editable from outside. */
let files: Record<string, string>;
let getFileText: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BookmarksProvider>{children}</BookmarksProvider>
);

/** The panel, looked at: the list is read on the way in, and not before. */
const opened = async () => {
    const { result } = renderHook(() => useBookmarks(), { wrapper });
    act(() => result.current.ensureLoaded());
    await waitFor(() => expect(result.current.loading).toBe(false));
    return result;
};

/** What the store ends up holding, once the debounce has let the write go. */
const written = async () => {
    await waitFor(() => expect(update).toHaveBeenCalled(), { timeout: 2000 });
    return files[BOOKMARKS_PATH];
};

const FILE = bookmarksFileText([
    { title: 'cadre.md', link: '/units/abc/cadre.md', note: 'the one to copy from.' },
]);

const THREE = bookmarksFileText([
    { title: 'A', link: '/a.md', note: '' },
    { title: 'B', link: '/b.md', note: '' },
    { title: 'C', link: '/c.md', note: '' },
]);

beforeEach(() => {
    files = { [BOOKMARKS_PATH]: FILE };
    getFileText = vi.fn(async (path: string) => {
        if (files[path] === undefined) throw new Error('404');
        return files[path];
    });
    update = vi.fn(async (path: string, content: string) => { files[path] = content; });
    vi.mocked(useWorkerClient).mockReturnValue({ getFileText, update } as any);
});

describe('Bookmarks', () => {
    it('reads the file the store keeps', async () => {
        const result = await opened();
        expect(result.current.bookmarks.map(b => b.title)).toEqual(['cadre.md']);
    });

    // A store that has never bookmarked anything has no file, and that is the empty list rather
    // than an error to report.
    it('starts empty where there is no file, and the first bookmark writes one', async () => {
        delete files[BOOKMARKS_PATH];
        const result = await opened();
        expect(result.current.bookmarks).toEqual([]);

        act(() => result.current.add('units/abc/cadre.md', 'cadre.md'));
        expect(await written()).toBe(bookmarksFileText([
            { title: 'cadre.md', link: '/units/abc/cadre.md', note: '' },
        ]));
    });

    it('adds a bookmark at the end of the list and says where it landed', async () => {
        const result = await opened();
        let at = -1;
        act(() => { at = result.current.add('backlog/board/05 Ready.tasks.md', '05 Ready.tasks.md'); });

        expect(at).toBe(1);
        expect(await written()).toBe(bookmarksFileText([
            { title: 'cadre.md', link: '/units/abc/cadre.md', note: 'the one to copy from.' },
            { title: '05 Ready.tasks.md', link: '/backlog/board/05%20Ready.tasks.md', note: '' },
        ]));
    });

    // The panel writes on every keystroke; the store hears about it once.
    it('writes what is typed once the typing stops', async () => {
        const result = await opened();
        act(() => result.current.update(0, { note: 'now' }));
        act(() => result.current.update(0, { note: 'now with a note.' }));

        expect(update).not.toHaveBeenCalled();
        expect(await written()).toBe(bookmarksFileText([
            { title: 'cadre.md', link: '/units/abc/cadre.md', note: 'now with a note.' },
        ]));
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('changes only the fields it is given', async () => {
        const result = await opened();
        act(() => result.current.update(0, { title: 'The framing' }));

        expect(result.current.bookmarks[0]).toEqual({
            title: 'The framing',
            link: '/units/abc/cadre.md',
            note: 'the one to copy from.',
        });
    });

    it('takes a bookmark out of the file', async () => {
        const result = await opened();
        act(() => result.current.remove(0));

        expect(result.current.bookmarks).toEqual([]);
        expect(await written()).toBe('[]\n');
    });

    // The order of the list is the order of the entries: a drop is a rewrite of the file.
    it('moves a bookmark to the rank it is dropped at', async () => {
        files[BOOKMARKS_PATH] = THREE;
        const result = await opened();
        act(() => result.current.move(2, 0));

        expect(result.current.bookmarks.map(b => b.title)).toEqual(['C', 'A', 'B']);
        expect(await written()).toBe(bookmarksFileText([
            { title: 'C', link: '/c.md', note: '' },
            { title: 'A', link: '/a.md', note: '' },
            { title: 'B', link: '/b.md', note: '' },
        ]));
    });

    it('does nothing for a rank that is not there, nor for a drop where it started', async () => {
        const result = await opened();
        act(() => result.current.move(0, 3));
        act(() => result.current.move(0, 0));
        act(() => result.current.update(3, { note: 'nowhere' }));
        act(() => result.current.remove(3));

        await act(async () => { await Promise.resolve(); });
        expect(update).not.toHaveBeenCalled();
    });

    // The file is the store's, and one click away as JSON: what was written there wins.
    it('reads the file again when asked, sending what it owes first', async () => {
        const result = await opened();
        act(() => result.current.update(0, { note: 'not yet written' }));
        act(() => result.current.reload());

        await waitFor(() => expect(result.current.bookmarks[0].note).toBe('not yet written'));
        expect(result.current.loading).toBe(false);
        expect(getFileText).toHaveBeenCalledTimes(2);
    });

    // A tab never opened is a file never read: the panel is mounted with every main view, and a
    // read on mount would cost the store one per page load for a list nobody asked for.
    it('reads nothing until the panel is looked at', async () => {
        const { result } = renderHook(() => useBookmarks(), { wrapper });
        await act(async () => { await Promise.resolve(); });
        expect(getFileText).not.toHaveBeenCalled();

        act(() => result.current.ensureLoaded());
        await waitFor(() => expect(getFileText).toHaveBeenCalledTimes(1));

        // And once it has been, being looked at again is not a second read.
        act(() => result.current.ensureLoaded());
        await act(async () => { await Promise.resolve(); });
        expect(getFileText).toHaveBeenCalledTimes(1);
    });

    it('sends the last keystrokes on the way out', async () => {
        const { result, unmount } = renderHook(() => useBookmarks(), { wrapper });
        act(() => result.current.ensureLoaded());
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.update(0, { note: 'typed last' }));
        unmount();

        expect(update).toHaveBeenCalledWith(BOOKMARKS_PATH, bookmarksFileText([
            { title: 'cadre.md', link: '/units/abc/cadre.md', note: 'typed last' },
        ]));
    });
});
