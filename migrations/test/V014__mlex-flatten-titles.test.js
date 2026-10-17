/**
 * Tests for V014__mlex-flatten-titles.js.
 *
 *     node --test "migrations/test/V014*.test.js"
 *
 * The migration is run the way the runner runs it — a child process, given the data root as
 * argv[2] — because half of what is being asserted is what it refuses to do, and a script that is
 * required rather than spawned could not be trusted to have refused for the right reason.
 *
 * It lives in this subdirectory because the runner discovers `V<NNN>__<name>.js` in the folder
 * above and would run a test file against the real store.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIGRATION = path.join(__dirname, '..', 'V014__mlex-flatten-titles.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v014-')));
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

/** Runs the migration the way the runner does, and returns everything it printed. */
function run(root) {
    const res = spawnSync(process.execPath, [MIGRATION, root], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `migration exited ${res.status}: ${res.stderr}`);
    return res.stdout + res.stderr;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(read(file));

/** An exercise set as the store holds one: the envelope, and a text per side. */
const set = (source, target) => JSON.stringify({
    docType: 'UnitExercises',
    docTypeVersion: 4,
    docId: 'set-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: {
        title: 'Salutations',
        source: { lang: 'FR', exercises: source },
        target: { lang: 'EN', exercises: target },
    },
}, null, 2);

test('turns inner titles into plain lines on both sides, and keeps the title', () => {
    const root = newStore();
    const file = path.join(root, 'units', 'Salutations', 'exercices.mlex.json');
    write(file, set(
        '^ lecture\n# La lecture\nIl lit.\n\n^ pluie\n## La pluie\nIl chante.\n### Encore',
        '^ reading\n# Reading\nHe reads.\n\n^ rain\n## The rain\nHe sings.\n#### More',
    ));

    run(root);

    const { content } = readJson(file);
    assert.strictEqual(content.source.exercises,
        '^ lecture\n# La lecture\nIl lit.\n\n^ pluie\nLa pluie\nIl chante.\nEncore');
    assert.strictEqual(content.target.exercises,
        '^ reading\n# Reading\nHe reads.\n\n^ rain\nThe rain\nHe sings.\nMore');
});

test('keeps the other prefixes of a flattened line, and its attributes', () => {
    const root = newStore();
    const file = path.join(root, 'exercices.mlex.json');
    write(file, set(
        '^## Motte // {"pinyin": "x"}\n~## Optionnel\n##Seul',
        '^## Clod\n~## Optional\n##Alone',
    ));

    run(root);

    const { content } = readJson(file);
    assert.strictEqual(content.source.exercises, '^ Motte // {"pinyin": "x"}\n~ Optionnel\nSeul');
    assert.strictEqual(content.target.exercises, '^ Clod\n~ Optional\nAlone');
});

test('leaves a set with no inner title byte for byte, so a second run is a no-op', () => {
    const root = newStore();
    const file = path.join(root, 'exercices.mlex.json');
    const before = set('^ lecture\n# La lecture\nIl lit.', '^ reading\n# Reading\nHe reads.');
    write(file, before);

    run(root);

    assert.strictEqual(read(file), before);
});

test('leaves a document that is not an exercise set alone', () => {
    const root = newStore();
    const file = path.join(root, 'not-a-set.mlex.json');
    const before = JSON.stringify({ docType: 'KiaoMindmap', content: { notes: [] } }, null, 2);
    write(file, before);

    run(root);

    assert.strictEqual(read(file), before);
});

test('leaves malformed JSON alone instead of failing the run', () => {
    const root = newStore();
    const file = path.join(root, 'broken.mlex.json');
    write(file, '{ not json');
    const other = path.join(root, 'ok.mlex.json');
    write(other, set('## Titre', '## Title'));

    run(root);

    assert.strictEqual(read(file), '{ not json');
    assert.strictEqual(readJson(other).content.source.exercises, 'Titre');
});
