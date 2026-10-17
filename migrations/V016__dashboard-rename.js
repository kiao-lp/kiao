/**
 * V016 — the Dashboard rename: the `quickcms*` state files become `dashboard*` ones, and the
 * `/quickcms` mount prefix pasted into markdown link destinations becomes `/dashboard`.
 *
 *     .kiao-config/quickcms.json                 ->  .kiao-config/dashboard.json
 *     .kiao-config/quickcms-view-state.json      ->  .kiao-config/dashboard-view-state.json
 *     .kiao-config/quickcms-view-state-small.json -> .kiao-config/dashboard-view-state-small.json
 *     [the framing](/quickcms/units/abc/cadre.md) ->  [the framing](/dashboard/units/abc/cadre.md)
 *
 * The application used to be served under `/quickcms/` and is now served under `/dashboard/`,
 * and its configuration documents carried the old name. A store that last ran before the rename
 * still carries both, so this converts them.
 *
 * ## What it will and will not touch
 *
 *  - The three state files above, at their known place, are renamed — contents untouched. The
 *    state directory is not content, so no `.kiao-files` rule gates this half: it is the same
 *    adoption the worker performs at startup for a state directory outside the data root, which
 *    this script cannot reach. A document already under its new name wins and the old one beside
 *    it is left for the operator, which is also what makes a second run a no-op.
 *  - In `.md` files — templates (`.temp.md`) excluded, they are code — the destinations that
 *    *render* as links to the application: inline links and images (`[text](dest)`), reference
 *    definitions (`[id]: dest`), `<autolink>` brackets, and bare `https?://` URLs, which GFM
 *    renders as links. Only the `/quickcms` prefix of the destination is rewritten, to
 *    `/dashboard`; the rest of the line is left byte-identical.
 *  - Fenced code blocks and inline code spans are never touched: a pasted stack trace or an
 *    example stays exactly as written. A bare `/quickcms` mention in prose — not a destination,
 *    not an absolute URL — is left alone for the same reason: it is a mention, not a link.
 *  - A destination that merely starts with those letters (`/quickcmsx`, `/quickcms-old`) is not
 *    the mount and is left alone: the prefix must be followed by `/`, `?`, `#` or the end of
 *    the destination. Raw HTML attributes (`<a href="…">`) are left alone: hand-written markup
 *    names store links, not the mount.
 *  - The markdown half honours `.kiao-files` like every migration: a file the store declares
 *    out of bounds for `[migration]` keeps its links.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan } = require('./lib/kiao-fs');

const STATE_DIR = '.kiao-config';

const STATE_RENAMES = [
    ['quickcms.json', 'dashboard.json'],
    ['quickcms-view-state.json', 'dashboard-view-state.json'],
    ['quickcms-view-state-small.json', 'dashboard-view-state-small.json'],
];

const OLD_MOUNT = '/quickcms';
const NEW_MOUNT = '/dashboard';

/**
 * Character ranges covered by fenced code blocks, where a `#` line is code, not a heading —
 * kept identical to V015's reading, which is kept identical to the markdown renderer.
 */
