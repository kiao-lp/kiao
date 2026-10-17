/**
 * V007 — files a unit's folder under its title, and an episode under its series.
 *
 *     units/9kezx1czij8mgmfbpuqzsh/                   ->  units/Communication NonViolente — …/
 *                                                            episodes/CNV - 0 Bienvenue et vue d'ensemble/
 *     units/5w8j175rotcrpclcq5nsbd/                   ->  units/Podcasts/
 *
 * A unit is created in `units/<docId>/`, which is a default and never an address: no path is
 * recomputed from a docId anywhere, so a unit may be filed wherever it belongs. Nothing ever filed
 * them, so a store of two hundred units is two hundred folders named after nothing a reader can
 * read, all of them siblings, with no sign of which nine are the nine episodes of one series.
 *
 * This gives each folder the unit's own title and puts a series' episodes inside it:
 *
 *   - **a unit's folder is renamed after its title**, in the folder it already sits in;
 *   - **a terminal unit that a sommaire lists moves into `<that sommaire's folder>/episodes/`**.
 *
 * ## What is and is not moved into a parent
 *
 * Only a **terminal** member moves — one that is not itself a sommaire. A sommaire that another
 * sommaire lists stays where it is and is merely renamed, because the alternative is a tree of
 * tables of contents nested inside one another: this store's root sommaire lists "Podcasts", which
 * lists eleven series, and burying eleven series in `units/Table des matières/episodes/Podcasts/…`
 * would file every unit in the store under one folder. A sommaire is an entry point, and an entry
 * point is worth having near the top.
 *
 * A member with several parents goes to the first sommaire that names it, in the order the
 * documents are read, so a re-run puts it in the same place.
 *
 * ## What it will not touch
 *
 * Both passes are bounded by the store's `.kiao-files`, for the `[migration]` concern.
 *
 * Beyond that, **a folder is only claimed when it is named after the docId of the one unit inside
 * it**. That is exactly the shape "created by the default rule and never moved since", and it is
 * the only shape this script can be sure it owns: a folder someone named themselves is a decision
 * already taken, a folder holding two unit documents is not one unit's folder at all, and neither
 * is any business of a script that runs unattended at startup. Both are reported and left alone.
 *
 * ## The order, and what a crash leaves behind
 *
 * The links are rewritten **before** the folders move, which is what makes an interrupted run
 * recoverable: re-running recomputes the same plan from the same titles, finds the links already
 * rewritten and nothing left to substitute, and completes the moves that had not happened yet. A
 * crash between the two leaves references pointing at folders that are not there yet — visibly
 * broken, and repaired by running the script again. The reverse order would leave a store whose
 * folders had moved and whose references still named where they used to be, which no re-run could
 * detect.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, loadJson } = require('./lib/kiao-fs');
const { renameOp, fixLinks } = require('./lib/link-fix');
const { toStoreName } = require('./lib/store-name');

const UNIT_EXTENSION = '.mlunit.json';

/** What the link fixer writes in place of a reference whose file was deleted. */
const DELETED_REF = '///deleted///';

/** The folder a series keeps its episodes in. Mirrors EPISODES_FOLDER in kiao-mcp's unit/paths.ts. */
const EPISODES_FOLDER = 'episodes';

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/** The store path a `members` entry names — the entry with its leading slash taken off. */
const pathOfRef = (ref) => String(ref).replace(/^\/+/, '');

/**
 * Every unit document under `root`, as `{ dir, docId, title, members }`.
 *
 * Selected on shape and not on extension: a `.mlunit.json` that is not a unit document — a fixture,
 * an export, something a name happens to collide with — has no docId to name a folder after and is
 * skipped without a word.
 */
function readUnits(root, ignore) {
    const units = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = path.join(dir, entry.name);
            if (ignore.ignores(full)) continue;
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(UNIT_EXTENSION)) {
                const unit = readUnit(full);
                if (unit) units.push(unit);
            }
        }
    };
    walk(root);
    return units;
}

function readUnit(file) {
    let doc;
    try {
        doc = loadJson(file);
    } catch {
        return null;
    }
    if (!doc || doc.docType !== 'Unit' || typeof doc.docId !== 'string' || !doc.docId) return null;
    if (!doc.content || typeof doc.content !== 'object') return null;
    const members = Array.isArray(doc.content.members) ? doc.content.members : [];
    return {
        file,
        dir: path.dirname(file),
        docId: doc.docId,
        title: typeof doc.content.title === 'string' ? doc.content.title : '',
        members,
        isIndex: members.length > 0,
    };
}

/**
 * For each terminal unit, the sommaire that lists it — the first one, in the order the documents
 * were read, so a member listed twice lands in the same place on every run.
 *
 * A `members` entry is the child document's path from the store root, with a leading slash. Two
 * entries name nothing to file: the sentinel a deletion left behind, and a bare docId V003 could
 * not resolve. Both are left where they are, here as everywhere else.
 */
