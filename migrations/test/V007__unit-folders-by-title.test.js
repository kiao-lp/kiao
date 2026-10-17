/**
 * Tests for V007__unit-folders-by-title.js.
 *
 *     node --test "migrations/test/V007*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V007__unit-folders-by-title.js');

function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v007-')));
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

function run(root) {
    const res = spawnSync(process.execPath, [MIGRATION, root], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `migration exited ${res.status}: ${res.stderr}`);
    return res.stdout + res.stderr;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(read(file));
const exists = (file) => fs.existsSync(file);

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

/** Writes a unit at `folder`, and returns its document path from the store root. */
function unit(root, folder, docId, { title = docId, members, contents = [] } = {}) {
    const content = { title, lang: 'EN', contents };
    if (members) content.members = members;
    const rel = `${folder}/${docId}.mlunit.json`;
    write(path.join(root, rel), JSON.stringify({
        docType: 'Unit', docTypeVersion: 20, docId, createdAt: '2026-01-01T00:00:00.000Z', content,
    }, null, 2));
    return `/${rel}`;
}

test('a unit folder takes the unit title, in the folder it already sits in', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', { title: 'Doux comme le miel' });
    unit(root, 'ailleurs/def', 'def', { title: 'Ailleurs' });

    run(root);

    assert.ok(exists(path.join(root, 'units/Doux comme le miel/abc.mlunit.json')));
    assert.ok(exists(path.join(root, 'ailleurs/Ailleurs/def.mlunit.json')));
    assert.ok(!exists(path.join(root, 'units/abc')));
});

test('the document keeps the docId for a name, so a reference still carries the id', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', { title: 'Un titre' });
    run(root);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'units/Un titre')), ['abc.mlunit.json']);
});

test('a terminal member moves into its series, a member sommaire only gets its title', () => {
    const root = newStore();
    const ep = unit(root, 'units/ep1', 'ep1', { title: 'Episode 1' });
    const inner = unit(root, 'units/inner', 'inner', { title: 'Une série', members: [ep] });
    unit(root, 'units/outer', 'outer', { title: 'Table des matières', members: [inner] });

    run(root);

    // The episode is inside the series it belongs to…
    assert.ok(exists(path.join(root, 'units/Une série/episodes/Episode 1/ep1.mlunit.json')));
    // …and the series stays a sibling of the sommaire that lists it, rather than being buried in it.
    assert.ok(exists(path.join(root, 'units/Une série/inner.mlunit.json')));
    assert.ok(exists(path.join(root, 'units/Table des matières/outer.mlunit.json')));
    assert.ok(!exists(path.join(root, 'units/Table des matières/episodes')));
});

test('every reference is rewritten — members raw, a markdown destination escaped', () => {
    const root = newStore();
    const ep = unit(root, 'units/ep1', 'ep1', {
        title: 'Episode 1',
        contents: [{ id: 'cadre', type: 'article', label: 'Cadre', path: '/units/ep1/cadre.md' }],
    });
    write(path.join(root, 'units/ep1/cadre.md'), 'le cadre\n');
    unit(root, 'units/idx', 'idx', { title: 'Ma série', members: [ep] });
    write(path.join(root, 'notes.md'), `voir [l'épisode](${ep}) et [le cadre](/units/ep1/cadre.md)\n`);

    run(root);

    const index = readJson(path.join(root, 'units/Ma série/idx.mlunit.json'));
    assert.deepStrictEqual(index.content.members,
        ['/units/Ma série/episodes/Episode 1/ep1.mlunit.json']);

    const episode = readJson(path.join(root, 'units/Ma série/episodes/Episode 1/ep1.mlunit.json'));
    assert.strictEqual(episode.content.contents[0].path,
        '/units/Ma série/episodes/Episode 1/cadre.md');
    assert.ok(exists(path.join(root, episode.content.contents[0].path.slice(1))));

    assert.strictEqual(read(path.join(root, 'notes.md')),
        "voir [l'épisode](/units/Ma%20s%C3%A9rie/episodes/Episode%201/ep1.mlunit.json)"
        + ' et [le cadre](/units/Ma%20s%C3%A9rie/episodes/Episode%201/cadre.md)\n');
});

