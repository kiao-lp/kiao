/**
 * V009 — every internal link is written from the store root, with a leading slash.
 *
 *     "contents": [{ …, "path": "units/Ma série/cadre.md" }]
 *          ->    "contents": [{ …, "path": "/units/Ma série/cadre.md" }]
 *
 *     "settings": { …, "folder": "backlog" }
 *          ->    "settings": { …, "folder": "/backlog" }
 *
 * **The slash is what makes a path a link.** files-service's link fixer — the pass that repairs
 * every reference after a rename or a delete — used to recognise a path token with or without one,
 * which meant that renaming a folder at the store root rewrote its name wherever it stood: in a
 * shell snippet, in a stack trace pasted into a note, in an ordinary sentence. A store's root
 * folders are called `docs`, `config`, `units` — ordinary words — so there was no telling a
 * reference from prose. The fixer now requires the slash (`linkfix.go`, `lib/link-fix.js`), and
 * this is the pass that gives it to the two stored fields that were still written without one.
 *
 * Everything else already carried it: a sommaire's `members` since V003, the `unit::` and
 * `template::` schemes since the same, and every link QuickCMS writes into a document — a dropped
 * file, a bookmark, a bibliography entry, a passage link — since `storedLinkOf`.
 *
 * ## What it will and will not touch
 *
 * Bounded by the store's `.kiao-files` for the `[migration]` concern, like every script here, and
 * selected on shape: a document is a unit because its `docType` is `Unit` and a board because its
 * `docType` is `KiaoWorkflow`, never because of where it sits or what it is called. A
 * `.mlunit.json` that is a fixture, an export or somebody's sample parses to something else and is
 * left alone.
 *
 * **Prose is not touched, and neither is a relative markdown link.** `[le cadre](cadre.md)` is read
 * against the document that holds it — here, on GitHub and in an IDE preview alike — so it is not a
 * path from the store root and prefixing it would break it. There is no way to tell a bare path in
 * a sentence from one meant as a reference, which is the whole reason the slash is now required:
 * only the fields whose *name* says they hold a store path are converted.
 *
 * **A `members` entry that is a bare docId stays one.** That is what V003 left where it found it and
 * V008 deliberately keeps or drops on its own terms; it is not a path, so there is no slash to give
 * it. Only an entry that already reads as a path — it has a `/` in it — gains one.
 *
 * ## One repair, for what V007 can no longer do on its own
 *
 * `V007__unit-folders-by-title.js` moves a unit's folder and leaves the link fixer to repair the
 * references to what was inside it, its own `contents[].path` among them. Those were written
 * without the slash, so on a store where V007 runs *after* this build — a ledger reset, or a first
 * start over an old store — the fixer no longer follows them and they are left naming the folder
 * the unit came from. V007 cannot be corrected: its bytes are in the ledger of every environment it
 * has run on, and a script whose checksum moves is one the runner refuses to start over.
 *
 * So a content path arriving **without** the slash whose file is not there, while a file of that
 * name sits beside the unit's own document, is re-pointed at the document's folder and reported. It
 * is not a guess: both halves are read off the disk, and a unit's content files are the files in
 * the unit's folder. A path that already carries the slash is left exactly as it reads, whatever
 * the filesystem says — a mount that is down is not a broken reference.
 *
 * Re-running is a no-op: a value already starting with `/` is left byte-identical, and a document
 * already at version 21 with nothing left to convert is not written at all.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const UNIT_EXTENSION = '.mlunit.json';
const UNIT_DOC_TYPE = 'Unit';
const UNIT_DOC_TYPE_VERSION = 21;

const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** The link form of a store path: the path itself, opened by the slash that makes it a link. */
const linkOf = (storePath) => '/' + storePath.replace(/^\/+/, '');

/** True for the envelope of a document of `docType`, whatever its version. */
const isDocument = (json, docType) =>
    json !== null && typeof json === 'object' && json.docType === docType
    && json.content !== null && typeof json.content === 'object';

/** Parses a document, or answers null when it is not JSON at all. */
function readDocument(file) {
    try {
        return loadJson(file);
    } catch {
        return null;
    }
}

const exists = (root, storePath) => {
    try {
        return fs.existsSync(path.join(root, ...storePath.split('/')));
    } catch {
        return false;
    }
};

/** The folder a unit's document sits in, as a store path — `''` for one at the store root. */
const folderOf = (storePath) => {
    const cut = storePath.lastIndexOf('/');
    return cut === -1 ? '' : storePath.slice(0, cut);
};

const basenameOf = (storePath) => storePath.slice(storePath.lastIndexOf('/') + 1);

