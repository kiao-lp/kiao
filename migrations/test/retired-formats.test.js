const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rewriteText } = require('../examples/markdown-mount');
const { migrateEntry } = require('../examples/value-shape');
const { splitSections, taskOfSection } = require('../examples/tasks-to-workflow');
const { loadIgnore } = require('../lib/kiao-fs');
const { fixLinks, renameOp } = require('../lib/link-fix');
const cases = require('./retired-formats.json');

test('mount rewrites respect rendered destinations and are idempotent', () => {
    for (const { before, after } of cases.mountLinks) {
        assert.equal(rewriteText(before), after);
        if (after !== null) assert.equal(rewriteText(after), null);
    }
});

test('value grouping checks shape, preserves root precedence and stops in target shape', () => {
    for (const { before, after } of cases.values) {
        const original = JSON.stringify(before);
        const result = migrateEntry(before);
        assert.equal(JSON.stringify(before), original);
        assert.equal(result.changed, after !== null);
        if (after !== null) {
            assert.deepEqual(result.entry, after);
            assert.equal(migrateEntry(result.entry).changed, false);
        }
    }
});

test('board parsing keeps headings in code and unrecognised metadata in the body', () => {
    const text = '# Work\n## One\n```js\n## code\n```\n## Two\n```yaml\n- custom\n```';
    const { sections } = splitSections(text);
    assert.equal(sections.length, 2);
    assert.match(taskOfSection(sections[0]).body, /## code/);
    assert.match(taskOfSection(sections[1]).body, /- custom/);
});

test('a link rewrite can be retried before its folder move and obeys nested boundaries', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-link-contract-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, '.kiao-files'), '');
    fs.writeFileSync(path.join(root, 'nested/.kiao-files'), '[migration]\n/\n');
    const original = '[page](/docs/id/page.md)\ndocs/id in prose\n';
    fs.writeFileSync(path.join(root, 'page.md'), original);
    fs.writeFileSync(path.join(root, 'nested/page.md'), original);
    const op = renameOp('docs/id', 'docs/A title');
    const first = fixLinks(root, [op], loadIgnore(root));
    assert.equal(first.length, 1);
    const rewritten = fs.readFileSync(path.join(root, 'page.md'), 'utf8');
    assert.match(rewritten, /\[page\]\(\/docs\/A%20title\/page.md\)/);
    assert.match(rewritten, /docs\/id in prose/);
    assert.equal(fs.readFileSync(path.join(root, 'nested/page.md'), 'utf8'), original);
    assert.deepEqual(fixLinks(root, [op], loadIgnore(root)), []);
    assert.equal(fs.readFileSync(path.join(root, 'page.md'), 'utf8'), rewritten);
});
