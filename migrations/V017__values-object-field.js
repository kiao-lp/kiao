/**
 * V017 — a value's custom fields move under `object`.
 *
 *     { "type": "TopicToLearn", "value": "Apache Kafka",
 *       "folderName": "Apache Kafka", "objective": "..." }
 *  -> { "type": "TopicToLearn", "value": "Apache Kafka",
 *       "object": { "folderName": "Apache Kafka", "objective": "..." } }
 *
 * A value provider used to mix its custom fields with `type` and `value` at the root. The fields
 * now live grouped under `object`, so the two reserved keys never mix with what a template reads.
 * The placeholders say the same as before — `${topic:TopicToLearn.objective}` — the dashboard
 * resolving a field at the root or under `object` indifferently.
 *
 * ## What it will and will not touch
 *
 * Only the `*.json` files directly inside `kiao-user-config/values/`, which is exactly what the
 * dashboard loads (one folder listing, no recursion), and only when the store does not declare
 * them out of bounds for `[migration]` — like every migration:
 *
 *  - A file holds values because it parses as a JSON array whose entries carry a string `type`
 *    and a string `value`. Anything else — unparseable, not an array, entries without both — is
 *    left alone and named: the loader ignores a non-array file the same way.
 *  - Every other root key of an entry moves under `object`, in the order it held, after whatever
 *    `object` already holds. `type`, `value` and the heap's own `__pinned` / `__pinnedAt` stay at
 *    the root. Where a flat key and `object` hold the same name, the flat one wins — the dashboard
 *    reads the root first, so what it read before is what it reads after.
 *  - An entry already grouped, or holding no custom field at all (`{ type, value }` alone), is
 *    left byte-identical, which is also what makes a second run a no-op.
 *  - An entry whose `object` is something other than a plain object — a custom field literally
 *    named `object` — is left alone and named: grouping it would need a person.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, loadJson, saveJson } = require('./lib/kiao-fs');

const VALUES_DIR = path.join('kiao-user-config', 'values');

const AT_ROOT = new Set(['type', 'value', 'object', '__pinned', '__pinnedAt']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Whether the entry is a value provider at all: an object with a string type and value. */
function isValue(entry) {
    return isObject(entry) && typeof entry.type === 'string' && typeof entry.value === 'string';
}

/**
 * The entry with its custom fields grouped. Answers `{ changed: false }` where there is nothing
 * to move — not a value, already grouped, or no custom field — and names the one shape that is
 * refused rather than moved.
 */
function migrateEntry(entry) {
    if (!isValue(entry)) return { changed: false };
    if ('object' in entry && !isObject(entry.object)) {
        return { changed: false, skipped: 'holds a non-object `object`' };
    }
    const flat = Object.keys(entry).filter((key) => !AT_ROOT.has(key));
    if (flat.length === 0) return { changed: false };
    // After whatever `object` already holds, the flat keys winning on a name both hold — the
    // dashboard reads the root first.
    const grouped = { ...(isObject(entry.object) ? entry.object : {}) };
    for (const key of flat) grouped[key] = entry[key];
    const next = { type: entry.type, value: entry.value, object: grouped };
    for (const key of ['__pinned', '__pinnedAt']) {
        if (key in entry) next[key] = entry[key];
    }
    return { changed: true, entry: next };
}

const entriesWord = (count) => (count === 1 ? '1 entry' : `${count} entries`);

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V017: grouping the custom fields of config values in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V017: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const dir = path.join(root, VALUES_DIR);
    if (!fs.existsSync(dir)) {
        console.log('V017: done — no kiao-user-config/values, nothing to do.');
        return;
    }
    if (ignore.ignores(VALUES_DIR)) {
        console.log('V017: done — values is out of bounds for [migration], left alone.');
        return;
    }

    const files = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(dir, entry.name))
        .sort();
    let written = 0;
    let moved = 0;
    for (const file of files) {
        const rel = path.relative(root, file);
        if (ignore.ignores(rel)) {
            console.log(`V017: ${rel} is out of bounds for [migration], left alone.`);
            continue;
        }
        let json;
        try {
            json = loadJson(file);
        } catch {
            console.log(`V017: ${rel} does not parse as JSON, left alone.`);
            continue;
        }
        if (!Array.isArray(json)) {
            console.log(`V017: ${rel} holds no array, left alone.`);
            continue;
        }
        let changed = 0;
        const next = json.map((entry) => {
            const { changed: did, entry: grouped, skipped } = migrateEntry(entry);
            if (skipped) console.log(`V017: ${rel}: an entry ${skipped}, left alone.`);
            if (did) changed++;
            return did ? grouped : entry;
        });
        if (changed === 0) continue;
        saveJson(file, next);
        written++;
        moved += changed;
        console.log(`V017: ${rel}: ${entriesWord(changed)} grouped.`);
    }

    console.log(`V017: done — ${entriesWord(moved)} grouped in ${written} of ${files.length} file(s).`);
}

main();
