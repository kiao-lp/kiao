/**
 * Tests for V006__workflow-task-agent.js.
 *
 *     node --test "migrations/test/V006*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V006__workflow-task-agent.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v006-')));
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

/** A board as the store holds one: the envelope, and one column holding the cards it is given. */
const board = (...tasks) => JSON.stringify({
    docType: 'KiaoWorkflow',
    docId: 'doc-1',
    docTypeVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    content: { template: null, columns: [{ id: 'col-1', title: 'To do', tasks }] },
}, null, 2);

const playable = (over = {}) => ({
    id: 'task-1',
    title: 'Write the plan',
    settings: { model: 'opus', effort: 'high', permission: 'manualLive', folder: '/' },
    ...over,
});

const tasksOf = (file) => readJson(file).content.columns[0].tasks;

test('names Claude on an AI card that names a model and no agent', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(playable({ type: 'ai' })));

    run(root);

    assert.deepStrictEqual(tasksOf(file)[0].settings, {
        agent: 'claude', model: 'opus', effort: 'high', permission: 'manualLive', folder: '/',
    });
});

// The key goes first, which is where the editor writes it and where it reads best: the four fields
// after it are that agent's vocabulary.
test('writes the agent first in the settings', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(playable({ type: 'ai' })));

    run(root);

    assert.deepStrictEqual(Object.keys(tasksOf(file)[0].settings),
        ['agent', 'model', 'effort', 'permission', 'folder']);
});

// A board written before the `type` field is read the way both services read it: a named model is
// AI, and nothing at all is Human.
test('reads a card with no type the way the services do', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(playable(), { id: 'task-2', title: 'Mine', settings: { folder: 'units' } }));

    run(root);

    const tasks = tasksOf(file);
    assert.strictEqual(tasks[0].settings.agent, 'claude');
    assert.strictEqual(tasks[1].settings.agent, undefined, 'a card naming no model is nobody’s agent');
});

// A board that has travelled from a host with other agents is not a board to correct.
test('leaves a card that already names an agent alone', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(playable({ type: 'ai', settings: { agent: 'codex', model: 'gpt-5.1-codex' } })));

    run(root);

    assert.strictEqual(tasksOf(file)[0].settings.agent, 'codex');
});

test('leaves the three types no agent plays alone', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(
        { id: 't1', title: 'Mine', type: 'human', settings: { folder: 'units' } },
        { id: 't2', title: 'Off', type: 'shutdown' },
        { id: 't3', title: 'At three', type: 'scheduler', at: '2026-01-01T03:00' },
    ));
    const before = read(file);

    run(root);

    assert.strictEqual(read(file), before);
});

test('leaves a .workflow.json that is not a board alone', () => {
    const root = newStore();
    const stray = path.join(root, 'notes.workflow.json');
    write(stray, JSON.stringify({ docType: 'SomethingElse', content: { columns: [] } }));
    const notJson = path.join(root, 'broken.workflow.json');
    write(notJson, 'not json at all');
    const before = { stray: read(stray), notJson: read(notJson) };

    run(root);

    assert.strictEqual(read(stray), before.stray);
    assert.strictEqual(read(notJson), before.notJson);
});

test('honours the store’s .kiao-files', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/fixtures\n');
    const skipped = path.join(root, 'fixtures', 'sample.workflow.json');
    write(skipped, board(playable({ type: 'ai' })));
    const before = read(skipped);

    run(root);

    assert.strictEqual(read(skipped), before, 'a declared-out-of-bounds board is not migrated');
});

test('is a no-op the second time', () => {
    const root = newStore();
    const file = path.join(root, 'backlog.workflow.json');
    write(file, board(playable({ type: 'ai' })));

    run(root);
    const once = read(file);
    const output = run(root);

    assert.strictEqual(read(file), once);
    assert.match(output, /0 board\(s\)/);
});
