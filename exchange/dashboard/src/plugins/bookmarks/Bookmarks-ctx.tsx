import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import { useWorkerClient } from '@kiao-dashboard-core';
import { moveInArray } from '@kiao-dashboard-kit/reorder';
import {
    BOOKMARKS_PATH, Bookmark, bookmarksFileText, linkOfPath, newBookmark, readBookmarks,
} from './bookmarksFile';

export type BookmarkPatch = Partial<Pick<Bookmark, 'title' | 'link' | 'note'>>;

interface BookmarksValue {
    bookmarks: Bookmark[];
    /** Until the first read completes. */
    loading: boolean;
    /** Returns the index added at. */
    add: (path: string, title: string) => number;
    update: (index: number, patch: BookmarkPatch) => void;
    remove: (index: number) => void;
    /** List order is file order. */
    move: (from: number, to: number) => void;
    /** Reads once; repeated calls do not re-read. */
    ensureLoaded: () => void;
    /** Re-reads; the file may be edited outside the panel. */
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
 * Owns the bookmarks file for the app lifetime; panel-owned state would be lost on remount.
 * Reads lazily and on `reload()`; pending writes flush before a read.
 */
export const BookmarksProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();

    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [loading, setLoading] = useState(true);

    // A read must not overtake an in-flight write.
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

    const flushNow = useCallback(() => {
        scheduleSave.cancel();
        flush();
        return saving.current;
    }, [flush, scheduleSave]);

    // No save button: flush pending writes on unmount and `beforeunload`.
    useEffect(() => {
        const onBeforeUnload = () => flushNow();
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            flushNow();
        };
    }, [flushNow]);

    // Null until first shown; an unshown tab must not read.
    const [readId, setReadId] = useState<number | null>(null);
    const ensureLoaded = useCallback(() => setReadId(id => id ?? 0), []);
    const reload = useCallback(() => setReadId(id => (id ?? 0) + 1), []);

    useEffect(() => {
        if (readId === null) return;
        let cancelled = false;
        setLoading(true);
        // A missing file is an empty list; the first bookmark creates it.
        flushNow()
            .then(() => client.getFileText(BOOKMARKS_PATH).catch(() => ''))
            .then(content => {
                if (cancelled) return;
                setBookmarks(readBookmarks(parse(content)));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [client, readId, flushNow]);

    // Handlers read the current list, not a stale closure.
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

/** Invalid JSON reads as no bookmarks. */
const parse = (content: string): unknown => {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
};
