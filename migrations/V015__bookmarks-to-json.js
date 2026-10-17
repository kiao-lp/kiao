/**
 * V015 — bookmarks are JSON: `kiao-user-config/bookmarks.md` becomes `bookmarks.json`.
 *
 *     ### [The framing of a unit](/units/abc/cadre.md)   ->  { "title": "The framing of a unit",
 *                                                                "link": "/units/abc/cadre.md",
 *     the one to copy from.                                    "note": "the one to copy from." }
 *
 * A bookmark used to be a level-3 section of a markdown file — the `### ` line its `[title](link)`
 * and everything under it its note. It is now an entry of a JSON array, one field per part, and
 * nothing reads the old shape any more, so the markdown file is converted and removed.
 *
 * ## What it will and will not touch
 *
 * Only the one file at its known place, `kiao-user-config/bookmarks.md`, and only when the store
 * does not declare it out of bounds for `[migration]` — like every migration:
 *
 *  - The sections are read exactly the way QuickCMS read them: `### ` headings outside fenced
 *    code blocks, the `[title](link)` off the heading line with `\[` `\]` unescaped, the note
 *    everything under it down to the next `### `. A heading that is not a link becomes a bookmark
 *    with an empty link, and a `###` inside a fence stays code.
 *  - The JSON is written byte-identical to what the application writes itself — pretty-printed,
 *    with the trailing newline — so the panel's first save changes nothing.
 *  - Whatever sat above the first bookmark — the `# Bookmarks` title — has nowhere to go in the
 *    new shape and is dropped, and said so.
 *  - A markdown file holding no bookmark — empty, or a preamble and nothing under it — leaves no
 *    JSON behind: no bookmarks is no file, and the markdown one is still removed.
 *  - A store that already holds `bookmarks.json` is left alone, markdown file included: it has
 *    migrated, and a `bookmarks.md` beside it is a file the operator wrote since, not one this
 *    script is owed. That is also what makes a second run a no-op.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore } = require('./lib/kiao-fs');

const BOOKMARKS_MD = path.join('kiao-user-config', 'bookmarks.md');
const BOOKMARKS_JSON = path.join('kiao-user-config', 'bookmarks.json');

/**
 * Character ranges covered by fenced code blocks, where a `#` line is code, not a heading —
 * kept identical to QuickCMS's `@cms-kit/markdown`, which used to read this file.
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

const isInsideFence = (index, ranges) =>
    ranges.some(([start, end]) => index >= start && index < end);

/** Start offset of every level-3 heading, in file order. */
function headingOffsets(text) {
    const ranges = fenceRanges(text);
    const heading = /^#{3}[ \t]+.*$/gm;
    const offsets = [];
    let match;
    while ((match = heading.exec(text)) !== null) {
        if (!isInsideFence(match.index, ranges)) offsets.push(match.index);
    }
    return offsets;
}

/** What a heading line says: the text after its `### `, or `''` when it has none. */
const headingTextOf = (section) =>
    (section.match(/^#{3}[ \t]+(.*)$/m)?.[1] ?? '').trim();

/**
 * The `[title](link)` of a heading line. The title is taken greedily so that the *last* `](` is
 * the one that separates it from the destination — a title may hold brackets of its own, a
 * destination holds no spaces.
 */
const HEADING_LINK = /^\[(.*)\]\((\S*)\)$/;

/** `\[` and `\]` are how a title carrying a bracket is written; they are not part of it. */
const unescapeTitle = (title) => title.replace(/\\([[\]])/g, '$1');

const bookmarkFrom = (section) => {
    const heading = headingTextOf(section);
    const link = heading.match(HEADING_LINK);
    const note = section.replace(/^###[ \t]+.*$/m, '').trim();
    return {
        title: link ? unescapeTitle(link[1]).trim() : heading,
        link: link ? link[2] : '',
        note,
    };
};

/** Reads the markdown file into the JSON entries it holds, and the preamble it drops. */
function parseBookmarks(text) {
    const offsets = headingOffsets(text);
    if (offsets.length === 0) return { preamble: text.replace(/\s+$/, ''), bookmarks: [] };
    return {
        preamble: text.slice(0, offsets[0]).replace(/\s+$/, ''),
        bookmarks: offsets.map((start, i) =>
            bookmarkFrom(text.slice(start, offsets[i + 1] ?? text.length).replace(/\s+$/, ''))),
    };
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V015: moving the bookmarks to JSON in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V015: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const md = path.join(root, BOOKMARKS_MD);
    const json = path.join(root, BOOKMARKS_JSON);

    if (fs.existsSync(json)) {
        console.log('V015: done — bookmarks.json already exists, nothing to do.');
        return;
    }
    if (!fs.existsSync(md)) {
        console.log('V015: done — no bookmarks.md, nothing to do.');
        return;
    }
    if (ignore.ignores(BOOKMARKS_MD)) {
        console.log('V015: done — bookmarks.md is out of bounds for [migration], left alone.');
        return;
    }

    const { preamble, bookmarks } = parseBookmarks(fs.readFileSync(md, 'utf8'));
    fs.unlinkSync(md);
    if (bookmarks.length === 0) {
        console.log('V015: done — bookmarks.md held no bookmark, removed without a replacement.');
        return;
    }
    // With the trailing newline, which is how the application writes it: the panel's first save
    // then leaves the file byte-identical.
    fs.writeFileSync(json, `${JSON.stringify(bookmarks, null, 2)}\n`, 'utf8');
    console.log(`V015: done — ${bookmarks.length} bookmark(s) moved to ${BOOKMARKS_JSON}.`
        + (preamble === '' ? '' : ' The preamble above the first bookmark was dropped.'));
}

main();
