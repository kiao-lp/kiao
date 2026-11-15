/**
 * Migration counterpart of worker's link fixer; keep their semantics compatible.
 * Only leading-slash path tokens are links; slashless Markdown links are document-relative.
 * Match raw and percent-encoded spellings (including mixed forms), preserve spelling and child
 * suffixes, and require token boundaries on both sides. Markdown destinations additionally
 * escape a replacement containing whitespace.
 */

const fs = require('fs');
const path = require('path');

/** Keep aligned with worker's KIAO_WORKER_LINK_FIX_EXTENSIONS. */
const LINK_EXTENSIONS = ['.md', '.txt', '.html', '.htm', '.csv', '.json', '.yaml', '.yml', '.adoc', '.rst'];

/** Match worker's boundaryClass. ':' permits unit::/ and template::/ schemes;
 * an embedded URL path has no boundary before its leading slash. */
const BOUNDARY_CHARS = new Set([' ', '\t', '\n', '\r', '\f', '\v',
    '"', "'", '(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '|', '@', ':', '`']);

const BOUNDARY_CLASS = '\\s"\'()\\[\\]{}<>,;|@:`';

/** Non-ASCII letters must not delimit a token. */
const isBoundary = (ch) => ch !== undefined && BOUNDARY_CHARS.has(ch);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** URI unreserved/sub-delimiter characters, ":", "@" and "/" travel raw; encode other runes. */
function travelsRaw(rune) {
    if (rune.length !== 1 || rune.codePointAt(0) > 127) return false;
    return /[a-zA-Z0-9\-._~!$&'()*+,;=:@/]/.test(rune);
}

/** Use browser address-bar encoding, preserving path separators. */
function encodeLinkPath(p) {
    let out = '';
    for (const rune of p) {
        if (travelsRaw(rune)) {
            out += rune;
            continue;
        }
        for (const byte of Buffer.from(rune, 'utf8')) {
            out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
        }
    }
    return out;
}

/** Accept either case for hex digits without making the path case-insensitive.
 * Avoid inline (?i:) groups for compatibility with older runner Node versions. */
function escapedRuneExpr(rune) {
    let out = '';
    for (const ch of encodeLinkPath(rune)) {
        out += /[A-Fa-f]/.test(ch) ? '[' + ch.toUpperCase() + ch.toLowerCase() + ']' : escapeRegex(ch);
    }
    return out;
}

/** Prefer the encoded alternative so escapes are not read as raw percent signs and hex digits. */
function pathExpr(normalised) {
    let out = '';
    for (const rune of normalised) {
        out += travelsRaw(rune) ? escapeRegex(rune) : '(?:' + escapedRuneExpr(rune) + '|' + escapeRegex(rune) + ')';
    }
    return out;
}

const stripLeadingSlash = (p) => (p.startsWith('/') ? p.slice(1) : p);

/** needle is the unescapable leading substring: absence skips regex work safely. */
function renameOp(oldPath, newPath) {
    const normalised = stripLeadingSlash(oldPath);
    const body = pathExpr(normalised);
    const pattern = new RegExp('/' + body + '(?:/[^' + BOUNDARY_CLASS + ']*)?', 'g');
    const head = new RegExp('^' + body);
    let needle = '';
    for (const rune of normalised) {
        if (!travelsRaw(rune)) break;
        needle += rune;
    }
    const spaced = spacesInPath(newPath);
    return {
        oldPath,
        newPath,
        pattern,
        needle: '/' + needle,
        // A newly introduced space requires destination encoding regardless of the old spelling.
        replace: (matched, asDestination) => renameReplacement(
            matched, normalised, head, stripLeadingSlash(newPath), asDestination && spaced),
    };
}

const spacesInPath = (p) => /\s/.test(p);

/** Detect inline Markdown destinations, including schemes. Their whitespace delimiter requires
 * encoding; JSON paths (e.g. members) must retain the raw spelling their readers fetch. */
function isLinkDestination(line, start) {
    let i = start - 1;
    while (i >= 0 && line[i] !== '(' && line[i] !== ')' && !/\s/.test(line[i])) i--;
    return i >= 1 && line[i] === '(' && line[i - 1] === ']';
}

/** Preserve the child suffix and the old path's raw/encoded spelling. head locates the suffix
 * even when encoding changes the matched length; asDestination forces encoding for new spaces. */
function renameReplacement(matched, oldNormalised, head, newNormalised, asDestination = false) {
    const body = stripLeadingSlash(matched);
    const found = head.exec(body);
    const oldPart = found ? found[0] : body;
    const suffix = found ? body.slice(found[0].length) : '';
    const asFound = oldPart === oldNormalised && !asDestination;
    return '/' + (asFound ? newNormalised : encodeLinkPath(newNormalised)) + suffix;
}

function fixLine(line, op) {
    op.pattern.lastIndex = 0;
    let out = '';
    let cursor = 0;
    let substitutions = 0;
    for (let m = op.pattern.exec(line); m !== null; m = op.pattern.exec(line)) {
        const start = m.index;
        const end = start + m[0].length;
        if (!(start === 0 || isBoundary(line[start - 1]))) continue;
        if (!(end === line.length || isBoundary(line[end]))) continue;
        out += line.slice(cursor, start) + op.replace(m[0], isLinkDestination(line, start));
        cursor = end;
        substitutions++;
    }
    return substitutions === 0 ? { line, substitutions: 0 } : { line: out + line.slice(cursor), substitutions };
}

/** Reject binary files by UTF-8 round-trip; normalize line terminators for text. */
function readText(file) {
    const buf = fs.readFileSync(file);
    const text = buf.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buf)) return null;
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
}

const isScannable = (file) => LINK_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext));

/** Honour ignore; return [{ file, substitutions }] sorted by path.
 * Operations compose in order within each line, matching successive whole-store passes. */
function fixLinks(root, ops, ignore) {
    const changed = [];
    if (ops.length === 0) return changed;

    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // a failed directory read must not fail a rename already performed
        }
        for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = path.join(dir, entry.name);
            if (ignore.ignores(full)) continue;
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && isScannable(entry.name)) fixFile(full);
        }
    };

    const fixFile = (file) => {
        let text;
        try {
            text = readText(file);
        } catch {
            return;
        }
        if (text === null) return;
        if (!ops.some((op) => text.includes(op.needle))) return;

        const lines = text.split('\n');
        let substitutions = 0;
        for (let i = 0; i < lines.length; i++) {
            for (const op of ops) {
                if (!lines[i].includes(op.needle)) continue;
                const fixed = fixLine(lines[i], op);
                lines[i] = fixed.line;
                substitutions += fixed.substitutions;
            }
        }
        if (substitutions === 0) return;
        fs.writeFileSync(file, lines.map((l) => l + '\n').join(''), 'utf8');
        changed.push({ file, substitutions });
    };

    walk(root);
    return changed.sort((a, b) => (a.file < b.file ? -1 : 1));
}

module.exports = {
    LINK_EXTENSIONS,
    encodeLinkPath,
    renameOp,
    fixLine,
    fixLinks,
};
