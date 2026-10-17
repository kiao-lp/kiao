/**
 * V002 — a board that was a folder of `.tasks.md` files becomes one `.workflow.json` document.
 *
 *     backlog/board/01 Refine.tasks.md          backlog/board.workflow.json
 *     backlog/board/05 Ready.tasks.md    ->     (one document, one entry per column)
 *     backlog/board/10 To Test.tasks.md
 *
 * The old format gave a task no identity — it was the text sitting at a rank in a file — so a
 * played turn had to recognise its own task by comparing text, a task could not hold a `#` or a
 * `##` without splitting its column in two, and a board could not be copied anywhere without
 * carrying a folder. The new one is a document like the store's others: see
 * `reference/kiao-skills/taskboard/SKILL.md` for its shape, and the reading of the old format is
 * `lib/tasks-to-workflow.js`, kept identical to what QuickCMS used to do.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, the selection is `.tasks.md` — an extension the store owns outright and
 * that only this one format ever used, unlike the bare `.md` and `.json` a store is full of.
 *
 * A folder whose target document **already exists** is skipped with a warning rather than merged
 * or overwritten: a half-converted board is the operator's to look at, and this script cannot know
 * which of the two is wanted. So is a folder that holds anything other than its column files —
 * only a folder emptied by the conversion is removed, and everything else is left standing with a
 * line saying so.
 *
 * Re-running is a no-op: the second pass finds no `.tasks.md` anywhere and writes nothing.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan } = require('./lib/kiao-fs');
const {
    TASKS_EXTENSION, WORKFLOW_EXTENSION, documentOf, workflowOf,
} = require('./lib/tasks-to-workflow');

const newId = () => require('crypto').randomUUID();

/** The column files of the store, grouped by the folder that was the board. */
function boardsIn(root, ignore) {
    const boards = new Map();
    for (const file of scan(root, [TASKS_EXTENSION], ignore)) {
        const folder = path.dirname(file);
        if (!boards.has(folder)) boards.set(folder, []);
        boards.get(folder).push(file);
    }
    return boards;
}

/**
 * The document a board folder becomes: `<parent>/<folder name>.workflow.json`. A board at the
 * store root itself has no name of its own to take, so it keeps the folder and is written inside
 * it — a case that does not arise in practice and must still not write outside the store.
 */
function targetFor(root, folder) {
    if (path.resolve(folder) === path.resolve(root)) {
        return path.join(folder, `board${WORKFLOW_EXTENSION}`);
    }
    return path.join(path.dirname(folder), `${path.basename(folder)}${WORKFLOW_EXTENSION}`);
}

/** Converts one board. Answers whether anything was written. */
function convert(root, folder, files) {
    const target = targetFor(root, folder);
    const shown = path.relative(root, target);

    if (fs.existsSync(target)) {
        console.warn(`  ${path.relative(root, folder)}: NOT converted — ${shown} already exists. ` +
            'Look at the two and remove whichever is stale, then run this again.');
        return false;
    }

    const columns = files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
    // The board's birth date rather than this run's: the document is the same board, and the store
    // is full of documents whose createdAt says when the work started.
    const createdAt = columns
        .map(({ file }) => fs.statSync(file).mtime.toISOString())
        .sort()[0];
    const document = documentOf(workflowOf(columns, newId), newId, createdAt);
    fs.writeFileSync(target, JSON.stringify(document, null, 2), 'utf8');

    const tasks = document.content.columns.reduce((sum, column) => sum + column.tasks.length, 0);
    console.log(`  ${shown} — ${document.content.columns.length} column(s), ${tasks} task(s)`);

    for (const { file } of columns) fs.unlinkSync(file);

    // Only a folder the conversion emptied is removed. A board folder holding notes, images or a
    // README is somebody's folder, and the document beside it is enough.
    const left = fs.readdirSync(folder);
    if (left.length === 0) {
        fs.rmdirSync(folder);
    } else {
        console.log(`    ${path.relative(root, folder)}/ kept — ${left.length} other file(s) in it`);
    }
    return true;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V002: converting task boards in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V002: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const boards = boardsIn(root, ignore);
    let converted = 0;
    for (const folder of [...boards.keys()].sort()) {
        if (convert(root, folder, boards.get(folder).sort())) converted += 1;
    }

    console.log(`V002: done — ${converted} board(s) converted.`);
}

main();
