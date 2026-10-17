/**
 * V004 — a mindmap relation joins exactly two notes.
 *
 *     "ends": [ {A}, {B}, {C} ]   ->   two relations: A—B and A—C
 *     "ends": [ ]                 ->   dropped
 *     "attachPointNumber": 99     ->   removed
 *
 * A relation used to hold any number of ends, all meeting at a shared anchor. Only `CENTROID`
 * ever drew such a thing — the elbow and the concave shapes are computed from a pair — so the
 * n-ary case cost every reader of the format a length check and never earned it. A relation is a
 * pair now, in the editor and in the type: `mindmap-edit` supports binary relations only.
 *
 * The file format is otherwise unchanged — `ends` is still an array of two — so `docTypeVersion`
 * stays at 1 and a document already holding nothing but pairs is not written at all. That is most
 * of them: this migration exists for the handful that predate the rule.
 *
 * ## What it does to a relation of more than two ends
 *
 * One relation per pair, from a **hub end** to each of the others, keeping the relation's shape.
 * The hub is the end whose note sits closest to where the lines used to meet — the centroid of
 * the ends — so the map is left looking as much like what its author drew as a pair can; the
 * first end plays that part when a note is missing or has never been measured. The hub end is
 * copied onto every relation it appears in, decoration and text with it, and each copy gets a
 * fresh `END-` id, because an end id is unique across the file.
 *
 * That choice is arbitrary in the way splitting a cluster into pairs cannot avoid being, so
 * every split is printed with the file it happened in: connectivity is preserved, but which note
 * became the middle of the star is worth a look afterwards.
 *
 * ## What else it removes
 *
 * A relation left with fewer than two ends is **dropped**. It has no geometry, was never drawn,
 * and nothing in the editor could reach it to delete it.
 *
 * An `attachPointNumber` outside the twelve places around a note — the `99` an old "attach to
 * center" command wrote, and a couple of numbers nothing ever wrote deliberately — is
 * **removed**. It already behaved exactly like an absent one, and the field now has no value
 * that means "none".
 *
 * ## What it will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a file is a mindmap because it parses as JSON carrying `elements.notes`
 * and `elements.relations` arrays — either bare or under `content`, both shapes being in stores —
 * and, when it declares a `docType` at all, because that is `QuickMindmap`. A `.mmap.json` that
 * is a fixture or an export of something else parses to another shape and is left alone. A
 * relation whose `ends` is not an array is not understood and is kept as it is.
 *
 * Re-running is a no-op: a store whose relations are all pairs with clean attach points is not
 * written to.
 */

const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const MINDMAP_EXTENSION = '.mmap.json';
const MINDMAP_DOC_TYPE = 'QuickMindmap';

/** The twelve places around a note an end may be pinned to. Anything else means "none". */
const ATTACH_POINTS = 12;

// The editor's own id alphabet and length, so what this writes cannot be told from what it writes.
const ID_CHARS = 'ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';

const newId = (prefix) => {
    let word = '';
    for (let i = 0; i < 8; i++) word += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
    return `${prefix}-${word}`;
};

/**
 * The mindmap held by a parsed document, whichever shape the file carries it in, or null when
 * the file is not one: the wrapped `content.elements` of a saved document, or the bare
 * `elements` of one written before the envelope existed.
 */
function mindmapOf(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.docType !== undefined && json.docType !== MINDMAP_DOC_TYPE) return null;

    const elements = json.content?.elements ?? json.elements;
    if (!elements || typeof elements !== 'object') return null;
    if (!Array.isArray(elements.notes) || !Array.isArray(elements.relations)) return null;

    return elements;
}

/** The middle of a note, from its measured bounds or, failing those, from what was asked for. */
function centreOf(note) {
    const bounds = note?.bounds ?? note?.userBounds;
    if (!Array.isArray(bounds) || typeof bounds[0] !== 'number' || typeof bounds[1] !== 'number') return null;
    return [bounds[0] + (bounds[2] ?? 0) / 2, bounds[1] + (bounds[3] ?? 0) / 2];
}

/**
 * Which end of a relation the others should hang from: the one whose note is closest to where
 * the lines used to meet. The first end when any note is missing or unmeasured — there is then
 * no meeting point to be closest to.
 */
function hubIndex(ends, notesById) {
    const centres = ends.map(end => centreOf(notesById.get(end?.target)));
    if (centres.some(centre => centre === null)) return 0;

    const cx = centres.reduce((sum, [x]) => sum + x, 0) / centres.length;
    const cy = centres.reduce((sum, [, y]) => sum + y, 0) / centres.length;

    let best = 0;
    let bestDistance = Infinity;
    centres.forEach(([x, y], index) => {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    return best;
}

/** The end with any attach point that is not one of the twelve taken off it. */
function withCleanAttachPoint(end) {
    if (!end || typeof end !== 'object') return { end, changed: false };

    const number = end.attachPointNumber;
    if (number === undefined) return { end, changed: false };
    if (Number.isInteger(number) && number >= 0 && number < ATTACH_POINTS) return { end, changed: false };

    const { attachPointNumber, ...clean } = end;
    return { end: clean, changed: true };
}

/**
 * The relations of one mindmap, made binary. Returns the new list and what had to be done to it,
 * or null when there was nothing to do.
 */
function toBinaryRelations(elements) {
    const notesById = new Map(elements.notes.filter(note => note?.id).map(note => [note.id, note]));

    const report = { split: [], dropped: 0, attachPoints: 0 };
    const relations = [];

    for (const relation of elements.relations) {
        if (!relation || !Array.isArray(relation.ends)) {
            relations.push(relation);       // not a relation this migration understands
            continue;
        }

        const ends = relation.ends.map(end => {
            const { end: clean, changed } = withCleanAttachPoint(end);
            if (changed) report.attachPoints++;
            return clean;
        });

        if (ends.length < 2) {
            report.dropped++;
            continue;
        }

        if (ends.length === 2) {
            relations.push({ ...relation, ends });
            continue;
        }

        const hub = ends[hubIndex(ends, notesById)];
        for (const end of ends) {
            if (end === hub) continue;
            relations.push({ ...relation, id: newId('REL'), ends: [{ ...hub, id: newId('END') }, end] });
        }
        report.split.push({ ends: ends.length, hub: hub?.target });
    }

    const changed = report.split.length > 0 || report.dropped > 0 || report.attachPoints > 0;
    return changed ? { relations, report } : null;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V004: making mindmap relations binary in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V004: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [MINDMAP_EXTENSION], ignore);
    let written = 0;
    let split = 0;
    let dropped = 0;
    let attachPoints = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not a mindmap
        }

        const elements = mindmapOf(json);
        if (!elements) continue;

        const result = toBinaryRelations(elements);
        if (!result) continue;

        elements.relations = result.relations;
        saveJson(file, json);
        written++;
        split += result.report.split.length;
        dropped += result.report.dropped;
        attachPoints += result.report.attachPoints;

        const what = [
            ...result.report.split.map(s => `${s.ends} ends around ${s.hub}`),
            ...(result.report.dropped ? [`${result.report.dropped} relation(s) with too few ends dropped`] : []),
            ...(result.report.attachPoints ? [`${result.report.attachPoints} attach point(s) freed`] : [])
        ];
        console.log(`  ${path.relative(root, file)}: ${what.join(', ')}`);
    }

    console.log(`V004: done — ${written} mindmap(s) of ${files.length} rewritten: ${split} relation(s) ` +
        `split into pairs, ${dropped} dropped, ${attachPoints} attach point(s) freed.`);
}

main();
