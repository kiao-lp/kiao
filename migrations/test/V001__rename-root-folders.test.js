/**
 * Tests for V001__rename-root-folders.js and the link rewriting it is built on.
 *
 *     node --test "migrations/test/V001*.test.js"
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

const { renameOp, fixLine } = require('../lib/link-fix');

const MIGRATION = path.join(__dirname, '..', 'V001__rename-root-folders.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v001-')));
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
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

test('renames both folders and rewrites the links into them', () => {
    const root = newStore();
    write(path.join(root, 'qd-notes', 'note.md'), '# note\n');
    write(path.join(root, 'config', 'cv.json'), '{}\n');
    write(path.join(root, 'index.md'),
        'See [notes](/qd-notes/note.md) and [cv](/config/cv.json).\n');

    run(root);

    assert.ok(isDir(path.join(root, 'docs')), 'qd-notes became docs');
    assert.ok(isDir(path.join(root, 'kiao-user-config')), 'config became kiao-user-config');
    assert.ok(!fs.existsSync(path.join(root, 'qd-notes')));
    assert.ok(!fs.existsSync(path.join(root, 'config')));
    assert.strictEqual(read(path.join(root, 'index.md')),
        'See [notes](/docs/note.md) and [cv](/kiao-user-config/cv.json).\n');
});

test('a link written percent-encoded comes back percent-encoded', () => {
    const root = newStore();
    write(path.join(root, 'qd-notes', '\u{1F393}', 'Board.md'), '# board\n');
    write(path.join(root, 'index.md'), '[B](/qd-notes/%F0%9F%8E%93/Board.md)\n');

    run(root);

    assert.strictEqual(read(path.join(root, 'index.md')), '[B](/docs/%F0%9F%8E%93/Board.md)\n');
});

test('a store that declares itself off-limits to migrations is not touched', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/\n');
    write(path.join(root, 'qd-notes', 'note.md'), '# note\n');
    write(path.join(root, 'config', 'cv.json'), '{}\n');
    write(path.join(root, 'index.md'), '[notes](/qd-notes/note.md)\n');

    run(root);

    assert.ok(isDir(path.join(root, 'qd-notes')), 'the folder is left where it is');
    assert.ok(isDir(path.join(root, 'config')));
    assert.strictEqual(read(path.join(root, 'index.md')), '[notes](/qd-notes/note.md)\n');
});

test('a pair whose target already exists is left alone, and the store still starts', () => {
    const root = newStore();
    write(path.join(root, 'qd-notes', 'note.md'), '# note\n');
    write(path.join(root, 'docs', 'other.md'), '# other\n');
    write(path.join(root, 'index.md'), '[notes](/qd-notes/note.md)\n');

    const out = run(root); // and it exits 0: a store with both folders still starts

    assert.match(out, /NOT renamed/);
    assert.ok(isDir(path.join(root, 'qd-notes')), 'nothing is merged');
    assert.strictEqual(read(path.join(root, 'index.md')), '[notes](/qd-notes/note.md)\n');
});

test('re-running leaves every file byte-identical', () => {
    const root = newStore();
    write(path.join(root, 'qd-notes', 'note.md'), '# note\n');
    write(path.join(root, 'config', 'cv.json'), '{}\n');
    write(path.join(root, 'index.md'), '[notes](/qd-notes/note.md) [cv](/config/cv.json)\n');

    run(root);
    const after = read(path.join(root, 'index.md'));
    run(root);

    assert.strictEqual(read(path.join(root, 'index.md')), after);
});

test('a rename interrupted before its links were fixed is completed by the next run', () => {
    const root = newStore();
    // What the store looks like when the folder moved and the process died: the ledger records
    // nothing, so the runner calls the script again.
    write(path.join(root, 'docs', 'note.md'), '# note\n');
    write(path.join(root, 'index.md'), '[notes](/qd-notes/note.md)\n');

    run(root);

    assert.strictEqual(read(path.join(root, 'index.md')), '[notes](/docs/note.md)\n');
});

test('a store with neither folder is not walked for links', () => {
    const root = newStore();
    write(path.join(root, 'index.md'), 'nothing to see, /config/cv.json is not a link here\n');

    const out = run(root);

    assert.match(out, /nothing to rename/);
    assert.strictEqual(read(path.join(root, 'index.md')),
        'nothing to see, /config/cv.json is not a link here\n');
});

test('`config` is only a link when it carries a leading slash', () => {
    // This pair is where the anchoring was first needed, as an option this script asked for by
    // name. It is now what the fixer does for every path, and the option is gone — the script is
    // unchanged, because an already-applied migration whose bytes move is one the runner refuses
    // to start over, and the extra argument it still passes is simply ignored.
    const op = renameOp('/config', '/kiao-user-config');
    const unchanged = ['cd config/values && ls', 'read ~/.config/app.json', 'src/config/index.ts'];
    for (const line of unchanged) {
        assert.strictEqual(fixLine(line, op).line, line, line);
    }
    assert.strictEqual(fixLine('[v](/config/values/kiao.json)', op).line,
        '[v](/kiao-user-config/values/kiao.json)');
});

test('`qd-notes` needs the slash too, and is never matched inside a longer word', () => {
    const op = renameOp('/qd-notes', '/docs');
    assert.strictEqual(fixLine('[a](/qd-notes/A.md)', op).line, '[a](/docs/A.md)');
    assert.strictEqual(fixLine('see qd-notes/A.md', op).line, 'see qd-notes/A.md');
    assert.strictEqual(fixLine('/old-qd-notes/A.md', op).line, '/old-qd-notes/A.md');
});

test('the state directory and .git are never rewritten', () => {
    const root = newStore();
    write(path.join(root, 'qd-notes', 'note.md'), '# note\n');
    write(path.join(root, '.kiao-config', 'conversations', 'c.json'),
        '{"text":"see /qd-notes/note.md"}\n');
    write(path.join(root, '.git', 'description.txt'), 'see /qd-notes/note.md\n');

    run(root);

    assert.match(read(path.join(root, '.kiao-config', 'conversations', 'c.json')), /\/qd-notes\//);
    assert.match(read(path.join(root, '.git', 'description.txt')), /\/qd-notes\//);
});

test('only the folders at the root move, not their namesakes further down', () => {
    const root = newStore();
    write(path.join(root, 'project', 'config', 'app.json'), '{}\n');
    write(path.join(root, 'project', 'qd-notes', 'note.md'), '# note\n');

    run(root);

    assert.ok(isDir(path.join(root, 'project', 'config')));
    assert.ok(isDir(path.join(root, 'project', 'qd-notes')));
});
