/**
 * Copy to V<NNN>__<description>.js; use the next unique version (ascending order).
 * Read README.md first. Applied migrations are immutable.
 *
 * Runner: node <script> <absolute-data-root>, cwd=data root;
 * env: KIAO_DATA_ROOT, KIAO_MIGRATION_VERSION, KIAO_MIGRATION_SOURCE,
 * KIAO_MIGRATION_LIB (the base source's shared helpers). Exit 0 records success in
 * <state-path>/files-migrations.json (default state path: <data-root>/.kiao-config).
 * Throw or exit nonzero on failure; startup aborts by default.
 *
 * The store can be any folder. Select by document shape, never blind-replace;
 * skip unrelated/already-migrated records and keep reruns byte-identical.
 * Use kiao-fs helpers; custom walks must honour loadIgnore() exclusions.
 * For moves, use ./lib/link-fix.js. Log changed paths/counts.
 * If content identity is uncertain, ask for confirmation with the paths first.
 */

const path = require('path');
const helpers = process.env.KIAO_MIGRATION_LIB || path.join(__dirname, 'lib');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require(path.join(helpers, 'kiao-fs'));

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`migration: operating on ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`migration: honouring ${ignore.patterns.length} .kiao-files rule(s): ` +
            ignore.patterns.join(' '));
    }

    const files = scan(root, ['.mmap.json'], ignore);
    let changed = 0;
    for (const file of files) {
        const json = loadJson(file);

        // Validate shape and skip already-migrated records before writing.

        void json; // Remove placeholders when implementing the transform.
        void saveJson;
    }

    console.log(`migration: done — ${changed} file(s) changed.`);
}

main();
