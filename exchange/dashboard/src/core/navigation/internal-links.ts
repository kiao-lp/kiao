const basePath = (): string => import.meta.env.BASE_URL.replace(/\/+$/, '');

const hasScheme = (link: string): boolean => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link);

const isOpaque = (link: string): boolean =>
    !link || link.startsWith('#') || link.startsWith('//');

const isUnderBase = (path: string, base: string): boolean =>
    base === '' || path === base || path.startsWith(`${base}/`);

/** Return the router path with query and fragment, or null outside this origin and mount.
 * Resolve relative hrefs against the live page. Use normalizeDocumentLink when writing links. */
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

/** Normalize document link input by removing the current origin and Dashboard mount.
 * Preserve other input and keep percent-encoding because raw spaces terminate Markdown destinations. */
export const normalizeDocumentLink = (raw: string): string => {
    if (isOpaque(raw)) return raw;
    if (hasScheme(raw)) return internalPathOf(raw) ?? raw;
    if (!raw.startsWith('/')) return raw;

    const base = basePath();
    if (base === '' || !isUnderBase(raw, base)) return raw;
    return raw.slice(base.length) || '/';
};

/** Add Dashboard's mount point to a DCMS link once. Legacy hrefs already contain it,
 * so a DCMS folder named like the mount point is ambiguous. */
export const resolveInternalLink = (link: string): string => {
    if (isOpaque(link) || hasScheme(link) || !link.startsWith('/')) return link;
    const base = basePath();
    if (base === '' || isUnderBase(link, base)) return link;
    return `${base}${link}`;
};

/** encodeURIComponent leaves parentheses unescaped; they can terminate markdown destinations. */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/[()]/g, character => (character === '(' ? '%28' : '%29'));

/** Encode a file API path as a DCMS link suitable for a Markdown destination. */
export const encodedDcmsLinkOf = (path: string): string =>
    `/${path.split('/').filter(Boolean).map(encodeSegment).join('/')}`;

/** @deprecated Use normalizeDocumentLink. */
export const toStoredLink = normalizeDocumentLink;

/** @deprecated Use encodedDcmsLinkOf. */
export const storedLinkOf = encodedDcmsLinkOf;

/** Return the decoded store path without query, fragment or leading slash; null outside the app.
 * The DCMS root is the empty string. */
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
