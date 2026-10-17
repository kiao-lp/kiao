/**
 * Tests for V015__bookmarks-to-json.js.
 *
 *     node --test "migrations/test/V015*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V015__bookmarks-to-json.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v015-')));
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

const mdOf = (root) => path.join(root, 'kiao-user-config', 'bookmarks.md');
const jsonOf = (root) => path.join(root, 'kiao-user-config', 'bookmarks.json');
const read = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(read(file));

test('moves every section to an entry and removes the markdown file', () => {
    const root = newStore();
    write(mdOf(root), '# Bookmarks\n\nwhat I keep coming back to.\n\n'
        + '### [The framing of a unit](/units/abc/cadre.md)\n\n'
        + 'the one to copy from.\n\n'
        + '#### Why\n\n'
        + 'it says what a unit is for.\n\n'
        + '### [Anthropic](https://anthropic.com)\n\n'
        + 'the model this CMS drives.\n');

    const out = run(root);

    assert.strictEqual(fs.existsSync(mdOf(root)), false);
    assert.deepStrictEqual(readJson(jsonOf(root)), [
        {
            title: 'The framing of a unit',
            link: '/units/abc/cadre.md',
            note: 'the one to copy from.\n\n#### Why\n\nit says what a unit is for.',
        },
        { title: 'Anthropic', link: 'https://anthropic.com', note: 'the model this CMS drives.' },
    ]);
    assert.match(out, /2 bookmark\(s\) moved/);
    assert.match(out, /preamble.*dropped/);
});

test('writes the file the way the application writes it', () => {
    const root = newStore();
    write(mdOf(root), '### [A](/a.md)\n\nwhy.\n');

    run(root);

    assert.strictEqual(read(jsonOf(root)),
        '[\n  {\n    "title": "A",\n    "link": "/a.md",\n    "note": "why."\n  }\n]\n');
});

test('unescapes a bracket in the title, and keeps a heading that is not a link', () => {
    const root = newStore();
    write(mdOf(root), '### [[draft] plan](/plan.md)\n\n### To sort out\n\nsomeday.\n');

    run(root);

    assert.deepStrictEqual(readJson(jsonOf(root)), [
        { title: '[draft] plan', link: '/plan.md', note: '' },
        { title: 'To sort out', link: '', note: 'someday.' },
    ]);
});

test('leaves a `###` inside a code block as the code it is', () => {
    const root = newStore();
    write(mdOf(root), '### [A](/a.md)\n\n```md\n### [B](/b.md)\n```\n');

    run(root);

    assert.deepStrictEqual(readJson(jsonOf(root)), [
        { title: 'A', link: '/a.md', note: '```md\n### [B](/b.md)\n```' },
    ]);
});

test('removes a markdown file holding no bookmark without writing JSON', () => {
    for (const content of ['', '   \n', '# Bookmarks\n\nnothing kept yet.\n']) {
        const root = newStore();
        write(mdOf(root), content);

        run(root);

        assert.strictEqual(fs.existsSync(mdOf(root)), false);
        assert.strictEqual(fs.existsSync(jsonOf(root)), false);
    }
});

test('leaves a store holding JSON already alone, markdown file included', () => {
    const root = newStore();
    const json = '[\n  {\n    "title": "A",\n    "link": "/a.md",\n    "note": ""\n  }\n]\n';
    write(jsonOf(root), json);
    write(mdOf(root), '### [B](/b.md)\n');

    run(root);

    // The markdown file beside it is the operator's since, not this script's to take.
    assert.strictEqual(read(jsonOf(root)), json);
    assert.strictEqual(read(mdOf(root)), '### [B](/b.md)\n');
});

test('a second run changes nothing', () => {
    const root = newStore();
    write(mdOf(root), '### [A](/a.md)\n\nwhy.\n');

    run(root);
    const after = read(jsonOf(root));
    run(root);

    assert.strictEqual(read(jsonOf(root)), after);
});

test('does nothing where there is no bookmarks file at all', () => {
    const root = newStore();

    run(root);

    assert.strictEqual(fs.existsSync(jsonOf(root)), false);
});

test('leaves a bookmarks file the store declares out of bounds alone', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nkiao-user-config\n');
    write(mdOf(root), '### [A](/a.md)\n\nwhy.\n');

    run(root);

    assert.strictEqual(read(mdOf(root)), '### [A](/a.md)\n\nwhy.\n');
    assert.strictEqual(fs.existsSync(jsonOf(root)), false);
});
