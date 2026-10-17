/**
 * Tests for V016__dashboard-rename.js.
 *
 *     node --test "migrations/test/V016*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V016__dashboard-rename.js');

function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v016-')));
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
const exists = (file) => fs.existsSync(file);

test('the three state files are renamed, contents untouched', () => {
    const root = newStore();
    write(path.join(root, '.kiao-config', 'quickcms.json'), '{"gitEnabled":false}');
    write(path.join(root, '.kiao-config', 'quickcms-view-state.json'), '{"global":{}}');
    write(path.join(root, '.kiao-config', 'quickcms-view-state-small.json'), '{"global":{"small":true}}');

    run(root);

    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard.json')), '{"gitEnabled":false}');
    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard-view-state.json')), '{"global":{}}');
    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard-view-state-small.json')),
        '{"global":{"small":true}}');
    for (const old of ['quickcms.json', 'quickcms-view-state.json', 'quickcms-view-state-small.json']) {
        assert.ok(!exists(path.join(root, '.kiao-config', old)), `${old} survived`);
    }
});

test('a document already under its new name wins over the old one beside it', () => {
    const root = newStore();
    write(path.join(root, '.kiao-config', 'quickcms.json'), '{"gitEnabled":true}');
    write(path.join(root, '.kiao-config', 'dashboard.json'), '{"gitEnabled":false}');

    const out = run(root);

    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard.json')), '{"gitEnabled":false}');
    assert.strictEqual(read(path.join(root, '.kiao-config', 'quickcms.json')), '{"gitEnabled":true}');
    assert.match(out, /the current one wins/);
});

test('the state half is not gated by .kiao-files: state is not content', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/\n');
    write(path.join(root, '.kiao-config', 'quickcms.json'), '{"gitEnabled":false}');

    run(root);

    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard.json')), '{"gitEnabled":false}');
    assert.ok(!exists(path.join(root, '.kiao-config', 'quickcms.json')));
});

test('inline links, images and reference definitions are rewritten', () => {
    const root = newStore();
    const file = path.join(root, 'docs', 'note.md');
    write(file, [
        '# Note',
        '',
        'See [the framing](/quickcms/units/abc/cadre.md) for the shape.',
        '![plan](/quickcms/units/abc/plan.png "the plan")',
        '[prod](https://example.com/quickcms/units/abc/cadre.md)',
        '[dev](http://localhost:50302/quickcms/units/abc/cadre.md?title=T#h)',
        '[spaced](</quickcms/mon dossier/fichier.md>)',
        '[query](/quickcms/search?q=x)',
        '',
        '[framing]: /quickcms/units/abc/cadre.md',
        '[titled]: https://example.com/quickcms/units/abc/cadre.md "the title"',
        '',
        'Store links stay store links: [cadre](/units/abc/cadre.md).',
        '',
    ].join('\n'));

    run(root);

    assert.strictEqual(read(file), [
        '# Note',
        '',
        'See [the framing](/dashboard/units/abc/cadre.md) for the shape.',
        '![plan](/dashboard/units/abc/plan.png "the plan")',
        '[prod](https://example.com/dashboard/units/abc/cadre.md)',
        '[dev](http://localhost:50302/dashboard/units/abc/cadre.md?title=T#h)',
        '[spaced](</dashboard/mon dossier/fichier.md>)',
        '[query](/dashboard/search?q=x)',
        '',
        '[framing]: /dashboard/units/abc/cadre.md',
        '[titled]: https://example.com/dashboard/units/abc/cadre.md "the title"',
        '',
        'Store links stay store links: [cadre](/units/abc/cadre.md).',
        '',
    ].join('\n'));
});

test('autolinks and bare absolute URLs are rewritten', () => {
    const root = newStore();
    const file = path.join(root, 'note.md');
    write(file, [
        'Open <https://example.com/quickcms/units/abc/cadre.md> for the shape.',
        'Pasted by hand: https://example.com/quickcms/units/abc/cadre.md and',
        'http://localhost:50302/quickcms/a.md.',
        '',
    ].join('\n'));

    run(root);

    assert.strictEqual(read(file), [
        'Open <https://example.com/dashboard/units/abc/cadre.md> for the shape.',
        'Pasted by hand: https://example.com/dashboard/units/abc/cadre.md and',
        'http://localhost:50302/dashboard/a.md.',
        '',
    ].join('\n'));
});

test('code, mentions and lookalikes are left alone', () => {
    const root = newStore();
    const file = path.join(root, 'note.md');
    const content = [
        'The app lives under the /quickcms mount.',
        '',
        '```',
        'see [a](/quickcms/units/abc/cadre.md)',
        'at L1t.runAction (/quickcms/assets/index-x.js:777:12097)',
        '```',
        '',
        'Run `open /quickcms/units/abc/cadre.md` to see it.',
        'Not the mount: [x](/quickcmsx/a.md) and [y](/quickcms-old/a.md).',
        'Raw markup names store links: <a href="/quickcms/units/abc/cadre.md">x</a>.',
        '',
    ].join('\n');
    write(file, content);

    run(root);

    assert.strictEqual(read(file), content);
});

test('templates, other extensions and excluded files are left alone', () => {
    const root = newStore();
    write(path.join(root, 'kiao-user-config', 'file-templates', 'page.temp.md'),
        'See [a](/quickcms/units/abc/cadre.md).\n');
    write(path.join(root, 'notes.txt'), 'See [a](/quickcms/units/abc/cadre.md).\n');
    write(path.join(root, '.kiao-files'), '[migration]\nprivate/\n');
    write(path.join(root, 'private', 'note.md'), 'See [a](/quickcms/units/abc/cadre.md).\n');

    run(root);

    assert.strictEqual(read(path.join(root, 'kiao-user-config', 'file-templates', 'page.temp.md')),
        'See [a](/quickcms/units/abc/cadre.md).\n');
    assert.strictEqual(read(path.join(root, 'notes.txt')), 'See [a](/quickcms/units/abc/cadre.md).\n');
    assert.strictEqual(read(path.join(root, 'private', 'note.md')), 'See [a](/quickcms/units/abc/cadre.md).\n');
});

test('a second run is a no-op, byte-identical', () => {
    const root = newStore();
    write(path.join(root, '.kiao-config', 'quickcms.json'), '{"gitEnabled":false}');
    write(path.join(root, 'note.md'), 'See [a](/quickcms/units/abc/cadre.md).\n');

    run(root);
    const afterFirst = {
        config: read(path.join(root, '.kiao-config', 'dashboard.json')),
        note: read(path.join(root, 'note.md')),
    };
    const out = run(root);

    assert.strictEqual(read(path.join(root, '.kiao-config', 'dashboard.json')), afterFirst.config);
    assert.strictEqual(read(path.join(root, 'note.md')), afterFirst.note);
    assert.match(out, /0 state file\(s\) renamed, 0 of 1 markdown file\(s\) rewritten/);
});

test('a store with nothing to convert reports so and changes nothing', () => {
    const root = newStore();
    write(path.join(root, 'note.md'), '# Note\n\nNothing to see.\n');

    const out = run(root);

    assert.strictEqual(read(path.join(root, 'note.md')), '# Note\n\nNothing to see.\n');
    assert.match(out, /0 state file\(s\) renamed, 0 of 1 markdown file\(s\) rewritten/);
});
