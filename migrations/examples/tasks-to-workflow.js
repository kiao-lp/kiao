const path = require('path');

const TASKS_EXTENSION = '.tasks.md';
const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';
const WORKFLOW_DOC_VERSION = 1;

const KNOWN_KEYS = ['model', 'effort', 'permission', 'folder'];

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

function readValue(raw) {
    const text = bare(raw).trim();
    if (text === '' || text === '~' || /^null$/i.test(text)) return null;
    const double = text.match(/^"([\s\S]*)"$/);
    if (double) return double[1].replace(/\\(["\\])/g, '$1');
    const single = text.match(/^'([\s\S]*)'$/);
    if (single) return single[1].replace(/''/g, "'");
    return text;
}

function splitHeading(section) {
    const end = section.indexOf('\n');
    const first = end < 0 ? section : section.slice(0, end);
    if (!/^##[ \t]/.test(bare(first))) return { heading: '', rest: section };
    return { heading: bare(first), rest: end < 0 ? '' : section.slice(end + 1) };
}

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

function columnTitleOf(file) {
    const name = path.basename(file);
    return name.slice(0, name.length - TASKS_EXTENSION.length);
}

function notesOf(preamble) {
    return preamble.replace(/^#[ \t]+.*(?:\r?\n)?/, '').trim();
}

const compareTitles = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function orderColumns(files) {
    return [...files].sort((a, b) => compareTitles(columnTitleOf(a), columnTitleOf(b)));
}

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