function fenceRanges(text) {
    const ranges = [];
    const fence = /^(?: {0,3})(```|~~~).*$/gm;
    let open = null;
    let match;
    while ((match = fence.exec(text)) !== null) {
        if (open === null) open = match.index;
        else {
            ranges.push([open, match.index + match[0].length]);
            open = null;
        }
    }
    // An unclosed fence runs to the end of the file, as a markdown renderer would read it.
    if (open !== null) ranges.push([open, text.length]);
    return ranges;
}

/** Character ranges covered by inline code spans: a run of backticks to its closing run. */
function inlineCodeRanges(text) {
    const ranges = [];
    const span = /(`+)[\s\S]*?\1/g;
    let match;
    while ((match = span.exec(text)) !== null) {
        ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
}

const isInside = (index, ranges) =>
    ranges.some(([start, end]) => index >= start && index < end);

/**
 * The offset of the old mount prefix inside a link destination, or -1. A destination is either
 * path-absolute (`/quickcms/a.md`) or an absolute URL (`https://host/quickcms/a.md`); in both
 * cases the prefix must be followed by `/`, `?`, `#`, `)` or the end, so `/quickcmsx` and
 * `/quickcms-old` are never matched.
 */
function mountOffset(dest) {
    let m = dest.match(/^\/quickcms(?=[/?#)]|$)/);
    if (m) return 0;
    m = dest.match(/^https?:\/\/[^/\s<>]+(\/quickcms)(?=[/?#)]|$)/);
    return m ? m[0].indexOf('/quickcms') : -1;
}

/**
 * The destination starting at `openEnd` — the offset just past `](` (or `]:`) and its
 * whitespace — as [start, end]. A bare destination runs to whitespace or the closing paren,
 * with one level of balanced parens allowed as CommonMark does; a `<…>` one to its bracket.
 * What follows on the line must then be an optional title and, for an inline link, the closing
 * paren — otherwise this is not a link and it comes back null.
 */
function linkDestination(text, openEnd, paren) {
    let start = openEnd;
    let end;
    let tailStart;
    if (text[start] === '<') {
        end = text.indexOf('>', start + 1);
        if (end === -1) return null;
        start += 1;
        tailStart = end + 1;
    } else {
        let i = start;
        let depth = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === '\\') { i += 2; continue; }
            if (ch === '(') { depth++; i++; continue; }
            if (ch === ')') {
                if (depth === 0) break;
                depth--; i++; continue;
            }
            if (/\s/.test(ch)) break;
            i++;
        }
        end = i;
        tailStart = end;
    }
    if (end <= start) return null;
    const eol = text.indexOf('\n', tailStart);
    const tail = text.slice(tailStart, eol === -1 ? text.length : eol);
    const tailOk = paren
        ? /^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?\s*\)/.test(tail)
        : /^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?\s*$/.test(tail);
    if (!tailOk) return null;
    return [start, end];
}

/** Edits for one markdown document: [offset, length, replacement] triples, deduplicated. */
function linkEdits(text) {
    const masked = [...fenceRanges(text), ...inlineCodeRanges(text)];
    const edits = new Map();

    const consider = (destStart, destEnd) => {
        if (isInside(destStart, masked)) return;
        const at = mountOffset(text.slice(destStart, destEnd));
        if (at === -1) return;
        edits.set(destStart + at, [destStart + at, OLD_MOUNT.length, NEW_MOUNT]);
    };

    // Inline links and images: [text](dest "title").
    const inline = /!?\[[^\]\n]*\]\(\s*/g;
    let m;
    while ((m = inline.exec(text)) !== null) {
        if (isInside(m.index, masked)) continue;
        const dest = linkDestination(text, m.index + m[0].length, true);
        if (dest) consider(dest[0], dest[1]);
    }

    // Reference definitions: [id]: dest "title".
    const refdef = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*/gm;
    while ((m = refdef.exec(text)) !== null) {
        if (isInside(m.index, masked)) continue;
        const dest = linkDestination(text, m.index + m[0].length, false);
        if (dest) consider(dest[0], dest[1]);
    }

    // <autolinks>: absolute URLs and path-absolute destinations in brackets.
    const autolink = /<(https?:\/\/[^<>\s]+|\/[^<>\s]*)>/g;
    while ((m = autolink.exec(text)) !== null) {
        consider(m.index + 1, m.index + 1 + m[1].length);
    }

    // Bare absolute URLs, which GFM renders as links. A URL already handled above produces
    // the identical edit and is deduplicated by offset.
    const bare = /https?:\/\/[^/\s<>()"']*\/quickcms(?=[/?#\s)>"'`.,;!]|$)/g;
    while ((m = bare.exec(text)) !== null) {
        const at = m[0].lastIndexOf(OLD_MOUNT);
        if (!isInside(m.index + at, masked)) {
            edits.set(m.index + at, [m.index + at, OLD_MOUNT.length, NEW_MOUNT]);
        }
    }

    return [...edits.values()];
}

function rewriteText(text) {
    const edits = linkEdits(text);
    if (edits.length === 0) return null;
    edits.sort(([a], [b]) => b - a);
    for (const [at, length, replacement] of edits) {
        text = text.slice(0, at) + replacement + text.slice(at + length);
    }
    return text;
}

function renameStateDocs(root) {
    let renamed = 0;
    for (const [from, to] of STATE_RENAMES) {
        const src = path.join(root, STATE_DIR, from);
        if (!fs.existsSync(src)) continue;
        const dst = path.join(root, STATE_DIR, to);
        if (fs.existsSync(dst)) {
            console.log(`V016: ${from} is still beside ${to}; the current one wins, left for the operator.`);
            continue;
        }
        fs.renameSync(src, dst);
        console.log(`V016: renamed ${path.join(STATE_DIR, from)} to ${to}.`);
        renamed++;
    }
    return renamed;
}

function rewriteMarkdownLinks(root, ignore) {
    const files = scan(root, ['.md'], ignore).filter((f) => !f.endsWith('.temp.md'));
    let changed = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes(OLD_MOUNT)) continue;
        const rewritten = rewriteText(text);
        if (rewritten === null) continue;
        fs.writeFileSync(file, rewritten, 'utf8');
        console.log(`V016: rewrote ${path.relative(root, file)}`);
        changed++;
    }
    return { changed, scanned: files.length };
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V016: applying the Dashboard rename in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V016: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const renamed = renameStateDocs(root);
    const { changed, scanned } = rewriteMarkdownLinks(root, ignore);
    console.log(`V016: done — ${renamed} state file(s) renamed, ` +
        `${changed} of ${scanned} markdown file(s) rewritten.`);
}

main();
