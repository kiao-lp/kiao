/**
 * Tests for V017__values-object-field.js.
 *
 *     node --test "migrations/test/V017*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V017__values-object-field.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v017-')));
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

const valuesOf = (root, name) => path.join(root, 'kiao-user-config', 'values', name);
const read = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(read(file));

test('moves the custom fields under object, type and value staying at the root', () => {
    const root = newStore();
    write(valuesOf(root, 'topics.json'), JSON.stringify([
        {
            type: 'TopicToLearn', value: 'Apache Kafka', folderName: 'Apache Kafka',
            objective: 'use it in architecture reviews',
        },
    ]));

    const out = run(root);

    assert.deepStrictEqual(readJson(valuesOf(root, 'topics.json')), [
        {
            type: 'TopicToLearn',
            value: 'Apache Kafka',
            object: { folderName: 'Apache Kafka', objective: 'use it in architecture reviews' },
        },
    ]);
    assert.deepStrictEqual(Object.keys(readJson(valuesOf(root, 'topics.json'))[0]),
        ['type', 'value', 'object']);
    assert.match(out, /1 entry grouped/);
});

test('keeps the heap metadata at the root', () => {
    const root = newStore();
    write(valuesOf(root, 'topics.json'), JSON.stringify([
        { type: 't', value: 'v', code: 'EW1', __pinned: true, __pinnedAt: 123 },
    ]));

    run(root);

    assert.deepStrictEqual(readJson(valuesOf(root, 'topics.json')), [
        { type: 't', value: 'v', object: { code: 'EW1' }, __pinned: true, __pinnedAt: 123 },
    ]);
});

test('merges into an object already there, the flat key winning on a shared name', () => {
    const root = newStore();
    write(valuesOf(root, 'topics.json'), JSON.stringify([
        { type: 't', value: 'v', code: 'EW1', object: { code: 'OLD', region: 'eu' } },
    ]));

    run(root);

    assert.deepStrictEqual(readJson(valuesOf(root, 'topics.json')), [
        { type: 't', value: 'v', object: { code: 'EW1', region: 'eu' } },
    ]);
});

test('leaves grouped entries and bare type-and-value ones byte-identical', () => {
    const root = newStore();
    const before = '[{"type":"t","value":"v","object":{"code":"EW1"}},'
        + '{"type":"u","value":"w"}]\n';
    write(valuesOf(root, 'topics.json'), before);

    run(root);

    assert.strictEqual(read(valuesOf(root, 'topics.json')), before);
});

test('a second run changes nothing', () => {
    const root = newStore();
    write(valuesOf(root, 'topics.json'), JSON.stringify([
        { type: 't', value: 'v', code: 'EW1' },
    ]));

    run(root);
    const after = read(valuesOf(root, 'topics.json'));
    run(root);

    assert.strictEqual(read(valuesOf(root, 'topics.json')), after);
});

test('leaves entries it cannot identify alone, and says so where it refuses one', () => {
    const root = newStore();
    const entries = [
        { type: 't', code: 'EW1' },
        { value: 'v', code: 'EW1' },
        'a string',
        null,
        { type: 't', value: 'v', object: 'a field literally named object', code: 'EW1' },
        { type: 't', value: 'v', code: 'EW1' },
    ];
    write(valuesOf(root, 'topics.json'), JSON.stringify(entries));

    const out = run(root);

    const after = readJson(valuesOf(root, 'topics.json'));
    assert.deepStrictEqual(after.slice(0, 5), entries.slice(0, 5));
    assert.deepStrictEqual(after[5], { type: 't', value: 'v', object: { code: 'EW1' } });
    assert.match(out, /non-object `object`/);
});

test('leaves files holding no array, or no JSON at all, alone', () => {
    const root = newStore();
    write(valuesOf(root, 'single.json'), '{"type":"t","value":"v"}\n');
    write(valuesOf(root, 'broken.json'), '{"type":\n');

    const out = run(root);

    assert.strictEqual(read(valuesOf(root, 'single.json')), '{"type":"t","value":"v"}\n');
    assert.strictEqual(read(valuesOf(root, 'broken.json')), '{"type":\n');
    assert.match(out, /single\.json.*no array/);
    assert.match(out, /broken\.json.*does not parse/);
});

test('does nothing where there is no values folder at all', () => {
    const root = newStore();

    run(root);

    assert.strictEqual(fs.existsSync(path.join(root, 'kiao-user-config', 'values')), false);
});

test('reads the folder alone, never below it', () => {
    const root = newStore();
    const nested = path.join(root, 'kiao-user-config', 'values', 'nested', 'topics.json');
    write(nested, JSON.stringify([{ type: 't', value: 'v', code: 'EW1' }]));

    run(root);

    assert.deepStrictEqual(readJson(nested), [{ type: 't', value: 'v', code: 'EW1' }]);
});

test('leaves values the store declares out of bounds alone', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nkiao-user-config\n');
    write(valuesOf(root, 'topics.json'), JSON.stringify([{ type: 't', value: 'v', code: 'EW1' }]));

    run(root);

    assert.deepStrictEqual(readJson(valuesOf(root, 'topics.json')),
        [{ type: 't', value: 'v', code: 'EW1' }]);
});

test('leaves one file the store declares out of bounds alone, migrating its neighbour', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nkiao-user-config/values/kept.json\n');
    write(valuesOf(root, 'kept.json'), JSON.stringify([{ type: 't', value: 'v', code: 'EW1' }]));
    write(valuesOf(root, 'topics.json'), JSON.stringify([{ type: 't', value: 'v', code: 'EW1' }]));

    run(root);

    assert.deepStrictEqual(readJson(valuesOf(root, 'kept.json')),
        [{ type: 't', value: 'v', code: 'EW1' }]);
    assert.deepStrictEqual(readJson(valuesOf(root, 'topics.json')),
        [{ type: 't', value: 'v', object: { code: 'EW1' } }]);
});
