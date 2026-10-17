/**
 * Tests for V008__drop-dangling-members.js.
 *
 *     node --test "migrations/test/V008*.test.js"
 *
 * Run as a child process, the way the runner runs it, because half of what is asserted is what the
 * script refuses to drop.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIGRATION = path.join(__dirname, '..', 'V008__drop-dangling-members.js');

function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v008-')));
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

/** Writes a unit at `folder`, and returns its document path from the store root. */
function unit(root, folder, docId, { title = docId, members } = {}) {
    const content = { title, lang: 'EN', contents: [] };
    if (members) content.members = members;
    const rel = `${folder}/${docId}.mlunit.json`;
    write(path.join(root, rel), JSON.stringify({
        docType: 'Unit', docTypeVersion: 20, docId, createdAt: '2026-01-01T00:00:00.000Z', content,
    }, null, 2));
    return `/${rel}`;
}

const membersOf = (root, rel) => readJson(path.join(root, rel)).content.members;

test('a bare docId no unit answers to is dropped', () => {
    const root = newStore();
    const live = unit(root, 'units/Un', 'aaaaaaaaaaaaaaaaaaaaaa', { title: 'Un' });
    unit(root, 'units/Série', 'idx', { title: 'Série', members: [live, 'gonelongago', live.replace('/Un/', '/Un/')] });

    const out = run(root);

    assert.deepStrictEqual(membersOf(root, 'units/Série/idx.mlunit.json'), [live, live]);
    assert.match(out, /dropped "gonelongago"/);
});

test('the sentinel a deletion just left behind is kept — it is a message to a person', () => {
    const root = newStore();
    unit(root, 'units/Série', 'idx', { title: 'Série', members: ['///deleted///', 'gonelongago'] });

    run(root);

    assert.deepStrictEqual(membersOf(root, 'units/Série/idx.mlunit.json'), ['///deleted///']);
});

test('a bare docId that still resolves is kept for V003, and said out loud', () => {
    const root = newStore();
    unit(root, 'units/Un', 'aaaaaaaaaaaaaaaaaaaaaa', { title: 'Un' });
    unit(root, 'units/Série', 'idx', { title: 'Série', members: ['aaaaaaaaaaaaaaaaaaaaaa'] });

    const out = run(root);

    assert.deepStrictEqual(membersOf(root, 'units/Série/idx.mlunit.json'), ['aaaaaaaaaaaaaaaaaaaaaa']);
    assert.match(out, /run V003/);
});

test('a path is kept even when nothing answers at it — an address is not archaeology', () => {
    const root = newStore();
    unit(root, 'units/Série', 'idx', { title: 'Série', members: ['/units/Parti/parti.mlunit.json'] });

    run(root);

    assert.deepStrictEqual(membersOf(root, 'units/Série/idx.mlunit.json'),
        ['/units/Parti/parti.mlunit.json']);
});

test('running it twice changes nothing the second time', () => {
    const root = newStore();
    unit(root, 'units/Série', 'idx', { title: 'Série', members: ['gonelongago', '///deleted///'] });

    run(root);
    const after = read(path.join(root, 'units/Série/idx.mlunit.json'));
    const out = run(root);

    assert.strictEqual(read(path.join(root, 'units/Série/idx.mlunit.json')), after);
    assert.match(out, /0 member\(s\) dropped/);
});

test('a unit with no members is left byte-identical', () => {
    const root = newStore();
    unit(root, 'units/Seule', 'abc', { title: 'Seule' });
    const before = read(path.join(root, 'units/Seule/abc.mlunit.json'));

    run(root);

    assert.strictEqual(read(path.join(root, 'units/Seule/abc.mlunit.json')), before);
});

test('what the store declares is not content is not migrated', () => {
    const root = newStore();
    unit(root, 'fixtures/idx', 'fix', { title: 'Fixture', members: ['gonelongago'] });
    unit(root, 'units/Série', 'idx', { title: 'Série', members: ['gonelongago'] });
    write(path.join(root, '.kiao-files'), '[migration]\nfixtures\n');

    run(root);

    assert.deepStrictEqual(membersOf(root, 'fixtures/idx/fix.mlunit.json'), ['gonelongago']);
    assert.deepStrictEqual(membersOf(root, 'units/Série/idx.mlunit.json'), []);
});

test('a .mlunit.json that is not a unit document is left alone', () => {
    const root = newStore();
    const notAUnit = JSON.stringify({ docType: 'SomethingElse', docId: 'x', content: { members: ['gonelongago'] } }, null, 2);
    write(path.join(root, 'units/x/x.mlunit.json'), notAUnit);

    run(root);

    assert.strictEqual(read(path.join(root, 'units/x/x.mlunit.json')), notAUnit);
});
