/** Store links use a leading slash from the store root, without origin or mount point.
 * Add Vite’s BASE_URL for display; router navigation takes the bare store link.
 * Links without a leading slash are document-relative and are preserved when storing/resolving. */

const basePath = (): string => import.meta.env.BASE_URL.replace(/\/+$/, '');

const hasScheme = (link: string): boolean => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link);

const isOpaque = (link: string): boolean =>
    !link || link.startsWith('#') || link.startsWith('//');

const isUnderBase = (path: string, base: string): boolean =>
    base === '' || path === base || path.startsWith(`${base}/`);

/** Return the app path with query and fragment, or null outside this origin/mount.
 * Resolves relative hrefs against the live page; use toStoredLink for user-entered text. */
export const internalPathOf = (href: string): string | null => {
    if (isOpaque(href)) return null;
    let url: URL;
    try {
        url = new URL(href, window.location.href);
    } catch {
        return null;
    }
    // blob: URLs expose their inner origin, so check the protocol too.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin !== window.location.origin) return null;

    const base = basePath();
    if (!isUnderBase(url.pathname, base)) return null;
    const path = url.pathname.slice(base.length) || '/';
    return `${path}${url.search}${url.hash}`;
};

/** Strip the current origin and mount point from internal links; preserve other input.
 * Keep percent-encoding: raw spaces terminate markdown destinations. */
export const toStoredLink = (raw: string): string => {
    if (isOpaque(raw)) return raw;
    if (hasScheme(raw)) return internalPathOf(raw) ?? raw;
    if (!raw.startsWith('/')) return raw;

    const base = basePath();
    if (base === '' || !isUnderBase(raw, base)) return raw;
    return raw.slice(base.length) || '/';
};

/** Add the mount point once, preserving legacy links that already include it.
 * A store folder named like the mount point is therefore ambiguous. */
export const resolveInternalLink = (stored: string): string => {
    if (isOpaque(stored) || hasScheme(stored) || !stored.startsWith('/')) return stored;
    const base = basePath();
    if (base === '' || isUnderBase(stored, base)) return stored;
    return `${base}${stored}`;
};

/** encodeURIComponent leaves parentheses unescaped; they can terminate markdown destinations. */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/[()]/g, character => (character === '(' ? '%28' : '%29'));

/** Encode a store path as a root-relative markdown destination. */
export const storedLinkOf = (path: string): string =>
    `/${path.split('/').filter(Boolean).map(encodeSegment).join('/')}`;

/** Return the decoded store path without query, fragment or leading slash; null outside the app.
 * The store root is the empty string. */
export const storePathOfHref = (href: string): string | null => {
    const path = internalPathOf(href);
    if (path === null) return null;
    const bare = path.split(/[?#]/)[0].replace(/^\/+/, '');
    // Keep malformed escapes literal so hand-written links can still name files.
    try {
        return decodeURIComponent(bare);
    } catch {
        return bare;
    }
};