function parentsOf(root, units) {
    const byFile = new Map(units.map((u) => [u.file, u]));
    const at = (ref) => {
        const p = pathOfRef(ref);
        // A reference is stored the way the address bar gave it, so it may be percent-encoded.
        let decoded = p;
        try {
            decoded = decodeURIComponent(p);
        } catch { /* not an encoding, then — the raw form is the only one to try */ }
        return byFile.get(path.resolve(root, p)) ?? byFile.get(path.resolve(root, decoded));
    };
    const parent = new Map();
    for (const index of units) {
        for (const ref of index.members) {
            if (typeof ref !== 'string' || ref === DELETED_REF || !ref.startsWith('/')) continue;
            const child = at(ref);
            if (!child || child === index || child.isIndex || parent.has(child.docId)) continue;
            parent.set(child.docId, index);
        }
    }
    return parent;
}

/** Reported once each, because each is a folder an operator may want to look at. */
const FILED_BY_HAND = 'filed by hand';
const SHARED = 'shared with another unit document';
/** Reported as a count: it is what every folder looks like once this migration has run. */
const SETTLED = 'already named after its title';

/**
 * Whether this script owns `unit`'s folder: it is named after the docId, and holds that unit's
 * document and no other.
 */
function claimable(unit, unitsByDir) {
    const name = path.basename(unit.dir);
    if (name !== unit.docId) {
        return { ok: false, why: name === toStoreName(unit.title, unit.docId) ? SETTLED : FILED_BY_HAND };
    }
    if (unitsByDir.get(unit.dir).length > 1) return { ok: false, why: SHARED };
    return { ok: true };
}

/**
 * The plan: one entry per folder to move, parents before the children that move into them.
 *
 * A target already claimed, or already on disk and not itself about to move, takes the unit's docId
 * as a suffix — two units of the same title in one folder is the one thing a title cannot express.
 */
function planMoves(units, parent) {
    const unitsByDir = new Map();
    for (const u of units) unitsByDir.set(u.dir, [...(unitsByDir.get(u.dir) || []), u]);

    const claims = units.map((unit) => ({ unit, claim: claimable(unit, unitsByDir) }));
    const skipped = claims.filter((c) => !c.claim.ok).map((c) => ({ unit: c.unit, why: c.claim.why }));
    // Only a folder this script owns will be vacated; one left alone is still occupied afterwards,
    // and a title aiming at it has to give way.
    const leaving = new Set(claims.filter((c) => c.claim.ok).map((c) => c.unit.dir));

    const claimed = new Set();      // absolute target paths, so two units never aim at one folder
    const targetOf = new Map();     // docId -> where that unit's folder ends up
    const moves = [];

    const settle = (unit, parentDir) => {
        const base = toStoreName(unit.title, unit.docId);
        let target = path.join(parentDir, base);
        if (claimed.has(target) || (fs.existsSync(target) && !leaving.has(target))) {
            target = path.join(parentDir, `${base} (${unit.docId})`);
        }
        claimed.add(target);
        targetOf.set(unit.docId, target);
        if (target !== unit.dir) moves.push({ unit, from: unit.dir, to: target });
    };

    // Two passes, because an episode's destination is inside its parent's: everything that stays
    // where it is settles first, so the folder an episode moves into is already known.
    const reparented = [];
    for (const { unit, claim } of claims) {
        if (!claim.ok) {
            targetOf.set(unit.docId, unit.dir);   // it stays put; an episode of it still knows where
            claimed.add(unit.dir);
            continue;
        }
        if (parent.has(unit.docId)) reparented.push(unit);
        else settle(unit, path.dirname(unit.dir));
    }
    for (const unit of reparented) {
        settle(unit, path.join(targetOf.get(parent.get(unit.docId).docId), EPISODES_FOLDER));
    }

    return { moves, skipped };
}

/** Moves one folder, creating the `episodes/` that holds it. */
function performMove(move) {
    fs.mkdirSync(path.dirname(move.to), { recursive: true });
    fs.renameSync(move.from, move.to);
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V007: filing unit folders under their titles in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V007: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const units = readUnits(root, ignore);
    console.log(`V007: ${units.length} unit document(s) read`);
    if (units.length === 0) {
        console.log('V007: done — no unit in this store.');
        return;
    }

    const parent = parentsOf(root, units);
    const { moves, skipped } = planMoves(units, parent);
    const settled = skipped.filter((s) => s.why === SETTLED).length;
    if (settled > 0) console.log(`V007: ${settled} folder(s) already named after their title`);
    for (const { unit, why } of skipped.filter((s) => s.why !== SETTLED)) {
        console.log(`  left alone (${why}): ${rel(root, unit.dir)}`);
    }
    if (moves.length === 0) {
        console.log('V007: done — every unit folder is already where its title puts it.');
        return;
    }

    // The links first: see the header. A move whose references were already rewritten substitutes
    // nothing on a re-run, so this is a no-op the second time through.
    const ops = moves.map((m) => renameOp('/' + rel(root, m.from), '/' + rel(root, m.to)));
    const changed = fixLinks(root, ops, ignore);
    const substitutions = changed.reduce((sum, c) => sum + c.substitutions, 0);
    console.log(`V007: ${substitutions} reference(s) rewritten in ${changed.length} file(s)`);

    for (const move of moves) {
        performMove(move);
        console.log(`  ${rel(root, move.from)} -> ${rel(root, move.to)}`);
    }

    const episodes = moves.filter((m) => path.basename(path.dirname(m.to)) === EPISODES_FOLDER).length;
    console.log(`V007: done — ${moves.length} folder(s) moved, ${episodes} of them into a series,`
        + ` ${substitutions} reference(s) in ${changed.length} file(s).`);
}

main();
