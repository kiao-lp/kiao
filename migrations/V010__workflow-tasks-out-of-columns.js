/**
 * V010 — a task board's cards come out of its columns, and each says which column it is filed in.
 *
 *     "columns": [{ "id": "c1", "title": "Todo", "tasks": [{ "id": "t1", "title": "Plan" }] }]
 *  -> "columns": [{ "id": "c1", "title": "Todo" }],
 *     "tasks":   [{ "id": "t1", "column": "c1", "title": "Plan" }]
 *
 * A board was a list of columns, each holding its own list of cards. It is now the columns and one
 * list of cards beside them, each card naming the column it is filed in — or naming none, which files
 * it in the **backlog**, the place a card is while it is in no column and which the nested shape had
 * no way of saying. Moving a card is changing that one field, rather than taking the object out of
 * one list and putting it into another.
 *
 * Both services still read a board written the old way, and write it the new way at its first save.
 * This rewrites the ones nobody opens, so that every board of a store reads the way the `taskboard`
 * skill describes it: a turn editing a board by hand is told of one shape, and finds that one.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a file is a board because it is a `.workflow.json` that parses as JSON
 * carrying a `content.columns` array — or a bare `columns` array, a board written without its
 * envelope — and, when it declares a `docType` at all, because that is `KiaoWorkflow`. A board is
 * written only where one of its columns still holds a `tasks` key; one already in the new shape is
 * left byte-identical, which is also what makes a second run a no-op.
 *
 * Within a board nothing is dropped and nothing is renamed:
 *
 *  - the cards come out in the order the board is read in — column by column, top to bottom — after
 *    any card the document already lists beside the columns, which is where both services read them
 *    too;
 *  - each card gets `column` straight after its `id`, where the editor writes it, naming the column
 *    it came out of;
 *  - a column written without an id is given one, since its cards now have to name it;
 *  - an entry of a column's `tasks` that is not an object is carried across as it is — the readers
 *    drop it, and a migration is not the place to decide that for them;
 *  - `docTypeVersion` becomes `2` on an enveloped board, the version that says this shape.
 *
 * A board whose document-level `tasks` is something other than a list is left alone and named:
 * there is nowhere to put the cards without writing over whatever that is.
 */

const crypto = require('crypto');
const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';

/** The version that says the cards are listed beside the columns rather than inside them. */
const WORKFLOW_DOC_VERSION = 2;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value) => (typeof value === 'string' ? value : '');

/**
 * The content of a parsed document, or null when the file is not a board: the wrapped `content` of a
 * saved document, or the document itself where it was written without the envelope — which is how
 * both services tell the two apart, by whether a `content` key is there at all.
 */
function contentOf(json) {
    if (!isObject(json)) return null;
    if (json.docType !== undefined && json.docType !== WORKFLOW_DOC_TYPE) return null;
    const content = 'content' in json ? json.content : json;
    if (!isObject(content)) return null;
    return Array.isArray(content.columns) ? content : null;
}

/** Whether the board still holds cards inside its columns, which is the whole of what this is about. */
function nests(content) {
    return content.columns.some(column => isObject(column) && 'tasks' in column);
}

/** The card as the new shape holds it: `column` straight after its `id`, where the editor writes it. */
function filedIn(task, columnId) {
    const rest = { ...task };
    delete rest.id;
    // A card inside a column is in that column, whatever it said about itself.
    delete rest.column;
    return 'id' in task ? { id: task.id, column: columnId, ...rest } : { column: columnId, ...rest };
}

/**
 * The content with its cards taken out of its columns and listed beside them, each naming the column
 * it came out of. Returns how many cards moved.
 */
function lift(content) {
    const lifted = [];
    content.columns = content.columns.map(column => {
        if (!isObject(column) || !('tasks' in column)) return column;
        const rest = { ...column };
        delete rest.tasks;
        // Its cards have to name it now, so a column written without an id is given one — first, as
        // the editor writes it. The readers trim an id, so its cards are given it trimmed.
        const said = text(rest.id).trim();
        const id = said || crypto.randomUUID();
        const kept = said ? rest : ('id' in rest ? { ...rest, id } : { id, ...rest });
        for (const task of Array.isArray(column.tasks) ? column.tasks : []) {
            lifted.push(isObject(task) ? filedIn(task, id) : task);
        }
        return kept;
    });
    content.tasks = [...(Array.isArray(content.tasks) ? content.tasks : []), ...lifted];
    return lifted.length;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V010: listing the cards of task boards beside their columns in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V010: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [WORKFLOW_EXTENSION], ignore);
    let written = 0;
    let cards = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not a board
        }

        const content = contentOf(json);
        if (!content || !nests(content)) continue;
        if ('tasks' in content && !Array.isArray(content.tasks)) {
            console.log(`  ${path.relative(root, file)}: left alone — its "tasks" is not a list of cards`);
            continue;
        }

        const moved = lift(content);
        if ('content' in json) json.docTypeVersion = WORKFLOW_DOC_VERSION;
        saveJson(file, json);
        written++;
        cards += moved;
        console.log(`  ${path.relative(root, file)}: ${moved} card(s) now listed beside the columns`);
    }

    console.log(`V010: done — ${written} board(s) of ${files.length} rewritten: ${cards} card(s) taken `
        + `out of their columns, each naming the column it was in.`);
}

main();
