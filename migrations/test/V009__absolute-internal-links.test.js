/**
 * Tests for V009__absolute-internal-links.js.
 *
 *     node --test "migrations/test/V009*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V009__absolute-internal-links.js');

function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v009-')));
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

/** Writes a unit document at `folder`, and returns the file it was written to. */
function unit(root, folder, docId, content, version = 20) {
    const rel = `${folder}/${docId}.mlunit.json`;
    write(path.join(root, rel), JSON.stringify({
        docType: 'Unit', docTypeVersion: version, docId, createdAt: '2026-01-01T00:00:00.000Z',
        content: { title: docId, lang: 'EN', contents: [], ...content },
    }, null, 2));
    return path.join(root, rel);
}

const article = (id, p) => ({ id, type: 'article', label: id, path: p });

/** Writes a board holding one task per folder given, and returns the file. */
function board(root, rel, folders) {
    write(path.join(root, rel), JSON.stringify({
        docType: 'KiaoWorkflow', docTypeVersion: 1, docId: 'b1',
        content: {
            columns: [{
                id: 'c1',
                title: 'Todo',
                tasks: folders.map((folder, i) => ({
                    id: `t${i}`, title: `Task ${i}`, type: 'ai',
                    settings: { agent: 'claude', model: 'opus', folder },
                })),
            }],
        },
    }, null, 2));
    return path.join(root, rel);
}

const foldersOf = (file) => readJson(file).content.columns[0].tasks.map((t) => t.settings.folder);

test('a content path gains the slash that makes it a link', () => {
    const root = newStore();
    const file = unit(root, 'units/abc', 'abc', {
        contents: [article('cadre', 'units/abc/cadre.md'), article('annexe', 'units/abc/annexe.md')],
    });
    write(path.join(root, 'units/abc/cadre.md'), 'le cadre\n');
    write(path.join(root, 'units/abc/annexe.md'), "l'annexe\n");

    run(root);

    const doc = readJson(file);
    assert.deepStrictEqual(doc.content.contents.map((c) => c.path),
        ['/units/abc/cadre.md', '/units/abc/annexe.md']);
    assert.strictEqual(doc.docTypeVersion, 21);
});

test('a members entry that reads as a path gains one too; a bare docId does not', () => {
    const root = newStore();
    const file = unit(root, 'units/idx', 'idx', {
        members: ['units/abc/abc.mlunit.json', '/units/def/def.mlunit.json', '5w8j175rotcrpclcq5nsbd',
            '///deleted///'],
    });

    run(root);

    assert.deepStrictEqual(readJson(file).content.members, [
        '/units/abc/abc.mlunit.json',
        '/units/def/def.mlunit.json',
        // Not a path: V003 left it, V008 answers for it, and there is no slash to give it.
        '5w8j175rotcrpclcq5nsbd',
        '///deleted///',
    ]);
});

test("a task's working directory is a link, the store root being the bare slash", () => {
    const root = newStore();
    const file = board(root, 'plan.workflow.json', ['backlog', '/exchange/dashboard', '.', 'docs/']);

    run(root);

    assert.deepStrictEqual(foldersOf(file),
        ['/backlog', '/exchange/dashboard', '/', '/docs']);
});

test('a box left empty stays empty — that is no folder, not the store root', () => {
    // An empty folder is what leaves an AI card unplayable. Giving it a slash would hand the task
    // the whole store to run in, which is the one thing nobody wrote down.
    const root = newStore();
    const file = board(root, 'plan.workflow.json', ['', '   ']);
    const before = snapshot(root);

    run(root);

    assert.deepStrictEqual(snapshot(root), before);
    assert.deepStrictEqual(foldersOf(file), ['', '   ']);
});

test('a document that is not one of ours is not read for links', () => {
    const root = newStore();
    // The extension is the store's; the shape is not.
    write(path.join(root, 'fixture.mlunit.json'),
        JSON.stringify({ docType: 'Sample', content: { contents: [article('x', 'a/b.md')] } }, null, 2));
    write(path.join(root, 'notes.workflow.json'), JSON.stringify({ docType: 'Other', content: {} }, null, 2));
    write(path.join(root, 'broken.mlunit.json'), 'not json at all\n');
    const before = snapshot(root);

    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('prose and relative markdown links are left where they are', () => {
    const root = newStore();
    // A relative destination is read against the document that holds it, so a slash would break it.
    const note = 'voir [le cadre](cadre.md), et `cp units/abc/cadre.md /tmp` pour la copie\n';
    write(path.join(root, 'units/abc/note.md'), note);
    unit(root, 'units/abc', 'abc', {});

    run(root);

    assert.strictEqual(read(path.join(root, 'units/abc/note.md')), note);
});

test('a store that declares itself off-limits to migrations is not touched', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/\n');
    unit(root, 'units/abc', 'abc', { contents: [article('cadre', 'units/abc/cadre.md')] });
    const before = snapshot(root);

    run(root);

    assert.deepStrictEqual(snapshot(root), before);
});

test('a content path V007 could no longer follow is re-pointed at the unit’s own folder', () => {
    // V007 moved the folder and left the fixer to repair the references; a path without the slash
    // is not one the fixer follows any more, so it still names where the unit came from.
    const root = newStore();
    const file = unit(root, 'units/Episode 1', 'ep1', {
        contents: [article('cadre', 'units/ep1/cadre.md')],
    });
    write(path.join(root, 'units/Episode 1/cadre.md'), 'le cadre\n');

    const out = run(root);

    assert.strictEqual(readJson(file).content.contents[0].path, '/units/Episode 1/cadre.md');
    assert.match(out, /found beside the document/);
});

test('a path naming nothing is given its slash and nothing else', () => {
    // A file that is not there right now — a mount that is down, a folder not pulled — is not a
    // reference to repair, and there is no namesake beside the document to repair it with.
    const root = newStore();
    const file = unit(root, 'units/abc', 'abc', { contents: [article('cadre', 'ailleurs/cadre.md')] });

    run(root);

    assert.strictEqual(readJson(file).content.contents[0].path, '/ailleurs/cadre.md');
});

test('a link that already carries the slash is left as it reads, missing file or not', () => {
    const root = newStore();
    const file = unit(root, 'units/abc', 'abc', {
        contents: [article('cadre', '/pas/la/cadre.md')],
    }, 21);
    write(path.join(root, 'units/abc/cadre.md'), 'un homonyme\n');
    const before = snapshot(root);

    run(root);

    assert.deepStrictEqual(snapshot(root), before);
    assert.strictEqual(readJson(file).content.contents[0].path, '/pas/la/cadre.md');
});

test('re-running leaves every file byte-identical', () => {
    const root = newStore();
    unit(root, 'units/abc', 'abc', {
        contents: [article('cadre', 'units/abc/cadre.md')],
        members: ['units/def/def.mlunit.json'],
    });
    write(path.join(root, 'units/abc/cadre.md'), 'le cadre\n');
    board(root, 'plan.workflow.json', ['backlog', '/docs']);

    run(root);
    const after = snapshot(root);
    const out = run(root);

    assert.deepStrictEqual(snapshot(root), after);
    assert.match(out, /0 link\(s\) in 0 unit\(s\), 0 task folder\(s\)/);
});
