/**
 * V005 — a mindmap relation is a straight line, and carries no text.
 *
 *     "shape": "CONCAVE_UP_L2"          ->   removed
 *     "textOver": { "content": "…" }    ->   removed
 *     "textUnder": { "content": "…" }   ->   removed
 *
 * A relation used to choose between nine routings — the straight line, two elbows and six arcs —
 * and each of its two ends could carry a line of rich text above and below it. Both are gone from
 * `mindmap-edit`: every relation is drawn straight between its notes, and what a relation means
 * is said in a note. The fields left behind are read by nothing, so they are taken off rather
 * than left to accumulate in files as the record of an editor that no longer exists.
 *
 * The file format is otherwise unchanged, so `docTypeVersion` stays at 1 and a document holding
 * none of these fields is not written at all.
 *
 * ## The text is not kept
 *
 * There is nowhere to keep it: an end has no other text, and a note put in its place would be a
 * note the author did not draw, at a position this script would have to invent. So every text it
 * removes is **printed with the file it came from**, which is the only record an operator has of
 * what a startup took out, and enough to write the labels back as notes by hand.
 *
 * ## What it will not touch
 *
 * A note's own `shape` — `ellipse`, `rectangle`, `diamond` — is a different field on a different
 * element and is left exactly as it is. Only the objects under `elements.relations` are rewritten.
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a file is a mindmap because it parses as JSON carrying `elements.notes`
 * and `elements.relations` arrays — either bare or under `content`, both shapes being in stores —
 * and, when it declares a `docType` at all, because that is `QuickMindmap`. A `.mmap.json` that
 * is a fixture or an export of something else parses to another shape and is left alone.
 *
 * Re-running is a no-op: a store whose relations carry none of the three fields is not written to.
 */

const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const MINDMAP_EXTENSION = '.mmap.json';
const MINDMAP_DOC_TYPE = 'QuickMindmap';

/** What a relation, and each of its ends, no longer has any use for. */
const RELATION_FIELD = 'shape';
const END_TEXT_FIELDS = ['textOver', 'textUnder'];

/** How much of a removed text is printed, so one long note cannot bury the rest of the report. */
const TEXT_EXCERPT = 60;

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

/** One line of a removed text, short enough to read in a startup log. */
function excerpt(text) {
    const content = String(text?.content ?? '').replace(/\s+/g, ' ').trim();
    return content.length > TEXT_EXCERPT ? `${content.slice(0, TEXT_EXCERPT)}…` : content;
}

/** The end with its two texts taken off, and whatever they said. */
function withoutEndText(end) {
    if (!end || typeof end !== 'object') return { end, texts: [] };

    const texts = END_TEXT_FIELDS.filter(field => field in end).map(field => excerpt(end[field]));
    if (texts.length === 0) return { end, texts };

    const clean = { ...end };
    for (const field of END_TEXT_FIELDS) delete clean[field];
    return { end: clean, texts };
}

/**
 * The relations of one mindmap, with the routing and the end texts taken off. Returns the new
 * list and what had to be removed from it, or null when there was nothing to do.
 */
function toStraightRelations(elements) {
    const report = { shapes: 0, texts: [] };

    const relations = elements.relations.map(relation => {
        if (!relation || typeof relation !== 'object') return relation;

        const straight = { ...relation };
        let changed = false;

        if (RELATION_FIELD in straight) {
            delete straight[RELATION_FIELD];
            report.shapes++;
            changed = true;
        }

        if (Array.isArray(straight.ends)) {
            straight.ends = straight.ends.map(end => {
                const { end: clean, texts } = withoutEndText(end);
                report.texts.push(...texts);
                if (texts.length > 0) changed = true;
                return clean;
            });
        }

        return changed ? straight : relation;   // an untouched relation keeps its own object
    });

    const changed = report.shapes > 0 || report.texts.length > 0;
    return changed ? { relations, report } : null;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V005: straightening mindmap relations in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V005: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [MINDMAP_EXTENSION], ignore);
    let written = 0;
    let shapes = 0;
    let texts = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not a mindmap
        }

        const elements = mindmapOf(json);
        if (!elements) continue;

        const result = toStraightRelations(elements);
        if (!result) continue;

        elements.relations = result.relations;
        saveJson(file, json);
        written++;
        shapes += result.report.shapes;
        texts += result.report.texts.length;

        const name = path.relative(root, file);
        console.log(`  ${name}: ${result.report.shapes} shape(s) removed, ` +
            `${result.report.texts.length} text(s) removed`);
        for (const text of result.report.texts) {
            console.log(`    text removed from ${name}: "${text}"`);
        }
    }

    console.log(`V005: done — ${written} mindmap(s) of ${files.length} rewritten: ${shapes} relation shape(s) ` +
        `and ${texts} end text(s) removed.`);
}

main();
