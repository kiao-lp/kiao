import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import { useWorkerClient } from '@cms-core';
import { moveInArray } from '@cms-kit/reorder';
import {
    BOOKMARKS_PATH, Bookmark, bookmarksFileText, linkOfPath, newBookmark, readBookmarks,
} from './bookmarksFile';

/** The fields a bookmark is edited by: its title, where it points, and what is said about it. */
export type BookmarkPatch = Partial<Pick<Bookmark, 'title' | 'link' | 'note'>>;

interface BookmarksValue {
    bookmarks: Bookmark[];
    /** True until the first read lands; the panel has no list to draw before that. */
    loading: boolean;
    /** Bookmarks the document at `path` under `title`, and gives back the rank it lands at. */
    add: (path: string, title: string) => number;
    /** Changes the fields `patch` names on the bookmark at `index`. */
    update: (index: number, patch: BookmarkPatch) => void;
    remove: (index: number) => void;
    /** Puts the bookmark at `from` at rank `to`: the order of the list is the order of the file. */
    move: (from: number, to: number) => void;
    /** The panel is on screen and wants the list. Reads the file once; cheap to call again. */
    ensureLoaded: () => void;
    /** Reads the file again — it is an ordinary store file, and may be edited as one. */
    reload: () => void;
}

const BookmarksContext = createContext<BookmarksValue | null>(null);

export const useBookmarks = (): BookmarksValue => {
    const context = useContext(BookmarksContext);
    if (!context) throw new Error('useBookmarks must be used within a BookmarksProvider');
    return context;
};

const SAVE_DEBOUNCE_MS = 800;

/**
 * The bookmarks file, and the writes back to it.
 *
 * It is mounted for the life of the application rather than for the life of a view: the panel
 * lives in a tool bar, which every plugin main view brings up anew, so a panel-owned state would
 * be read again — and the note being typed thrown away — on the way to the very document the user
 * navigated to in order to bookmark it.
 *
 * The file is the store's, not the app's: it is committed with the rest, and can be opened and
 * edited as the JSON it is. So it is read when the panel first asks for it and whenever it
 * asks again, never on a timer and never for a panel nobody has opened, and what is owed to it
 * always leaves before a read.
 */
export const BookmarksProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();

    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [loading, setLoading] = useState(true);

    // What is waiting to be written, and the write in flight. A read must never overtake the
    // latter: it would come back with the text the write was about to replace.
    const pending = useRef<string | null>(null);
    const saving = useRef<Promise<unknown>>(Promise.resolve());

    const flush = useCallback(() => {
        const content = pending.current;
        if (content === null) return;
        pending.current = null;
        saving.current = client.update(BOOKMARKS_PATH, content)
            .catch(error => console.error('Failed to save the bookmarks', error));
    }, [client]);

    const scheduleSave = useMemo(() => debounce(flush, SAVE_DEBOUNCE_MS), [flush]);

    /** Everything owed to the store leaves now; what comes back is the promise of it landing. */
    const flushNow = useCallback(() => {
        scheduleSave.cancel();
        flush();
        return saving.current;
    }, [flush, scheduleSave]);

    // This editor has no Save button, like the rest of this CMS, so the last keystrokes have to be
    // caught on the way out — both when the panel goes away and when the tab does.
    useEffect(() => {
        const onBeforeUnload = () => flushNow();
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            flushNow();
        };
    }, [flushNow]);

    // `null` until the panel has been looked at: a bar keeps a tab rendered once it has been
    // shown, but a tab never shown must not cost the store a read on every page load.
    const [readId, setReadId] = useState<number | null>(null);
    const ensureLoaded = useCallback(() => setReadId(id => id ?? 0), []);
    const reload = useCallback(() => setReadId(id => (id ?? 0) + 1), []);

    useEffect(() => {
        if (readId === null) return;
        let cancelled = false;
        setLoading(true);
        // A store that has never bookmarked anything has no file, which is not an error — it is
        // the empty list, and the first bookmark creates the file.
        flushNow()
            .then(() => client.getFileText(BOOKMARKS_PATH).catch(() => ''))
            .then(content => {
                if (cancelled) return;
                setBookmarks(readBookmarks(parse(content)));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [client, readId, flushNow]);

    // Read by the handlers, which must see the list as it stands now rather than as it stood when
    // the callback was made.
    const held = useRef(bookmarks);
    held.current = bookmarks;

    const write = useCallback((next: Bookmark[]) => {
        held.current = next;
        setBookmarks(next);
        pending.current = bookmarksFileText(next);
        scheduleSave();
    }, [scheduleSave]);

    const add = useCallback((path: string, title: string): number => {
        const at = held.current.length;
        write([...held.current, newBookmark(title, linkOfPath(path))]);
        return at;
    }, [write]);

    const update = useCallback((index: number, patch: BookmarkPatch) => {
        if (!held.current[index]) return;
        write(held.current.map((bookmark, i) => (i === index ? { ...bookmark, ...patch } : bookmark)));
    }, [write]);

    const remove = useCallback((index: number) => {
        if (!held.current[index]) return;
        write(held.current.filter((_, i) => i !== index));
    }, [write]);

    const move = useCallback((from: number, to: number) => {
        if (!held.current[from] || !held.current[to] || from === to) return;
        write(moveInArray(held.current, from, to));
    }, [write]);

    const value = useMemo<BookmarksValue>(() => ({
        bookmarks, loading, add, update, remove, move, ensureLoaded, reload,
    }), [bookmarks, loading, add, update, remove, move, ensureLoaded, reload]);

    return <BookmarksContext.Provider value={value}>{children}</BookmarksContext.Provider>;
};

/** A file that is not JSON at all is read as no bookmarks, like every other unreadable document here. */
const parse = (content: string): unknown => {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
};
