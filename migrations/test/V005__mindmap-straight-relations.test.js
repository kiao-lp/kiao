/**
 * Tests for V005__mindmap-straight-relations.js.
 *
 *     node --test "migrations/test/V005*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V005__mindmap-straight-relations.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v005-')));
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

/** A note at a point, drawn as an ellipse: its own `shape` is a different field, and stays. */
const note = (id, x, y) => ({
    id, userBounds: [x, y, null, null], bounds: [x, y, 40, 20], content: id, zIndex: 3, shape: 'ellipse'
});

const end = (target, extra = {}) => ({ id: `END-${target}`, target, ...extra });

const relation = (id, ends, extra = {}) => ({ id, ...extra, ends });

/** A mindmap document as the store holds one. */
function mindmap(notes, relations, { envelope = true } = {}) {
    const content = { elements: { notes, relations } };
    const document = envelope ? {
        content,
        docType: 'QuickMindmap',
        docId: 'd57ea35b-6d0b-4f05-9cc8-bd20417d88ee',
        docTypeVersion: 1,
        createdAt: '2026-01-21T06:40:44.241Z'
    } : content;
    return JSON.stringify(document, null, 2);
}

const writeMap = (root, name, notes, relations, options) => {
    const file = path.join(root, name);
    write(file, mindmap(notes, relations, options));
    return file;
};

const relationsOf = (file) => {
    const json = readJson(file);
    return (json.content?.elements ?? json.elements).relations;
};

const PAIR = [note('NOTE-a', 0, 0), note('NOTE-b', 100, 100)];

test('takes the routing off every relation', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', PAIR, [
        relation('REL-1', [end('NOTE-a'), end('NOTE-b')], { shape: 'CENTROID' }),
        relation('REL-2', [end('NOTE-a'), end('NOTE-b')], { shape: 'CONCAVE_UP_L2' })
    ]);

    run(root);

    assert.deepStrictEqual(relationsOf(file).map(r => r.shape), [undefined, undefined]);
});

test('takes the text off both ends, and keeps everything else on them', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', PAIR, [relation('REL-1', [
        end('NOTE-a', { textOver: { content: 'declares' }, attachPointNumber: 6 }),
        end('NOTE-b', { textUnder: { content: 'is declared by', fontSize: 14 }, decoration: 'FULL_TRIANGLE' })
    ], { shape: 'CENTROID' })]);

    run(root);

    assert.deepStrictEqual(relationsOf(file)[0].ends, [
        { id: 'END-NOTE-a', target: 'NOTE-a', attachPointNumber: 6 },
        { id: 'END-NOTE-b', target: 'NOTE-b', decoration: 'FULL_TRIANGLE' }
    ]);
});

test('prints every text it removed, with the file it came from', () => {
    const root = newStore();
    writeMap(root, 'map.mmap.json', PAIR, [relation('REL-1', [
        end('NOTE-a', { textOver: { content: 'declares' } }),
        end('NOTE-b', { textUnder: { content: 'is declared by' } })
    ])]);

    const output = run(root);

    assert.match(output, /text removed from map\.mmap\.json: "declares"/);
    assert.match(output, /text removed from map\.mmap\.json: "is declared by"/);
});

test('leaves a note drawn as an ellipse or a diamond alone: its shape is its own', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', PAIR,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b')], { shape: 'CENTROID' })]);

    run(root);

    const notes = (readJson(file).content.elements).notes;
    assert.deepStrictEqual(notes.map(n => n.shape), ['ellipse', 'ellipse']);
});

test('reads a mindmap written before the envelope, under a bare elements', () => {
    const root = newStore();
    const file = writeMap(root, 'legacy.mmap.json', PAIR,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b')], { shape: 'RIGHT_ANGLE_1' })], { envelope: false });

    run(root);

    assert.strictEqual(readJson(file).content, undefined, 'the shape of the file is left as it was');
    assert.strictEqual(relationsOf(file)[0].shape, undefined);
});

test('takes the routing off a relation whose ends it does not understand', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', PAIR, [{ id: 'REL-odd', shape: 'CENTROID' }]);

    run(root);

    assert.deepStrictEqual(relationsOf(file)[0], { id: 'REL-odd' });
});

test('leaves a store whose relations are already straight exactly as it was', () => {
    const root = newStore();
    writeMap(root, 'map.mmap.json', PAIR, [
        relation('REL-1', [end('NOTE-a'), end('NOTE-b', { decoration: 'FULL_TRIANGLE' })]),
        relation('REL-2', [end('NOTE-a', { attachPointNumber: 3 }), end('NOTE-b')])
    ]);

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('re-running changes nothing', () => {
    const root = newStore();
    writeMap(root, 'map.mmap.json', PAIR, [relation('REL-1', [
        end('NOTE-a', { textOver: { content: 'declares' } }), end('NOTE-b')
    ], { shape: 'CONCAVE_DOWN_L3' })]);

    run(root);
    const afterFirst = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), afterFirst);
});

test('leaves alone a .mmap.json that is not a mindmap', () => {
    const root = newStore();
    const foreign = path.join(root, 'export.mmap.json');
    write(foreign, JSON.stringify({
        docType: 'SomebodyElse',
        content: { elements: { notes: [], relations: [{ id: 'REL-1', shape: 'CENTROID', ends: [] }] } }
    }, null, 2));
    const notJson = path.join(root, 'broken.mmap.json');
    write(notJson, 'not json at all');

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('honours what the store declares is not content', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nsamples\n');
    const sample = path.join(root, 'samples', 'map.mmap.json');
    write(sample, mindmap(PAIR, [relation('REL-1', [end('NOTE-a'), end('NOTE-b')], { shape: 'CENTROID' })]));

    const before = read(sample);
    run(root);

    assert.strictEqual(read(sample), before, 'the excluded mindmap is left where it is');
});

test('a store holding no mindmap is left exactly as it was', () => {
    const root = newStore();
    write(path.join(root, 'notes.md'), '# just a folder\n');

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});
