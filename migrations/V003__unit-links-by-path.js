/**
 * V003 — a unit refers to another unit by path rather than by docId.
 *
 *     "members": ["5w8j175rotcrpclcq5nsbd"]
 *          ->    "members": ["/units/5w8j175rotcrpclcq5nsbd/5w8j175rotcrpclcq5nsbd.mlunit.json"]
 *
 *     unit::5w8j175rotcrpclcq5nsbd
 *          ->    unit::/units/5w8j175rotcrpclcq5nsbd/5w8j175rotcrpclcq5nsbd.mlunit.json
 *
 * A docId used to be an address: the document of `abc` was `units/abc/abc.mlunit.json`, and every
 * reader recomputed that path. Nothing derives a path from a docId any more — a unit folder may sit
 * anywhere in the store — so a reference is now the store-root-relative path of the `.mlunit.json`,
 * with the leading slash an internal link is stored with everywhere else. The docId stays in the
 * envelope: it is still the unit's identity, and the player's on-device keys are built from it.
 * Both forms are rewritten here, and a unit this script rewrites is stamped `docTypeVersion` 20.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a document is a unit because it parses as JSON whose `docType` is
 * `Unit` — never because of where it sits or what it is called. A `.mlunit.json` that is a fixture,
 * an export or somebody's sample parses to something else and is left alone, and a store holding no
 * KIAO document at all indexes nothing and writes nothing.
 *
 * The index is built by walking the store once for `.mlunit.json` documents and mapping each unit's
 * `docId` to the path of its document. **That index is the only way a docId becomes a path.** An id
 * it cannot resolve — a unit that was deleted, one that lives in a folder the store declares is not
 * content, or a string in `members` that was never a docId — is **left exactly as it was and
 * reported**: guessing a path from the id is the derivation this migration exists to remove, and a
 * member left as an unresolved id is visible in the editor, where a path invented for it would not
 * be. The same goes for a docId two documents claim, which resolves to nothing rather than to
 * whichever the walk saw first.
 *
 * Links in text are rewritten with the token rules of files-service's own link fixer (see
 * lib/link-fix.js): the same extensions, and a match delimited on both sides, so a `unit::` glued
 * to a longer word is not a link. Only the scheme is matched — never a bare docId, which is
 * 22 characters of lowercase alphanumerics and means something else in most of the files a store
 * holds.
 *
 * Re-running is a no-op. A members entry already starting with `/` is left byte-identical, an
 * already-converted `unit::/…` cannot match the scheme pattern (a `/` is not part of a docId), and
 * a document already at version 20 with nothing left to convert is not written at all.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');
const { LINK_EXTENSIONS, fixLine } = require('./lib/link-fix');

const UNIT_EXTENSION = '.mlunit.json';
const UNIT_DOC_TYPE = 'Unit';
const UNIT_DOC_TYPE_VERSION = 20;

/** The markdown scheme a unit reference is written under. `template::` is its sibling. */
const UNIT_SCHEME = 'unit::';

/**
 * `unit::` followed by a docId. Deliberately wider than the 22 lowercase alphanumerics a fresh
 * docId is made of — hand-written ids predate that shape — and deliberately without `/`, which is
 * what makes an already-converted `unit::/units/…` unmatchable and this pass idempotent.
 */
const UNIT_LINK_PATTERN = new RegExp(UNIT_SCHEME + '[A-Za-z0-9_-]+', 'g');

/** The reference form: the document's path from the store root, with a leading slash. */
const referenceTo = (relPath) => '/' + relPath;

const storePath = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** True for the envelope of a unit document, whatever its version. */
function isUnitDocument(json) {
    return json !== null && typeof json === 'object'
        && json.docType === UNIT_DOC_TYPE
        && json.content !== null && typeof json.content === 'object';
}

/** Parses a document, or answers null when it is not JSON at all. */
function readDocument(file) {
    try {
        return loadJson(file);
    } catch {
        return null;
    }
}

/**
 * Reads every `.mlunit.json` of the store once: the unit documents among them, and the map from a
 * unit's docId to the path of its document.
 *
 * An id claimed by two documents is dropped from the map rather than resolved: a store that holds a
 * copy of a unit folder cannot say which of the two a reference meant, and the reference is better
 * left for a person to read than pointed at a coin toss.
 */
function readUnits(root, files) {
    const documents = [];
    const byId = new Map();
    const ambiguous = new Set();
    for (const file of files) {
        const json = readDocument(file);
        if (!isUnitDocument(json)) continue;
        documents.push({ file, json });
        if (typeof json.docId !== 'string' || json.docId === '') continue;

        const found = storePath(root, file);
        const known = byId.get(json.docId);
        if (known !== undefined && known !== found) {
            ambiguous.add(json.docId);
            console.warn(`  note: docId "${json.docId}" is claimed by ${known} and by ${found} — ` +
                'references to it are left as they are');
        }
        byId.set(json.docId, found);
    }
    for (const id of ambiguous) byId.delete(id);
    return { documents, byId };
}

