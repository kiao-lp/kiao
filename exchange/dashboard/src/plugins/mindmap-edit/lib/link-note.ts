/**
 * Building the note content for a pasted link.
 *
 * Everything here stays in the browser. The page *name* is deliberately not fetched: reading the
 * <title> of an arbitrary site would need a cross-origin fetch, which CORS forbids (an opaque
 * `no-cors` response has no readable body), so the note keeps its `{{{Title}}}` placeholder for
 * the author to fill in. The favicon needs no fetch at all — an <img> may load cross-origin — so
 * it is guessed at the conventional /favicon.ico and kept only if it really decodes as an image.
 */

/** How long to wait for the favicon before creating the note without it. */
const FAVICON_TIMEOUT_MS = 2000;

/** Rendered size of the favicon, in pixels. Set on the tag so the note looks the same in any
 *  markdown renderer, whatever size the site serves. */
const FAVICON_SIZE = 16;

/**
 * The conventional favicon location for a link, or null when there is none to look for —
 * a relative link (a file inside the CMS) or a non-web scheme.
 */
export const faviconUrl = (link: string): string | null => {
    try {
        const { protocol, origin } = new URL(link);
        if (protocol !== 'http:' && protocol !== 'https:') return null;
        return `${origin}/favicon.ico`;
    } catch {
        return null; // not absolute: ./foo.md, /bar.md, …
    }
};

/**
 * Resolve to url if it loads as an image, to null otherwise. Loading an <img> is not subject to
 * CORS, so this works for any site — and a 404 page served in its place fails to decode, which
 * is what keeps a broken image out of the note.
 */
const loadsAsImage = (url: string): Promise<string | null> =>
    new Promise((resolve) => {
        const image = new Image();
        let settled = false;
        const settle = (result: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(result);
        };
        const timer = setTimeout(() => settle(null), FAVICON_TIMEOUT_MS);
        image.onload = () => settle(image.naturalWidth > 0 ? url : null);
        image.onerror = () => settle(null);
        image.src = url;
    });

/** The favicon of the page a link points to, or null when it has none (or is slow to answer). */
export const findFavicon = async (link: string): Promise<string | null> => {
    const url = faviconUrl(link);
    return url ? await loadsAsImage(url) : null;
};

/**
 * The markdown of a link note: the usual `[{{{Title}}}](url)`, preceded inside the link label by
 * the favicon when there is one. The icon is a raw <img> rather than `![](…)` so its size travels
 * with the content instead of depending on the renderer's stylesheet.
 */
export const linkNoteContent = (link: string, favicon: string | null): string => {
    const icon = favicon
        ? `<img src="${favicon}" alt="" width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" /> `
        : '';
    return `[${icon}{{{Title}}}](${link})`;
};
