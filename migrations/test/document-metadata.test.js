const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { transform } = require('../V019__document-metadata');

const SCRIPT = path.join(__dirname, '..', 'V019__document-metadata.js');

function store(t, files) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-docmeta-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, '.kiao-files'), '');
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
    }
    return root;
}

function run(root) {
    const result = spawnSync(process.execPath, [SCRIPT, root], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, KIAO_MIGRATION_LIB: path.join(__dirname, '..', 'lib') },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');

test('moves root status, role and provenance under document', (t) => {
    const root = store(t, {
        'a.md': '---\nstatus: DRAFT\nrole: PRIMARY_SOURCE\nprovenance: Made by hand.\n---\n\n# A\n',
        'b.md': '---\nstatus: APPROVED\nrole: DERIVED\nprovenance: |\n  Based on the source.\n  Reviewed.\n---\n\n# B\n',
    });
    run(root);
    assert.equal(read(root, 'a.md'),
        '---\ndocument:\n  status: DRAFT\n  role: PRIMARY_SOURCE\n  provenance: Made by hand.\n---\n\n# A\n');
    assert.equal(read(root, 'b.md'),
        '---\ndocument:\n  status: APPROVED\n  role: DERIVED\n  provenance: |\n    Based on the source.\n    Reviewed.\n---\n\n# B\n');
});

test('preserves decision, other keys, comments and the body', (t) => {
    const body = '\n# Decision\n\nBody.\n';
    const root = store(t, {
        'a.md': '---\n# Publication status\nstatus: DRAFT # awaiting review\nrole: DERIVED\nprovenance: "Original: report"\ncustom:\n  tags: [one, two]\ndecision:\n  id: "00001"\n  status: DECIDED\n---\n' + body,
    });
    run(root);
    const out = read(root, 'a.md');
    assert.match(out, /# Publication status/);
    assert.match(out, / {2}status: DRAFT # awaiting review/);
    assert.match(out, /custom:\n {2}tags: \[one, two\]/);
    assert.match(out, /decision:\n {2}id: "00001"\n {2}status: DECIDED/);
    assert.ok(out.endsWith(body));
});

test('is idempotent and leaves current, headerless and unrelated files unchanged', (t) => {
    const current = '---\ndocument:\n  status: DRAFT\n  role: PRIMARY_SOURCE\n---\n\n# A\n';
    const plain = '# Plain\n';
    const custom = '---\ncustom: keep\n---\n\n# C\n';
    const root = store(t, { 'a.md': current, 'b.md': plain, 'c.md': custom });
    run(root);
    assert.equal(read(root, 'a.md'), current);
    assert.equal(read(root, 'b.md'), plain);
    assert.equal(read(root, 'c.md'), custom);
    run(root);
    assert.equal(read(root, 'a.md'), current);
});

test('skips SKILL.md, templates and files whose root values are not document metadata', (t) => {
    const skill = '---\nname: x\ndescription: y\nstatus: DRAFT\n---\n\n# S\n';
    const bad = '---\nstatus: unknown\nrole: PRIMARY_SOURCE\n---\n\n# B\n';
    const root = store(t, { 'SKILL.md': skill, 'bad.md': bad, 'note.temp.md': '---\nstatus: DRAFT\n---\n' });
    run(root);
    assert.equal(read(root, 'SKILL.md'), skill);
    assert.equal(read(root, 'bad.md'), bad);
});

test('merges root keys into an existing document map', () => {
    assert.equal(
        transform('---\ndocument:\n  status: DRAFT\nrole: DERIVED\n---\n\n# A\n'),
        '---\ndocument:\n  status: DRAFT\n  role: DERIVED\n---\n\n# A\n');
});

test('honours .kiao-files migration exclusions', (t) => {
    const root = store(t, { 'kept/a.md': '---\nstatus: DRAFT\n---\n\n# A\n' });
    fs.writeFileSync(path.join(root, '.kiao-files'), 'kept\n');
    run(root);
    assert.equal(read(root, 'kept/a.md'), '---\nstatus: DRAFT\n---\n\n# A\n');
});
