/**
 * V014 — exercises are flat: an inner title (`## …`, `### …`, …) is now a plain text line.
 *
 *     ## La pluie   ->  La pluie
 *
 * Exercises used to nest sections under `#` levels, and `##` opened a sub-section. They do not any
 * more: a set is one list of paragraphs, and a `#` line is an ordinary drilled line with title
 * styling — the first one is the audio title by convention, not by structure. The lexers (the
 * `mlscript` package and `kiao-mlscript-lib`) read two or more `#` as plain text already, so this
 * only strips the dead prefix from the stored files.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that:
 *
 *  - A file is an exercise set because it is a `.mlex.json` that parses as JSON carrying
 *    `docType: 'UnitExercises'` and a `content.source` / `content.target` holding an `exercises`
 *    string. Anything else is left alone.
 *  - Each side's text is rewritten line by line, the way the lexers read it: the leading run of
 *    prefix characters (`~`, `^`, `#`, space) is taken, and when it holds two `#` or more every
 *    `#` in it goes. `## Foo` becomes `Foo`, `^## Foo` becomes `^ Foo` — the vocabulary mark is
 *    not a title and stays. A single `#` is the title and stays too.
 *  - A set with no inner title is left byte-identical, which is also what makes a second run
 *    a no-op.
 *  - No schema changes, so `docTypeVersion` is untouched: this rewrites text, not shape.
 */

const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const MLEX_EXTENSION = '.mlex.json';
const MLEX_DOC_TYPE = 'UnitExercises';
const MLEX_SIDES = ['source', 'target'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isExercisesDocument = (json) =>
    isObject(json)
    && json.docType === MLEX_DOC_TYPE
    && isObject(json.content);

/** One line with its inner-title prefix stripped, or the line itself when it has none. */
function flattenLine(line) {
    const run = line.match(/^[~^# ]+/);
    if (!run) return line;
    const sharps = (run[0].match(/#/g) || []).length;
    if (sharps < 2) return line;
    const stripped = run[0].replaceAll('#', '');
    // What is left of the run is spacing around the title marks — unless it still carries a
    // real prefix (`^`, `~`), in which case it stays.
    const newRun = /[~^]/.test(stripped) ? stripped : '';
    return newRun + line.slice(run[0].length);
}

/** The side's text with every inner title flattened. Returns null when nothing changed. */
function flattenText(text) {
    if (typeof text !== 'string') return null;
    const lines = text.split('\n');
    let changed = 0;
    const flattened = lines.map((line) => {
        const next = flattenLine(line);
        if (next !== line) changed++;
        return next;
    });
    return changed === 0 ? null : { text: flattened.join('\n'), changed };
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V014: flattening inner titles of exercise sets in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V014: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [MLEX_EXTENSION], ignore);
    let written = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not an exercise set
        }

        if (!isExercisesDocument(json)) continue;

        let changed = 0;
        for (const side of MLEX_SIDES) {
            const content = json.content[side];
            if (!isObject(content)) continue;
            const flattened = flattenText(content.exercises);
            if (!flattened) continue;
            content.exercises = flattened.text;
            changed += flattened.changed;
        }

        if (changed === 0) continue;
        saveJson(file, json);
        written++;
        console.log(`  ${path.relative(root, file)}: ${changed} line(s) flattened`);
    }

    console.log(`V014: done — ${written} set(s) of ${files.length} rewritten.`);
}

main();