/**
 * Rewrites one unit document: its members by path, and its version. Answers how many members were
 * converted, which ids resolved to nothing, and whether the file was written.
 */
function convertUnit(file, json, units) {
    const unresolved = [];
    let converted = 0;

    const members = json.content.members;
    if (Array.isArray(members)) {
        for (let i = 0; i < members.length; i++) {
            const entry = members[i];
            // A path — including the `///deleted///` the link fixer leaves behind — is done.
            if (typeof entry !== 'string' || entry.startsWith('/')) continue;
            const found = units.get(entry);
            if (found === undefined) {
                unresolved.push(entry);
                continue;
            }
            members[i] = referenceTo(found);
            converted++;
        }
    }

    const version = json.docTypeVersion;
    const stamped = typeof version === 'number' && version < UNIT_DOC_TYPE_VERSION;
    if (stamped) json.docTypeVersion = UNIT_DOC_TYPE_VERSION;

    const written = converted > 0 || stamped;
    if (written) saveJson(file, json);
    return { converted, unresolved, written };
}

/** The members pass, over the unit documents the index was read from. */
function convertMembers(root, documents, units) {
    let written = 0;
    let converted = 0;
    let unresolved = 0;
    for (const { file, json } of documents) {
        const result = convertUnit(file, json, units);
        converted += result.converted;
        unresolved += result.unresolved.length;
        if (result.written) {
            written++;
            console.log(`  ${storePath(root, file)}` + (result.converted > 0
                ? ` (${result.converted} member(s) by path)` : ' (version only)'));
        }
        for (const id of result.unresolved) {
            console.warn(`    member "${id}" of ${storePath(root, file)} is no unit of this ` +
                'store — left as it is');
        }
    }
    return { written, converted, unresolved };
}

/**
 * Reads a file as text, or null when it is binary. The round-trip is the test, as in link-fix.js:
 * `toString('utf8')` turns an invalid sequence into U+FFFD, which does not encode back to the bytes
 * it came from.
 */
function readText(file) {
    const buf = fs.readFileSync(file);
    const text = buf.toString('utf8');
    return Buffer.from(text, 'utf8').equals(buf) ? text : null;
}

/**
 * The `unit::` pass, over every file whose extension files-service scans for links.
 *
 * The whole text is handed to `fixLine` at once rather than a line at a time: a line terminator is
 * one of the token boundaries, so the two are the same match, and holding the file as one string is
 * what lets a file whose every link was unresolvable be left byte-identical instead of rewritten
 * with its line endings normalised.
 */
function convertLinks(root, ignore, units) {
    let files = 0;
    let links = 0;
    let unresolved = 0;
    let stranded = [];

    const op = {
        pattern: UNIT_LINK_PATTERN,
        replace: (matched) => {
            const id = matched.slice(UNIT_SCHEME.length);
            const found = units.get(id);
            if (found === undefined) {
                stranded.push(id);
                return matched;
            }
            return UNIT_SCHEME + referenceTo(found);
        },
    };

    for (const file of scan(root, LINK_EXTENSIONS, ignore)) {
        let text;
        try {
            text = readText(file);
        } catch {
            continue;
        }
        if (text === null || !text.includes(UNIT_SCHEME)) continue;

        stranded = [];
        const fixed = fixLine(text, op);
        unresolved += stranded.length;
        if (fixed.line !== text) {
            fs.writeFileSync(file, fixed.line, 'utf8');
            const converted = fixed.substitutions - stranded.length;
            files++;
            links += converted;
            console.log(`  ${storePath(root, file)} (${converted} unit link(s))`);
        }
        for (const id of stranded) {
            console.warn(`    ${UNIT_SCHEME}${id} in ${storePath(root, file)} is no unit of this ` +
                'store — left as it is');
        }
    }
    return { files, links, unresolved };
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V003: linking units by path in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V003: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const { documents, byId } = readUnits(root, scan(root, [UNIT_EXTENSION], ignore));
    if (documents.length === 0) {
        console.log('V003: done — no unit document in this store.');
        return;
    }
    console.log(`V003: ${documents.length} unit document(s), ${byId.size} of them addressable by docId`);

    const members = convertMembers(root, documents, byId);
    const links = convertLinks(root, ignore, byId);

    console.log(`V003: done — ${members.written} unit document(s) rewritten ` +
        `(${members.converted} member(s) by path), ${links.links} unit link(s) in ` +
        `${links.files} file(s), ${members.unresolved + links.unresolved} reference(s) left ` +
        'unresolved.');
}

main();
