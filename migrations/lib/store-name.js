/**
 * Keep naming compatible with toStoreName in reference/kiao-worker/src/utils.ts.
 * Migrations run without its dependency tree; both suites use test/store-name-corpus.json.
 * Change the shared cases first when changing the rule.
 */

// Reject Windows-forbidden characters, linkfix path-token delimiter `:`, URL fragment `#`,
// and control characters.
const FORBIDDEN_IN_NAME = /[:*?"<>|#\u0000-\u001F\u007F]/g;

const PATH_SEPARATORS = /[/\\]/g;

// Windows reserves device names even with extensions, e.g. LPT1.txt.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Leave room for an extension and a ` (docId)` suffix.
const MAX_NAME_BYTES = 180;

const byteLengthOf = (s) => Buffer.byteLength(s, 'utf8');

/** Truncate UTF-8 bytes without splitting a character. */
function truncateToBytes(s, max) {
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
}

// Avoid hidden names and Windows-incompatible trailing dots or whitespace.
const trimNameEnds = (s) => s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');

/** Sanitize a title for a store path; return fallback if empty or a reserved device name. */
function toStoreName(title, fallback = '') {
    const cleaned = trimNameEnds(
        String(title ?? '')
            .normalize('NFC')
            .replace(PATH_SEPARATORS, '-')
            .replace(FORBIDDEN_IN_NAME, '')
            .replace(/\s+/g, ' '));
    const capped = trimNameEnds(truncateToBytes(cleaned, MAX_NAME_BYTES));
    if (capped === '' || WINDOWS_DEVICE.test(capped.split('.')[0])) return fallback;
    return capped;
}

module.exports = { MAX_NAME_BYTES, toStoreName };
