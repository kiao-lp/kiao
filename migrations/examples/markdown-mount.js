// Pure source example; no store traversal or migration entry point.
const OLD_MOUNT = '/quickcms';
const NEW_MOUNT = '/dashboard';

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

function mountOffset(dest) {
    let m = dest.match(/^\/quickcms(?=[/?#)]|$)/);
    if (m) return 0;
    m = dest.match(/^https?:\/\/[^/\s<>]+(\/quickcms)(?=[/?#)]|$)/);
    return m ? m[0].indexOf('/quickcms') : -1;
}

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

module.exports = { rewriteText };
