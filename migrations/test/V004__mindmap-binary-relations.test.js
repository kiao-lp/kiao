/**
 * Tests for V004__mindmap-binary-relations.js.
 *
 *     node --test "migrations/test/V004*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V004__mindmap-binary-relations.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v004-')));
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

/** A note at a point, sized 40 by 20 — enough for the migration to find its middle. */
const note = (id, x, y) => ({
    id, userBounds: [x, y, null, null], bounds: [x, y, 40, 20], content: id, zIndex: 3
});

const end = (target, extra = {}) => ({ id: `END-${target}`, target, ...extra });

const relation = (id, ends, shape = 'CENTROID') => ({ id, shape, ends });

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

// A cluster of three: B sits nearest the middle of the three, so it becomes the hub.
const CLUSTER = [note('NOTE-a', 0, 0), note('NOTE-b', 100, 100), note('NOTE-c', 200, 210)];

test('splits a relation of three ends into a pair per other end', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', CLUSTER,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])]);

    run(root);

    const relations = relationsOf(file);
    assert.strictEqual(relations.length, 2);
    assert.deepStrictEqual(relations.map(r => r.ends.map(e => e.target)),
        [['NOTE-b', 'NOTE-a'], ['NOTE-b', 'NOTE-c']],
        'the note nearest where the lines met is the hub of the star');
});

test('gives every relation it makes its own ids, and keeps the shape and the hub end', () => {
    const root = newStore();
    const hub = end('NOTE-b', { decoration: 'FULL_TRIANGLE', textOver: { content: 'joins' } });
    const file = writeMap(root, 'map.mmap.json', CLUSTER,
        [relation('REL-1', [end('NOTE-a'), hub, end('NOTE-c')], 'RIGHT_ANGLE_1')]);

    run(root);

    const relations = relationsOf(file);
    const ids = relations.flatMap(r => [r.id, ...r.ends.map(e => e.id)]);
    assert.strictEqual(new Set(ids).size, ids.length, 'no id is used twice');
    assert.ok(relations.every(r => r.shape === 'RIGHT_ANGLE_1'), 'the shape survives the split');
    for (const relation of relations) {
        assert.deepStrictEqual(relation.ends[0].decoration, 'FULL_TRIANGLE');
        assert.deepStrictEqual(relation.ends[0].textOver, { content: 'joins' });
    }
});

test('hangs the star off the first end when a note is missing or unmeasured', () => {
    const root = newStore();
    const notes = [note('NOTE-a', 0, 0), note('NOTE-b', 100, 100)];   // NOTE-c is gone
    const file = writeMap(root, 'map.mmap.json', notes,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])]);

    run(root);

    assert.deepStrictEqual(relationsOf(file).map(r => r.ends.map(e => e.target)),
        [['NOTE-a', 'NOTE-b'], ['NOTE-a', 'NOTE-c']]);
});

test('drops a relation of fewer than two ends, which was never drawn', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', CLUSTER, [
        relation('REL-empty', []),
        relation('REL-single', [end('NOTE-a')]),
        relation('REL-pair', [end('NOTE-a'), end('NOTE-b')])
    ]);

    run(root);

    assert.deepStrictEqual(relationsOf(file).map(r => r.id), ['REL-pair']);
});

test('takes off an attach point that is not one of the twelve, and keeps one that is', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', CLUSTER, [
        relation('REL-1', [end('NOTE-a', { attachPointNumber: 99 }), end('NOTE-b', { attachPointNumber: 6 })]),
        relation('REL-2', [end('NOTE-a', { attachPointNumber: 12 }), end('NOTE-c', { attachPointNumber: 0 })])
    ]);

    run(root);

    assert.deepStrictEqual(relationsOf(file).map(r => r.ends.map(e => e.attachPointNumber)),
        [[undefined, 6], [undefined, 0]]);
});

test('reads a mindmap written before the envelope, under a bare elements', () => {
    const root = newStore();
    const file = writeMap(root, 'legacy.mmap.json', CLUSTER,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])], { envelope: false });

    run(root);

    assert.strictEqual(readJson(file).content, undefined, 'the shape of the file is left as it was');
    assert.strictEqual(relationsOf(file).length, 2);
});

test('leaves a store whose relations are already pairs exactly as it was', () => {
    const root = newStore();
    writeMap(root, 'map.mmap.json', CLUSTER, [
        relation('REL-1', [end('NOTE-a'), end('NOTE-b')]),
        relation('REL-2', [end('NOTE-b', { attachPointNumber: 3 }), end('NOTE-c')], 'CONCAVE_UP_L1')
    ]);

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('re-running changes nothing', () => {
    const root = newStore();
    writeMap(root, 'map.mmap.json', CLUSTER,
        [relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])]);

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
        content: { elements: { notes: [], relations: [relation('REL-1', [])] } }
    }, null, 2));
    const notJson = path.join(root, 'broken.mmap.json');
    write(notJson, 'not json at all');

    const before = snapshot(root);
    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('keeps a relation whose ends it does not understand', () => {
    const root = newStore();
    const file = writeMap(root, 'map.mmap.json', CLUSTER, [
        { id: 'REL-odd', shape: 'CENTROID' },
        relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])
    ]);

    run(root);

    assert.deepStrictEqual(relationsOf(file)[0], { id: 'REL-odd', shape: 'CENTROID' });
});

test('honours what the store declares is not content', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nsamples\n');
    const sample = path.join(root, 'samples', 'map.mmap.json');
    write(sample, mindmap(CLUSTER, [relation('REL-1', [end('NOTE-a'), end('NOTE-b'), end('NOTE-c')])]));

    const before = read(sample);
    run(root);

    assert.strictEqual(read(sample), before, 'the excluded mindmap is left where it is');
});

test('a store holding no mindmap is left exactly as it was', () => {
    const root = newStore();
    write(path.join(root, 'README.md'), '# Just a folder\n');
    write(path.join(root, 'data.json'), JSON.stringify({ relations: [{ ends: [1, 2, 3] }] }, null, 2));

    const before = snapshot(root);
    const out = run(root);

    assert.deepStrictEqual(snapshot(root), before);
    assert.match(out, /0 mindmap\(s\) of 0 rewritten/);
});
