/** Boards use stable name-derived handles, not file paths; renaming preserves bookmarks. */

/** Claims the list at this prefix and board pages below it. */
export const BOARDS_PREFIX = '/boards';

export const boardUrl = (slug: string): string => `${BOARDS_PREFIX}/${encodeURIComponent(slug)}`;

export const boardsUrl = (): string => BOARDS_PREFIX;

/** Receives the pathname after the claimed prefix; uses its first segment, or null for the list. */
export const handleOf = (rest: string): string | null => {
    const handle = decodeURIComponent(rest.split('/')[0] ?? '').trim();
    return handle === '' ? null : handle;
};

/** Pasted images live here. The stable handle prevents renames orphaning images. */
export const boardFolder = (handle: string): string => `boards/${handle}`;
