/**
 * V013 — a board's cards are **flow nodes**, in the store's files as in its database.
 *
 *     "tasks":     [{ "id": "t1", "onSuccess": { "task": "t2" } }]
 *  -> "flowNodes": [{ "id": "t1", "onSuccess": { "flowNode": "t2" } }]
 *
 *     kiao-user-config/task-templates/AI.temp.md   ->  kiao-user-config/flow-node-templates/AI.temp.md
 *     ${taskDescription}, ${taskTitle}             ->  ${flowNodeDescription}, ${flowNodeTitle}
 *
 * They were called tasks, and that was the wrong word for what they are. A board is a graph: a card
 * names the card played after it, a chain runs across columns without noticing them, and three of
 * the four kinds — Shutdown, Scheduler, and a Human card waiting on somebody — are not work to be
 * done at all. Nothing in the tree says `task` any more, so a store's own files must not either:
 * a turn told of `flowNodes` and finding `tasks` is a turn that writes the board twice.
 *
 * This is the file half of the rename. The database half is hybridflow-store's schema `V009`, and
 * the two are independent — a store's boards moved into PostgreSQL long ago, and what this touches
 * is what was left behind in the files.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that:
 *
 *  - A file is a board because it is a `.workflow.json` that parses as JSON carrying a
 *    `content.columns` array — or a bare `columns` array, a board written without its envelope —
 *    and, when it declares a `docType` at all, because that is `KiaoWorkflow`. A board is written
 *    only where something in it still says `tasks` or `onSuccess.task`; one already renamed is left
 *    byte-identical, which is also what makes a second run a no-op.
 *  - `tasks` becomes `flowNodes` **in the place it held**, beside the columns and — for a board
 *    still written the way V010 found them — inside each column too, so a document in either shape
 *    comes out of this readable by the reader that already read it.
 *  - A card's `onSuccess.task` becomes `onSuccess.flowNode`, in its place, since that is the one
 *    field that names another card.
 *  - `docTypeVersion` becomes `3` on an enveloped board: the version that says `flowNodes`.
 *  - A board whose `tasks` is something other than a list is renamed all the same. The key is being
 *    renamed and not read, so whatever it holds travels with it rather than being judged here.
 *  - `kiao-user-config/task-templates` is renamed, and the `${taskDescription}` and `${taskTitle}`
 *    variables inside every `.temp.md` under it with it — they are what the editor binds, and a
 *    template naming the old ones would be instantiated with an empty description. A store that
 *    already holds `flow-node-templates` keeps it: the old folder is then reported and left, two
 *    folders of templates being something only a person can settle.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';

/** The version that says the cards are listed under `flowNodes`. */
const WORKFLOW_DOC_VERSION = 3;

const WAS_TEMPLATES = path.join('kiao-user-config', 'task-templates');
const TEMPLATES = path.join('kiao-user-config', 'flow-node-templates');

const VARIABLES = [
    ['${taskDescription}', '${flowNodeDescription}'],
    ['${taskTitle}', '${flowNodeTitle}'],
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

/**
 * Renames `from` to `to` on an object **in the place the old key held**, so a rewritten document
 * differs from the one before it in the key's spelling and in nothing else. Returns whether it
 * renamed anything.
 */
function renameKey(object, from, to) {
    if (!isObject(object) || !(from in object)) return false;
    const entries = Object.entries(object).map(([key, value]) => [key === from ? to : key, value]);
    for (const key of Object.keys(object)) delete object[key];
    for (const [key, value] of entries) object[key] = value;
    return true;
}

/** `onSuccess.task` → `onSuccess.flowNode` on one card. */
function chainOf(card) {
    return isObject(card) && renameKey(card.onSuccess, 'task', 'flowNode');
}

/** The content with every `task` word in it renamed. Returns how many cards were touched. */
function rename(content) {
    let touched = renameKey(content, 'tasks', 'flowNodes') ? 1 : 0;
    for (const card of Array.isArray(content.flowNodes) ? content.flowNodes : []) {
        if (chainOf(card)) touched++;
    }
    for (const column of content.columns) {
        if (!isObject(column)) continue;
        if (renameKey(column, 'tasks', 'flowNodes')) touched++;
        for (const card of Array.isArray(column.flowNodes) ? column.flowNodes : []) {
            if (chainOf(card)) touched++;
        }
    }
    return touched;
}

/** Every `.temp.md` under a folder, at any depth. */
function templatesUnder(folder) {
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.temp.md')) found.push(full);
        }
    };
    walk(folder);
    return found;
}

/**
 * The templates folder under its new name, with the two variables the editor binds renamed inside
 * every template it holds.
 */
function moveTemplates(root) {
    const was = path.join(root, WAS_TEMPLATES);
    const now = path.join(root, TEMPLATES);
    if (!fs.existsSync(was)) return;
    if (fs.existsSync(now)) {
        console.log(`  ${WAS_TEMPLATES}: left alone — ${TEMPLATES} is already there`);
        return;
    }
    fs.renameSync(was, now);
    let rewritten = 0;
    for (const file of templatesUnder(now)) {
        const before = fs.readFileSync(file, 'utf8');
        let after = before;
        for (const [from, to] of VARIABLES) after = after.split(from).join(to);
        if (after === before) continue;
        fs.writeFileSync(file, after);
        rewritten++;
    }
    console.log(`  ${WAS_TEMPLATES} -> ${TEMPLATES}: ${rewritten} template(s) rewritten`);
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V013: calling a board's cards flow nodes in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V013: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [WORKFLOW_EXTENSION], ignore);
    let written = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not a board
        }

        const content = contentOf(json);
        if (!content) continue;

        const touched = rename(content);
        if (touched === 0) continue;
        if ('content' in json) json.docTypeVersion = WORKFLOW_DOC_VERSION;
        saveJson(file, json);
        written++;
        console.log(`  ${path.relative(root, file)}: ${touched} place(s) renamed`);
    }

    moveTemplates(root);

    console.log(`V013: done — ${written} board(s) of ${files.length} rewritten.`);
}

main();