test('a content path written before V009 is not followed, and V009 is what repairs it', () => {
    // The fixer only follows a path that opens with the slash that makes it a link, so a
    // `contents[].path` in the pre-V009 shape is left naming the folder the unit came from. This
    // script cannot be corrected — its bytes are in the ledger of every environment it has run on
    // — so V009 re-points it, off the two facts it can read from the disk.
    const root = newStore();
    unit(root, 'units/ep1', 'ep1', {
        title: 'Episode 1',
        contents: [{ id: 'cadre', type: 'article', label: 'Cadre', path: 'units/ep1/cadre.md' }],
    });
    write(path.join(root, 'units/ep1/cadre.md'), 'le cadre\n');

    run(root);

    const episode = readJson(path.join(root, 'units/Episode 1/ep1.mlunit.json'));
    assert.strictEqual(episode.content.contents[0].path, 'units/ep1/cadre.md');
});

test('running it twice changes nothing the second time', () => {
    const root = newStore();
    const ep = unit(root, 'units/ep1', 'ep1', { title: 'Episode 1' });
    unit(root, 'units/idx', 'idx', { title: 'Ma série', members: [ep] });
    write(path.join(root, 'notes.md'), `voir [x](${ep})\n`);

    run(root);
    const after = snapshot(root);
    const out = run(root);

    assert.deepStrictEqual(snapshot(root), after);
    assert.match(out, /already named after their title/);
});

test('a folder someone named themselves is left where it is', () => {
    const root = newStore();
    unit(root, 'units/mon-dossier', 'abc', { title: 'Un titre' });

    const out = run(root);

    assert.ok(exists(path.join(root, 'units/mon-dossier/abc.mlunit.json')));
    assert.ok(!exists(path.join(root, 'units/Un titre')));
    assert.match(out, /filed by hand/);
});

test('a folder holding two unit documents is nobody’s folder', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', { title: 'Premier' });
    unit(root, 'units/abc', 'def', { title: 'Second' });

    const out = run(root);

    assert.ok(exists(path.join(root, 'units/abc/abc.mlunit.json')));
    assert.ok(exists(path.join(root, 'units/abc/def.mlunit.json')));
    assert.match(out, /shared with another unit document/);
});

test('two units of the same title in one folder are told apart by their docId', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', { title: 'Même titre' });
    unit(root, 'units/def', 'def', { title: 'Même titre' });

    run(root);

    assert.ok(exists(path.join(root, 'units/Même titre/abc.mlunit.json')));
    assert.ok(exists(path.join(root, 'units/Même titre (def)/def.mlunit.json')));
});

test('a title a path cannot carry falls back to the docId', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', { title: ' :?# ' });
    run(root);
    assert.ok(exists(path.join(root, 'units/abc/abc.mlunit.json')));
});

test('what the store declares is not content is not migrated', () => {
    const root = newStore();
    unit(root, 'fixtures/abc', 'abc', { title: 'Une fixture' });
    unit(root, 'units/def', 'def', { title: 'Un vrai' });
    write(path.join(root, '.kiao-files'), '[migration]\nfixtures\n');

    run(root);

    assert.ok(exists(path.join(root, 'fixtures/abc/abc.mlunit.json')));
    assert.ok(exists(path.join(root, 'units/Un vrai/def.mlunit.json')));
});

test('a .mlunit.json that is not a unit document is not a unit', () => {
    const root = newStore();
    write(path.join(root, 'units/abc/abc.mlunit.json'),
        JSON.stringify({ docType: 'SomethingElse', docId: 'abc', content: { title: 'Nope' } }));

    const out = run(root);

    assert.ok(exists(path.join(root, 'units/abc/abc.mlunit.json')));
    assert.match(out, /no unit in this store/);
});

test('the sentinel and a leftover docId name nothing to file', () => {
    const root = newStore();
    unit(root, 'units/idx', 'idx', {
        title: 'Ma série',
        members: ['///deleted///', 'gonelongago', '/units/nowhere/nowhere.mlunit.json'],
    });

    run(root);

    const index = readJson(path.join(root, 'units/Ma série/idx.mlunit.json'));
    assert.deepStrictEqual(index.content.members,
        ['///deleted///', 'gonelongago', '/units/nowhere/nowhere.mlunit.json']);
});
