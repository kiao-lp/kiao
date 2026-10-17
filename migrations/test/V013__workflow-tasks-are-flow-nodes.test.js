/**
 * Tests for V013__workflow-tasks-are-flow-nodes.js.
 *
 *     node --test "migrations/test/V013*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V013__workflow-tasks-are-flow-nodes.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v013-')));
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
const readJson = (file) => JSON.parse(read(file));

/** A board as the store held one before this build: the envelope, and the cards under `tasks`. */
const board = (content) => JSON.stringify({
    docType: 'KiaoWorkflow',
    docId: 'doc-1',
    docTypeVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    content,
    updatedAt: '2026-01-02T00:00:00.000Z',
}, null, 2);

test('calls the cards flow nodes, and the card a chain names a flow node too', () => {
    const root = newStore();
    const file = path.join(root, 'backlog', 'Major.workflow.json');
    write(file, board({
        columns: [{ id: 'c1', title: 'Todo' }],
        tasks: [
            { id: 't1', column: 'c1', title: 'One', onSuccess: { task: 't2', mode: 'continue' } },
            { id: 't2', column: 'c1', title: 'Two' },
        ],
    }));

    run(root);

    const { content } = readJson(file);
    assert.ok(!('tasks' in content), 'the old key is gone');
    assert.deepStrictEqual(content.flowNodes, [
        { id: 't1', column: 'c1', title: 'One', onSuccess: { flowNode: 't2', mode: 'continue' } },
        { id: 't2', column: 'c1', title: 'Two' },
    ]);
});

// The key is renamed in its place, so the first save after the migration is not a diff of the
// whole file.
test('keeps the key where it was, and the rest of the envelope as it was', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board({ columns: [{ id: 'c1', title: 'Todo' }], tasks: [], cursor: 7 }));

    run(root);

    const json = readJson(file);
    assert.deepStrictEqual(Object.keys(json),
        ['docType', 'docId', 'docTypeVersion', 'createdAt', 'content', 'updatedAt']);
    assert.strictEqual(json.docTypeVersion, 3);
    assert.strictEqual(json.docId, 'doc-1');
    assert.strictEqual(json.createdAt, '2026-01-01T00:00:00.000Z');
    assert.deepStrictEqual(Object.keys(json.content), ['columns', 'flowNodes', 'cursor']);
});

// A board nobody opened since before V010 still holds its cards inside its columns, and the reader
// that reads it that way looks for the new word there too.
test('renames the cards a board still holds inside its columns', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board({
        columns: [{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One', onSuccess: { task: 't2' } }] }],
    }));

    run(root);

    const { content } = readJson(file);
    assert.deepStrictEqual(content.columns[0].flowNodes, [{ id: 't1', title: 'One', onSuccess: { flowNode: 't2' } }]);
});

test('leaves a board already renamed byte for byte, so a second run is a no-op', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    const before = board({ columns: [{ id: 'c1', title: 'Todo' }], flowNodes: [{ id: 't1', title: 'One' }] });
    write(file, before);

    run(root);

    assert.strictEqual(read(file), before);
});

test('leaves a document that is not a board alone', () => {
    const root = newStore();
    const file = path.join(root, 'not-a-board.workflow.json');
    const before = JSON.stringify({ docType: 'KiaoMindmap', content: { tasks: [] } }, null, 2);
    write(file, before);

    run(root);

    assert.strictEqual(read(file), before);
});

test('renames the templates folder and the two variables the editor binds', () => {
    const root = newStore();
    write(path.join(root, 'kiao-user-config', 'task-templates', 'AI.temp.md'),
        '# AI\n\n## Root\n\n### textTemplate\n\n```text\n# ${taskTitle}\n${taskDescription}\n```\n');

    run(root);

    assert.ok(!fs.existsSync(path.join(root, 'kiao-user-config', 'task-templates')), 'the old folder is gone');
    const moved = read(path.join(root, 'kiao-user-config', 'flow-node-templates', 'AI.temp.md'));
    assert.match(moved, /\$\{flowNodeTitle\}/);
    assert.match(moved, /\$\{flowNodeDescription\}/);
    assert.ok(!moved.includes('${taskDescription}'), 'the old variable is gone');
});

// Two folders of templates is something only a person can settle.
test('leaves the old templates folder where the new one is already there', () => {
    const root = newStore();
    write(path.join(root, 'kiao-user-config', 'task-templates', 'AI.temp.md'), '${taskDescription}');
    write(path.join(root, 'kiao-user-config', 'flow-node-templates', 'AI.temp.md'), '${flowNodeDescription}');

    const said = run(root);

    assert.ok(fs.existsSync(path.join(root, 'kiao-user-config', 'task-templates', 'AI.temp.md')));
    assert.match(said, /left alone/);
});
