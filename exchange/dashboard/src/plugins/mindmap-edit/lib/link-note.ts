/** Building the note content for a pasted link. */

/** How long to wait for the favicon before creating the note without it. */
const FAVICON_TIMEOUT_MS = 2000;

/** Rendered size of the favicon, in pixels. */
const FAVICON_SIZE = 16;

/** The conventional favicon location for a link, or null when there is none to look for — a relative. */
export const faviconUrl = (link: string): string | null => {
    try {
        const { protocol, origin } = new URL(link);
        if (protocol !== 'http:' && protocol !== 'https:') return null;
        return `${origin}/favicon.ico`;
    } catch {
        return null; // not absolute: ./foo.md, /bar.md, …
    }
};

/** Resolve to url if it loads as an image, to null otherwise. */
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

/** The markdown of a link note: the usual `[{{{Title}}}](url)`, preceded inside the link label by. */
export const linkNoteContent = (link: string, favicon: string | null): string => {
    const icon = favicon
        ? `<img src="${favicon}" alt="" width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" /> `
        : '';
    return `[${icon}{{{Title}}}](${link})`;
};
