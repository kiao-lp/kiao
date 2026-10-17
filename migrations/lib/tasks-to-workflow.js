/**
 * Reading a folder of `.tasks.md` column files as the `.workflow.json` document that replaces it.
 *
 * The old format: a board was a folder, a column one markdown file of it, a task one level-2
 * section of that file, and a task's settings a fenced `yaml` block sitting immediately under the
 * `## ` line. The column order was the alphabetical order of the file names, read the way a person
 * reads them — `2 - Doing` before `10 - Done`.
 *
 * This is that reading, in Node, kept deliberately identical to what Dashboard used to do (the
 * plugin's `shared/markdown/sections.ts` and `taskMeta.ts`, both since deleted): fence-aware
 * splitting, so a `##` inside a code block is code; a settings block that must be the first fenced
 * `yaml` under the heading and must be flat `key: value` lines throughout, or it is somebody's
 * YAML and stays in the body.
 *
 * Nothing is thrown away. A preamble that is more than the column's own `# ` title becomes the
 * column's `notes`; a task's body is kept byte for byte, answers filed under it included.
 */

const path = require('path');

const TASKS_EXTENSION = '.tasks.md';
const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';
const WORKFLOW_DOC_VERSION = 1;

/** The keys the board knows. Anything else in a block is kept and means nothing. */
const KNOWN_KEYS = ['model', 'effort', 'permission', 'folder'];

/** Character ranges covered by fenced code blocks, where a `#` line is code, not a heading. */
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

const insideFence = (index, ranges) => ranges.some(([start, end]) => index >= start && index < end);

/** Whatever precedes the first `## `, then one string per level-2 section. */
function splitSections(text) {
    const ranges = fenceRanges(text);
    const heading = /^##[ \t]+.*$/gm;
    const offsets = [];
    let match;
    while ((match = heading.exec(text)) !== null) {
        if (!insideFence(match.index, ranges)) offsets.push(match.index);
    }
    if (offsets.length === 0) return { preamble: text.replace(/\s+$/, ''), sections: [] };
    return {
        preamble: text.slice(0, offsets[0]).replace(/\s+$/, ''),
        sections: offsets.map((start, i) => text.slice(start, offsets[i + 1] ?? text.length).replace(/\s+$/, '')),
    };
}

const bare = (line) => line.replace(/\r$/, '');

const FENCE_OPEN = /^ {0,3}(```|~~~)[ \t]*(?:yaml|yml)[ \t]*$/i;
const KEY_VALUE = /^[ \t]*([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:(.*)$/;
const COMMENT = /^[ \t]*#/;

/** A value as the old block wrote it: bare, or quoted with `"` or `'`. */
function readValue(raw) {
    const text = bare(raw).trim();
    if (text === '' || text === '~' || /^null$/i.test(text)) return null;
    const double = text.match(/^"([\s\S]*)"$/);
    if (double) return double[1].replace(/\\(["\\])/g, '$1');
    const single = text.match(/^'([\s\S]*)'$/);
    if (single) return single[1].replace(/''/g, "'");
    return text;
}

/** The `## ` line and everything under it. The heading is `''` for a section written without one. */
function splitHeading(section) {
    const end = section.indexOf('\n');
    const first = end < 0 ? section : section.slice(0, end);
    if (!/^##[ \t]/.test(bare(first))) return { heading: '', rest: section };
    return { heading: bare(first), rest: end < 0 ? '' : section.slice(end + 1) };
}

/** The settings block at the top of `rest` and the body under it, or null when there is none. */
function takeBlock(rest) {
    const lines = rest.split('\n');

    let open = 0;
    while (open < lines.length && bare(lines[open]).trim() === '') open += 1;
    const fence = bare(lines[open] ?? '').match(FENCE_OPEN);
    if (!fence) return null;

    const close = new RegExp(`^ {0,3}${fence[1]}[ \\t]*$`);
    let end = open + 1;
    while (end < lines.length && !close.test(bare(lines[end]))) end += 1;
    // An unclosed fence is not a settings block: it is a code block running to the end of the task.
    if (end >= lines.length) return null;

    const entries = [];
    for (const line of lines.slice(open + 1, end)) {
        const text = bare(line);
        if (text.trim() === '' || COMMENT.test(text)) continue;
        const pair = text.match(KEY_VALUE);
        // One line that is not a pair and the block is somebody's YAML, not the board's.
        if (!pair) return null;
        entries.push([pair[1], readValue(pair[2])]);
    }
    return { entries, body: lines.slice(end + 1).join('\n') };
}

/** One level-2 section as a task of the new format, id excluded — the caller mints those. */
function taskOfSection(section) {
    const { heading, rest } = splitHeading(section);
    const block = takeBlock(rest);
    const settings = {};
    for (const [key, value] of (block ? block.entries : [])) {
        if (KNOWN_KEYS.includes(key) && typeof value === 'string' && value.trim() !== '') {
            settings[key] = value.trim();
        }
    }
    return {
        title: heading.replace(/^##[ \t]+/, '').trim(),
        body: (block ? block.body : rest).replace(/^\s+|\s+$/g, ''),
        settings,
    };
}

/** A column's title: its file name, less the extension that made it a column. */
function columnTitleOf(file) {
    const name = path.basename(file);
    return name.slice(0, name.length - TASKS_EXTENSION.length);
}

/**
 * A preamble worth keeping. The `# Todo` a column file opened on restates the file name, which is
 * now the column's title, so it goes; a note written under it is kept as the column's `notes`.
 */
function notesOf(preamble) {
    return preamble.replace(/^#[ \t]+.*(?:\r?\n)?/, '').trim();
}

/** Two column titles, read the way a person reads them: `2 - Doing` before `10 - Done`. */
const compareTitles = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Column files in the order the board showed them: the alphabetical order of their names. */
function orderColumns(files) {
    return [...files].sort((a, b) => compareTitles(columnTitleOf(a), columnTitleOf(b)));
}

/**
 * The workflow document a folder of column files becomes. `columns` is `[{ file, text }]` in any
 * order; `newId` mints an id per column and per task — a UUID in the runner, something countable
 * in a test.
 */
function workflowOf(columns, newId) {
    const ordered = orderColumns(columns.map((column) => column.file));
    const byFile = new Map(columns.map((column) => [column.file, column.text]));

    return {
        columns: ordered.map((file) => {
            const { preamble, sections } = splitSections(byFile.get(file) ?? '');
            const notes = notesOf(preamble);
            return {
                id: newId(),
                title: columnTitleOf(file),
                ...(notes ? { notes } : {}),
                tasks: sections.map((section) => {
                    const task = taskOfSection(section);
                    return {
                        id: newId(),
                        title: task.title,
                        ...(task.body ? { body: task.body } : {}),
                        ...(Object.keys(task.settings).length > 0 ? { settings: task.settings } : {}),
                    };
                }),
            };
        }),
    };
}

/** The document as it is written to disk, envelope and all — the shape Dashboard reads back. */
function documentOf(content, newId, createdAt) {
    return {
        docType: WORKFLOW_DOC_TYPE,
        docId: newId(),
        docTypeVersion: WORKFLOW_DOC_VERSION,
        createdAt,
        updatedAt: createdAt,
        content,
    };
}

module.exports = {
    TASKS_EXTENSION,
    WORKFLOW_EXTENSION,
    WORKFLOW_DOC_TYPE,
    WORKFLOW_DOC_VERSION,
    columnTitleOf,
    documentOf,
    orderColumns,
    splitSections,
    taskOfSection,
    workflowOf,
};
