/**
 * Tests for `.kiao-files` support in lib/kiao-fs.js.
 *
 *     node --test migrations/test/
 *
 * A declaration is the only thing standing between a migration written for KIAO documents and a
 * store that is a source tree, so what matters here is the two halves of the bargain: a declared
 * path is never handed to a migration, and an undeclared one always is. A rule that quietly matched
 * more than it says would hide content from a migration that has to see it; one that matched less
 * would let a rewrite reach a folder the operator fenced off.
 *
 * The grammar itself is pinned by a corpus shared with the Go implementation in worker — see
 * kiao-files-corpus.json. What is tested here is everything around it: where declarations are found,
 * how nested ones compose, and what a walk does with them.
 *
 * It lives in a subdirectory because the worker migration runner scans the migrations folder
 * for `V<NNN>__<name>.js` — a test file up there would be discovered as a migration and run against
 * the real store.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseIgnore,
    loadIgnore,
    scan,
    STATE_DIR_NAME,
    KIAO_FILES_NAME,
    LEGACY_IGNORE_FILE,
    CONCERN_MIGRATION,
    CONCERN_REFACTOR,
    DEFAULT_EXCLUSIONS,
} = require('../lib/kiao-fs');

// realpath: on some platforms the temp directory is reached through a symlink, and the matcher
// compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-files-')));
}

function write(file, content = '{}') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

test('the grammar matches the shared corpus, case for case', () => {
    const corpus = require('./kiao-files-corpus.json');
    assert.ok(corpus.cases.length > 0, 'the corpus is empty');
    // The other half of the contract: a store with no declaration of its own must be bounded the
    // same way here as by worker, or a by-hand run would see a different store.
    assert.deepStrictEqual(DEFAULT_EXCLUSIONS, corpus.defaults);
    for (const c of corpus.cases) {
        for (const [concern, want] of [[CONCERN_MIGRATION, c.migration], [CONCERN_REFACTOR, c.refactor]]) {
            const ignore = parseIgnore(c.declaration, '/store', null, concern);
            assert.strictEqual(ignore.ignores(path.join('/store', c.path)), want,
                `${c.name}: ${concern} on ${c.path}`);
        }
    }
});

test('a path outside the store is never reported as protected', () => {
    const ignore = parseIgnore('/\n', '/store');

    assert.ok(!ignore.ignores('/elsewhere/x.mlunit.json'));
    assert.ok(!ignore.ignores('/store/../x.mlunit.json'));
});

test('loadIgnore reads the root declaration', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, KIAO_FILES_NAME), 'vendor\n');

    assert.ok(loadIgnore(root).ignores(path.join(root, 'vendor')));
    assert.deepStrictEqual(loadIgnore(root).patterns, ['vendor']);
});

test('a nested declaration covers its own subtree and no other', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, KIAO_FILES_NAME), '');
    write(path.join(root, 'repo-a', KIAO_FILES_NAME), 'gen\n');

    const ignore = loadIgnore(root);
    assert.ok(ignore.ignores(path.join(root, 'repo-a', 'gen', 'x.mlunit.json')));
    assert.ok(!ignore.ignores(path.join(root, 'repo-b', 'gen', 'x.mlunit.json')));
});

test('a store that has never been served falls back to the built-in defaults', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const ignore = loadIgnore(root);
    assert.ok(ignore.ignores(path.join(root, 'node_modules', 'p', 'x.mlunit.json')));
    assert.ok(ignore.ignores(path.join(root, 'app', 'build', 'x.mlunit.json')));
    assert.ok(!ignore.ignores(path.join(root, 'units', 'x.mlunit.json')));
});

test('an empty declaration means the store excludes nothing, and says so deliberately', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, KIAO_FILES_NAME), '# everything here is content\n');

    assert.ok(!loadIgnore(root).ignores(path.join(root, 'node_modules', 'p', 'x.mlunit.json')));
});

// A store worker has not started on yet still has its rules where the operator left them.
test('a legacy migration-ignore is still honoured until the service converts it', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, STATE_DIR_NAME, LEGACY_IGNORE_FILE), 'my-sources\n');

    assert.ok(loadIgnore(root).ignores(path.join(root, 'my-sources', 'x.mlunit.json')));
});

test('.git and the state directory are excluded whatever a declaration says', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, KIAO_FILES_NAME), '# nothing is excluded here\n');

    const ignore = loadIgnore(root);
    assert.ok(ignore.ignores(path.join(root, '.git', 'x.mlunit.json')));
    assert.ok(ignore.ignores(path.join(root, STATE_DIR_NAME, 'x.mlunit.json')));
});

test('scan honours the declarations and does not descend into an excluded directory', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, 'units', 'kept.mlunit.json'));
    write(path.join(root, 'vendor', 'skipped.mlunit.json'));
    write(path.join(root, 'vendor', 'deep', 'skipped.mlunit.json'));
    write(path.join(root, 'units', 'generated.mlunit.json'));
    write(path.join(root, 'repo', 'kept.mlunit.json'));
    write(path.join(root, 'repo', 'gen', 'skipped.mlunit.json'));
    write(path.join(root, 'repo', KIAO_FILES_NAME), 'gen\n');
    write(path.join(root, KIAO_FILES_NAME), 'vendor\nunits/generated.mlunit.json\n');

    process.env.KIAO_DATA_ROOT = root;
    t.after(() => delete process.env.KIAO_DATA_ROOT);

    const found = scan(root).map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
    assert.deepStrictEqual(found, ['repo/kept.mlunit.json', 'units/kept.mlunit.json']);
});

test('scan still skips machinery with no declaration at all', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, 'kept.mlunit.json'));
    write(path.join(root, '.git', 'x.mlunit.json'));
    write(path.join(root, STATE_DIR_NAME, 'x.mlunit.json'));
    write(path.join(root, 'node_modules', 'p', 'x.mlunit.json'));

    const found = scan(root, undefined, loadIgnore(root));
    assert.deepStrictEqual(found, [path.join(root, 'kept.mlunit.json')]);
});

// The two passes are declared separately because they are different decisions about one folder.
test('a [refactor] rule does not bound a migration', (t) => {
    const root = newStore();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    write(path.join(root, KIAO_FILES_NAME), '[refactor]\nfixtures\n');
    write(path.join(root, 'fixtures', 'x.mlunit.json'));

    assert.deepStrictEqual(scan(root), [path.join(root, 'fixtures', 'x.mlunit.json')]);
    assert.ok(loadIgnore(root, CONCERN_REFACTOR).ignores(path.join(root, 'fixtures', 'x.mlunit.json')));
});
