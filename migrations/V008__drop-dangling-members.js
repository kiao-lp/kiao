/**
 * V008 — drops the `members` entries that are a bare docId no unit answers to.
 *
 *     "members": [
 *       "/units/Azure …/episodes/Episode 1 …/o8jgtm7lhvebh9f60g6bsc.mlunit.json",
 *   -   "56ufk2dmekkbvan5dlj9fn",
 *       "/units/Azure …/episodes/Episode 3 …/wnlvfdee6ftjqr3gd25wgs.mlunit.json"
 *     ]
 *
 * A sommaire lists its children by the path of their document. `V003__unit-links-by-path.js` turned
 * the docIds that came before into paths, and left alone every id it could not resolve — because
 * guessing a path from a docId is the derivation V003 existed to remove. Those leftovers are units
 * that had already been deleted when V003 ran, so the entry is archaeology: it addresses nothing,
 * `unit_index_get` reports it as `leftover`, the player skips it, and the only thing left to do
 * with it is what this does. Until then every affected sommaire announces more members than it has.
 *
 * ## What it will not touch
 *
 * **The `///deleted///` sentinel stays.** The link fixer writes it the moment an author deletes a
 * member, so it is a live signal — "this sommaire has a hole where you just removed something" —
 * addressed to a person who has not seen it yet. Erasing it unattended at the next startup would
 * take the message away before it was read. A bare docId is the opposite: nothing wrote it on
 * purpose, and nobody was ever going to be told about it.
 *
 * **A bare docId that still resolves stays**, and is reported. Turning one into a path is V003's
 * job, done through an index of the whole store; a store where that has not happened is a store to
 * run V003 on, not one to quietly drop members from.
 *
 * **An entry that is a path stays, even when nothing answers at it.** A path is an address someone
 * wrote, and a file that is not there right now is not the same thing as a file that never will be
 * — a mount that is down, a folder not yet pulled. Only the bare id is unambiguous.
 *
 * Bounded by the store's `.kiao-files` for the `[migration]` concern, like every other script here,
 * and selected on shape: a `.mlunit.json` that is not a unit document is not read for members.
 */

const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const UNIT_EXTENSION = '.mlunit.json';

/** What the link fixer writes in place of a reference whose file was deleted. Left alone here. */
const DELETED_REF = '///deleted///';

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/**
 * An entry is a bare docId when it carries no leading slash — so it is neither a path nor the
 * sentinel, which starts with one. Mirrors `isLeftoverRef` in kiao-mcp's unit/paths.ts.
 */
const isBareId = (ref) => typeof ref === 'string' && ref !== '' && !ref.startsWith('/');

/** Reads a unit document, or null for anything that is not one. */
function readUnit(file) {
    let doc;
    try {
        doc = loadJson(file);
    } catch {
        return null;
    }
    if (!doc || doc.docType !== 'Unit' || typeof doc.docId !== 'string' || !doc.docId) return null;
    if (!doc.content || typeof doc.content !== 'object') return null;
    return doc;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V008: dropping members that name nothing in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V008: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    // One walk, two uses: the documents to rewrite, and the set of ids a member may still name.
    const docs = [];
    for (const file of scan(root, [UNIT_EXTENSION], ignore)) {
        const doc = readUnit(file);
        if (doc) docs.push({ file, doc });
    }
    const known = new Set(docs.map((d) => d.doc.docId));
    console.log(`V008: ${docs.length} unit document(s) read`);

    let dropped = 0;
    let rewritten = 0;
    let resolvable = 0;
    for (const { file, doc } of docs) {
        const members = doc.content.members;
        if (!Array.isArray(members) || members.length === 0) continue;

        const kept = members.filter((ref) => {
            if (ref === DELETED_REF || !isBareId(ref)) return true;
            if (known.has(ref)) {
                console.warn(`  kept (a unit answers to it — run V003): "${ref}" in ${rel(root, file)}`);
                resolvable++;
                return true;
            }
            console.log(`  dropped "${ref}" from ${rel(root, file)}`);
            dropped++;
            return false;
        });
        if (kept.length === members.length) continue;
        doc.content.members = kept;
        saveJson(file, doc);
        rewritten++;
    }

    console.log(`V008: done — ${dropped} member(s) dropped from ${rewritten} sommaire(s)`
        + `${resolvable > 0 ? `, ${resolvable} left for V003` : ''}.`);
}

main();
