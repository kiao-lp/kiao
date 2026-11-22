
/** Accepts paths with or without leading/trailing slashes. */
export const extractName = (path: string): string => {
    if (!path) return "";
    const cleanPath = (path.length > 1 && path.endsWith('/')) ? path.slice(0, -1) : path;
    const parts = cleanPath.split('/');
    return parts.pop() || "";
}

/** Quote data-derived search terms to preserve exact case, spaces and literal leading negation signs. */
export const quoteSearchTerm = (term: string): string =>
    `"${term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Windows-invalid names; colon also delimits link-fixer tokens, and # opens URL fragments. */
const FORBIDDEN_IN_NAME = /[:*?"<>|#\u0000-\u001F\u007F]/g;

const PATH_SEPARATORS = /[/\\]/g;

/** Windows reserves these even with an extension. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** UTF-8 bytes; leaves room below filesystem limits for extensions and appended docIds. */
const MAX_NAME_BYTES = 180;

const byteLengthOf = (s: string): number => new TextEncoder().encode(s).length;

/** UTF-8 byte limit; never split a character. */
const truncateToBytes = (s: string, max: number): string => {
    if (byteLengthOf(s) <= max) return s;
    let out = '';
    let bytes = 0;
    for (const rune of s) {
        const size = byteLengthOf(rune);
        if (bytes + size > max) break;
        out += rune;
        bytes += size;
    }
    return out;
};

/** Leading dots hide documents from store passes; Windows silently drops trailing dots/spaces. */
const trimNameEnds = (s: string): string => s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');

/** Preserve readable Unicode titles; replace separators with hyphens. Fallback is returned verbatim and must be path-safe. */
export const toStoreName = (title: string, fallback = ''): string => {
    const cleaned = trimNameEnds(
        (title ?? '')
            .normalize('NFC')
            .replace(PATH_SEPARATORS, '-')
            .replace(FORBIDDEN_IN_NAME, '')
            .replace(/\s+/g, ' '));
    const capped = trimNameEnds(truncateToBytes(cleaned, MAX_NAME_BYTES));
    if (capped === '' || WINDOWS_DEVICE.test(capped.split('.')[0])) return fallback;
    return capped;
};

/**
 * Stored links start with / so the link fixer can distinguish references from ordinary text.
 * Bare markdown destinations are document-relative and must not be converted here.
 * The API accepts either form but returns bare FileDto.path; convert at document boundaries.
 * Both conversions are idempotent.
 */
/** Store path to link: units/abc/cadre.md → /units/abc/cadre.md. */
export const storeLinkOf = (path: string): string => `/${path.replace(/^\/+/, '')}`;

/** Store link to path: /units/abc/cadre.md → units/abc/cadre.md; root → empty string. */
export const storePathOf = (link: string): string => link.replace(/^\/+/, '');
