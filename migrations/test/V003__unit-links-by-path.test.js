/**
 * Tests for V003__unit-links-by-path.js.
 *
 *     node --test "migrations/test/V003*.test.js"
 *
 * The migration is run the way the runner runs it — a child process, given the data root as argv[2]
 * — because half of what is being asserted is what it refuses to do, and a script that is required
 * rather than spawned could not be trusted to have refused for the right reason.
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

const MIGRATION = path.join(__dirname, '..', 'V003__unit-links-by-path.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v003-')));
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

/** Every file of the store with its bytes, for the assertion that a run changed nothing. */
function snapshot(root) {
    const out = {};
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out[path.relative(root, full)] = read(full);
        }
    };
    walk(root);
    return out;
}

/** A unit document as the store held it before this migration. */
function unit(docId, { title = docId, members = undefined, version = 19 } = {}) {
    const content = { title, lang: 'EN', contents: [] };
    if (members !== undefined) content.members = members;
    return JSON.stringify({
        content,
        docType: 'Unit',
        docTypeVersion: version,
        docId,
        createdAt: '2026-01-08T08:43:33.260Z',
        updatedAt: '2026-01-08T08:45:34.445Z',
    }, null, 2);
}

/** Writes a unit at the place a unit has always been created, and answers its document's path. */
function writeUnit(root, docId, options) {
    const file = path.join(root, 'units', docId, `${docId}.mlunit.json`);
    write(file, unit(docId, options));
    return file;
}

const members = (file) => readJson(file).content.members;

test('a sommaire’s members become the paths of the documents they name', () => {
    const root = newStore();
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: ['first000000000000000000', 'second00000000000000000'] });
    writeUnit(root, 'first000000000000000000');
    writeUnit(root, 'second00000000000000000');

    const log = run(root);

    assert.deepStrictEqual(members(sommaire), [
        '/units/first000000000000000000/first000000000000000000.mlunit.json',
        '/units/second00000000000000000/second00000000000000000.mlunit.json',
    ]);
    assert.strictEqual(readJson(sommaire).docTypeVersion, 20);
    assert.match(log, /2 member\(s\) by path/);
});

test('a member the store cannot resolve is left as it is, and said out loud', () => {
    const root = newStore();
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: ['gone00000000000000000000', 'first000000000000000000'] });
    writeUnit(root, 'first000000000000000000');

    const log = run(root);

    assert.deepStrictEqual(members(sommaire), [
        'gone00000000000000000000',
        '/units/first000000000000000000/first000000000000000000.mlunit.json',
    ]);
    assert.match(log, /member "gone00000000000000000000"/);
    assert.match(log, /no unit of this store/);
    assert.match(log, /1 reference\(s\) left unresolved/);
});

test('a member already written as a path, and the mark of a deleted one, are not touched', () => {
    const root = newStore();
    const kept = '/units/first000000000000000000/first000000000000000000.mlunit.json';
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: [kept, '///deleted///'], version: 20 });
    writeUnit(root, 'first000000000000000000', { version: 20 });

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(members(sommaire), [kept, '///deleted///']);
    assert.deepStrictEqual(snapshot(root), before);
});

test('a unit still at 19 is stamped 20 even when it names nobody', () => {
    const root = newStore();
    const lone = writeUnit(root, 'lone00000000000000000000');

    const log = run(root);

    assert.strictEqual(readJson(lone).docTypeVersion, 20);
    assert.match(log, /version only/);
});

test('a unit:: link in a note becomes the path of the unit it names', () => {
    const root = newStore();
    writeUnit(root, 'first000000000000000000');
    write(path.join(root, 'docs', 'plan.md'),
        'Start with [the first](unit::first000000000000000000).\n');

    run(root);

    assert.strictEqual(read(path.join(root, 'docs', 'plan.md')),
        'Start with [the first](unit::/units/first000000000000000000/first000000000000000000.mlunit.json).\n');
});

test('a unit:: link naming nothing, and a word that merely ends in one, are left alone', () => {
    const root = newStore();
    writeUnit(root, 'first000000000000000000');
    const note = path.join(root, 'docs', 'plan.md');
    write(note, 'Gone: [x](unit::gone00000000000000000000), and myunit::first000000000000000000 is a word.\n');

    const before = read(note);
    const log = run(root);

    assert.strictEqual(read(note), before);
    assert.match(log, /unit::gone00000000000000000000 in docs\/plan\.md is no unit of this store/);
});

test('running it again leaves every file byte-identical', () => {
    const root = newStore();
    writeUnit(root, 'sommaire00000000000000', { members: ['first000000000000000000', 'gone00000000000000000000'] });
    writeUnit(root, 'first000000000000000000');
    write(path.join(root, 'docs', 'plan.md'), '[a](unit::first000000000000000000)\n');

    run(root);
    const after = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), after);
});

test('a folder the store declares is not content is neither indexed nor rewritten', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nsamples\n');
    const sample = path.join(root, 'samples', 'units', 'first000000000000000000',
        'first000000000000000000.mlunit.json');
    write(sample, unit('first000000000000000000'));
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: ['first000000000000000000'] });

    const before = read(sample);
    run(root);

    assert.strictEqual(read(sample), before, 'the excluded document is left where it is');
    assert.deepStrictEqual(members(sommaire), ['first000000000000000000'],
        'and the unit it holds is nothing this store can address');
});

test('a store holding no KIAO document is left exactly as it was', () => {
    const root = newStore();
    write(path.join(root, 'src', 'unit.md'), 'The unit:: scheme is described here.\n');
    write(path.join(root, 'package.json'), '{\n  "name": "something-else"\n}\n');
    write(path.join(root, 'units', 'sample.mlunit.json'), '{\n  "docType": "Fixture"\n}\n');

    const before = snapshot(root);
    const log = run(root);

    assert.deepStrictEqual(snapshot(root), before);
    assert.match(log, /no unit document in this store/);
});

test('a unit whose folder is not under units/ is addressed by where it actually is', () => {
    const root = newStore();
    const away = path.join(root, 'archive', '2025', 'first000000000000000000.mlunit.json');
    write(away, unit('first000000000000000000'));
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: ['first000000000000000000'] });

    run(root);

    assert.deepStrictEqual(members(sommaire),
        ['/archive/2025/first000000000000000000.mlunit.json']);
});

test('a docId two documents claim resolves to neither', () => {
    const root = newStore();
    write(path.join(root, 'a', 'first000000000000000000.mlunit.json'), unit('first000000000000000000'));
    write(path.join(root, 'b', 'first000000000000000000.mlunit.json'), unit('first000000000000000000'));
    const sommaire = writeUnit(root, 'sommaire00000000000000', { members: ['first000000000000000000'] });

    const log = run(root);

    assert.deepStrictEqual(members(sommaire), ['first000000000000000000']);
    assert.match(log, /claimed by/);
});
