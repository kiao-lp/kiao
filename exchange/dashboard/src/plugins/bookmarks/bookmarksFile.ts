/**
 * Stored as an ordered JSON array of { title, link, note }, without IDs or categories.
 * Internal links start at the store root with `/`; notes are markdown.
 * A missing file means an empty list; the first bookmark creates it.
 */

import { storedLinkOf } from '@cms-core';

export const BOOKMARKS_PATH = 'kiao-user-config/bookmarks.json';

export interface Bookmark {
    title: string;
    link: string;
    note: string;
}

/** Tolerate hand-written files: discard non-objects and keep malformed fields editable as empty strings. */
export const readBookmarks = (raw: unknown): Bookmark[] => {
    if (!Array.isArray(raw)) return [];
    const bookmarks: Bookmark[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const source = entry as Record<string, unknown>;
        bookmarks.push({
            title: typeof source.title === 'string' ? source.title : '',
            link: typeof source.link === 'string' ? source.link : '',
            note: typeof source.note === 'string' ? source.note : '',
        });
    }
    return bookmarks;
};

export const writeBookmarks = (bookmarks: Bookmark[]): unknown =>
    bookmarks.map(bookmark => ({ title: bookmark.title, link: bookmark.link, note: bookmark.note }));

export const bookmarksFileText = (bookmarks: Bookmark[]): string =>
    `${JSON.stringify(writeBookmarks(bookmarks), null, 2)}\n`;

export const newBookmark = (title: string, link: string): Bookmark => ({ title, link, note: '' });

export const linkOfPath = storedLinkOf;

/** Resolve store links only; query and fragment do not affect document identity. */
export const pathOfLink = (link: string): string | null => {
    const target = link.split(/[?#]/)[0];
    if (!target.startsWith('/')) return null;
    const decoded = ((): string => {
        try {
            return decodeURIComponent(target);
        } catch {
            // Preserve literal text when percent encoding is malformed.
            return target;
        }
    })();
    return decoded.replace(/^\/+|\/+$/g, '');
};

/** Returns the first matching bookmark, or -1. */
export const indexOfPath = (bookmarks: Bookmark[], path: string): number => {
    const wanted = path.replace(/^\/+|\/+$/g, '');
    return bookmarks.findIndex(bookmark => pathOfLink(bookmark.link) === wanted);
};