/**
 * The link a content path becomes, and whether it had to be re-pointed at the unit's own folder —
 * see "One repair" above. `docPath` is the store path of the unit's document.
 */
function contentLink(root, docPath, stored) {
    if (stored.startsWith('/')) return { link: stored, repaired: false };
    if (exists(root, stored)) return { link: linkOf(stored), repaired: false };

    const beside = folderOf(docPath) ? `${folderOf(docPath)}/${basenameOf(stored)}` : basenameOf(stored);
    if (beside !== stored && exists(root, beside)) return { link: linkOf(beside), repaired: true };
    return { link: linkOf(stored), repaired: false };
}

/** Rewrites one unit document. Answers what changed and whether the file was written. */
function convertUnit(root, file, json) {
    const docPath = rel(root, file);
    let converted = 0;
    const repaired = [];

    const contents = json.content.contents;
    if (Array.isArray(contents)) {
        for (const item of contents) {
            if (item === null || typeof item !== 'object') continue;
            if (typeof item.path !== 'string' || item.path === '' || item.path.startsWith('/')) continue;
            const { link, repaired: moved } = contentLink(root, docPath, item.path);
            if (moved) repaired.push(`${item.path} -> ${link}`);
            item.path = link;
            converted++;
        }
    }

    const members = json.content.members;
    if (Array.isArray(members)) {
        for (let i = 0; i < members.length; i++) {
            const entry = members[i];
            // A bare docId carries no '/' and is not a path: V003 wrote it, V008 answers for it.
            if (typeof entry !== 'string' || entry.startsWith('/') || !entry.includes('/')) continue;
            members[i] = linkOf(entry);
            converted++;
        }
    }

    const version = json.docTypeVersion;
    const stamped = typeof version === 'number' && version < UNIT_DOC_TYPE_VERSION;
    if (stamped) json.docTypeVersion = UNIT_DOC_TYPE_VERSION;

    const written = converted > 0 || stamped;
    if (written) saveJson(file, json);
    return { converted, repaired, written };
}

/** Rewrites one board document: the working directory of every task that names one. */
function convertWorkflow(file, json) {
    let converted = 0;
    const columns = json.content.columns;
    if (!Array.isArray(columns)) return { converted, written: false };

    for (const column of columns) {
        if (column === null || typeof column !== 'object' || !Array.isArray(column.tasks)) continue;
        for (const task of column.tasks) {
            if (task === null || typeof task !== 'object') continue;
            const settings = task.settings;
            if (settings === null || typeof settings !== 'object') continue;
            if (typeof settings.folder !== 'string') continue;
            // A box left empty is a task naming no folder at all, which is not the same thing as
            // one that runs at the store root: it is what makes an AI card unplayable, and giving
            // it a slash would hand it the whole store to run in.
            if (settings.folder.trim() === '') continue;
            // The same normalisation the board applies before handing the folder to a service
            // (`normalizeFolder`, tasks-board/taskSettings.ts), read the other way round: what
            // comes back is the link, and the store root is the bare slash.
            const bare = settings.folder.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '');
            const link = linkOf(bare);
            if (link === settings.folder) continue;
            settings.folder = link;
            converted++;
        }
    }
    if (converted > 0) saveJson(file, json);
    return { converted, written: converted > 0 };
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V009: making internal links absolute in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V009: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    let units = 0;
    let unitLinks = 0;
    let repairs = 0;
    for (const file of scan(root, [UNIT_EXTENSION], ignore)) {
        const json = readDocument(file);
        if (!isDocument(json, UNIT_DOC_TYPE)) continue;
        const result = convertUnit(root, file, json);
        if (!result.written) continue;
        units++;
        unitLinks += result.converted;
        console.log(`  ${rel(root, file)}` + (result.converted > 0
            ? ` (${result.converted} link(s))` : ' (version only)'));
        for (const moved of result.repaired) {
            repairs++;
            console.warn(`    content file found beside the document: ${moved}`);
        }
    }

    let boards = 0;
    let folders = 0;
    for (const file of scan(root, [WORKFLOW_EXTENSION], ignore)) {
        const json = readDocument(file);
        if (!isDocument(json, WORKFLOW_DOC_TYPE)) continue;
        const result = convertWorkflow(file, json);
        if (!result.written) continue;
        boards++;
        folders += result.converted;
        console.log(`  ${rel(root, file)} (${result.converted} task folder(s))`);
    }

    console.log(`V009: done — ${unitLinks} link(s) in ${units} unit(s), ` +
        `${folders} task folder(s) in ${boards} board(s)` +
        (repairs > 0 ? `, ${repairs} content path(s) re-pointed at their unit's folder` : '') + '.');
}

main();
