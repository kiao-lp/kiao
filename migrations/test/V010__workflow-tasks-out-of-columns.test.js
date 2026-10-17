/**
 * Tests for V010__workflow-tasks-out-of-columns.js.
 *
 *     node --test "migrations/test/V010*.test.js"
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

const MIGRATION = path.join(__dirname, '..', 'V010__workflow-tasks-out-of-columns.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v010-')));
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

/** A board as the store held one before this build: the envelope, and columns holding their cards. */
const board = (columns, content = {}) => JSON.stringify({
    docType: 'KiaoWorkflow',
    docId: 'doc-1',
    docTypeVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    content: { columns, ...content },
    updatedAt: '2026-01-02T00:00:00.000Z',
}, null, 2);

test('lists the cards beside the columns, each naming the column it was in', () => {
    const root = newStore();
    const file = path.join(root, 'backlog', 'Major.workflow.json');
    write(file, board([
        { id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }] },
        { id: 'c2', title: 'Done', notes: 'Shipped', tasks: [{ id: 't3', title: 'Three', status: 'done' }] },
    ]));

    run(root);

    const { content } = readJson(file);
    assert.deepStrictEqual(content.columns, [
        { id: 'c1', title: 'Todo' },
        { id: 'c2', title: 'Done', notes: 'Shipped' },
    ]);
    assert.deepStrictEqual(content.tasks, [
        { id: 't1', column: 'c1', title: 'One' },
        { id: 't2', column: 'c1', title: 'Two' },
        { id: 't3', column: 'c2', title: 'Three', status: 'done' },
    ]);
});

// Where the editor and worker both write it, so the first save after the migration is not a
// diff of every card.
test('writes the column straight after the id', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board([{
        id: 'c1',
        title: 'Todo',
        tasks: [{ id: 't1', title: 'Plan', body: 'Do it.', settings: { model: 'opus' }, column: 'nonsense' }],
    }]));

    run(root);

    const [task] = readJson(file).content.tasks;
    assert.deepStrictEqual(Object.keys(task), ['id', 'column', 'title', 'body', 'settings']);
    // A card inside a column is in that column, whatever it said about itself.
    assert.strictEqual(task.column, 'c1');
});

test('says the board is in the new shape, and keeps the rest of the envelope as it was', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board([{ id: 'c1', title: 'Todo', tasks: [] }]));

    run(root);

    const json = readJson(file);
    assert.deepStrictEqual(Object.keys(json), ['docType', 'docId', 'docTypeVersion', 'createdAt', 'content', 'updatedAt']);
    assert.strictEqual(json.docTypeVersion, 2);
    assert.strictEqual(json.docId, 'doc-1');
    assert.strictEqual(json.createdAt, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(json.updatedAt, '2026-01-02T00:00:00.000Z');
    assert.deepStrictEqual(json.content, { columns: [{ id: 'c1', title: 'Todo' }], tasks: [] });
});

// Its cards have to name it now.
test('gives a column written without an id one, and files its cards in it', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board([{ title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }]));

    run(root);

    const { content } = readJson(file);
    assert.match(content.columns[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepStrictEqual(Object.keys(content.columns[0]), ['id', 'title']);
    assert.strictEqual(content.tasks[0].column, content.columns[0].id);
});

// A board both shapes were written into — a card added to a column by an older reader — keeps the
// cards the document already listed first, which is where both services read them.
test('keeps a card the document already listed beside the columns, first', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board(
        [{ id: 'c1', title: 'Todo', tasks: [{ id: 'old', title: 'Added the old way' }] }],
        { tasks: [{ id: 'new', column: 'c1', title: 'Listed' }] },
    ));

    run(root);

    assert.deepStrictEqual(readJson(file).content.tasks.map(task => task.id), ['new', 'old']);
});

test('converts a board written without its envelope, and leaves it without one', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, JSON.stringify({ columns: [{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }] }, null, 2));

    run(root);

    assert.deepStrictEqual(readJson(file), {
        columns: [{ id: 'c1', title: 'Todo' }],
        tasks: [{ id: 't1', column: 'c1', title: 'One' }],
    });
});

// Nothing is dropped: what the readers make of an entry is theirs to decide.
test('carries across an entry of a column that is not a card, as it was', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board([{ id: 'c1', title: 'Todo', tasks: [42, { id: 't1', title: 'One' }] }]));

    run(root);

    assert.deepStrictEqual(readJson(file).content.tasks, [42, { id: 't1', column: 'c1', title: 'One' }]);
});

test('leaves a board already in the new shape exactly as it is', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    const converted = JSON.stringify({
        docType: 'KiaoWorkflow',
        docId: 'doc-1',
        docTypeVersion: 2,
        content: { columns: [{ id: 'c1', title: 'Todo' }], tasks: [{ id: 't1', column: 'c1', title: 'One' }] },
    }, null, 2);
    write(file, converted);

    run(root);

    assert.strictEqual(read(file), converted);
});

test('leaves a .workflow.json that is not a board alone', () => {
    const root = newStore();
    const stray = path.join(root, 'notes.workflow.json');
    write(stray, JSON.stringify({ docType: 'SomethingElse', content: { columns: [{ id: 'c', tasks: [] }] } }));
    const notJson = path.join(root, 'broken.workflow.json');
    write(notJson, 'not json at all');
    const noColumns = path.join(root, 'empty.workflow.json');
    write(noColumns, JSON.stringify({ docType: 'KiaoWorkflow', content: { lanes: [] } }));
    const otherName = path.join(root, 'board.json');
    write(otherName, board([{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }]));
    const before = [stray, notJson, noColumns, otherName].map(read);

    run(root);

    assert.deepStrictEqual([stray, notJson, noColumns, otherName].map(read), before);
});

// There is nowhere to put the cards without writing over whatever that is.
test('leaves a board alone whose own list of cards is not a list, and names it', () => {
    const root = newStore();
    const file = path.join(root, 'odd.workflow.json');
    write(file, board([{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }], { tasks: { not: 'a list' } }));
    const before = read(file);

    const output = run(root);

    assert.strictEqual(read(file), before);
    assert.match(output, /odd\.workflow\.json: left alone/);
});

test('honours the store’s .kiao-files', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/fixtures\n');
    const skipped = path.join(root, 'fixtures', 'sample.workflow.json');
    write(skipped, board([{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }]));
    const before = read(skipped);

    run(root);

    assert.strictEqual(read(skipped), before, 'a declared-out-of-bounds board is not migrated');
});

test('says what it rewrote', () => {
    const root = newStore();
    write(path.join(root, 'backlog', 'Major.workflow.json'), board([
        { id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }] },
    ]));

    const output = run(root);

    assert.match(output, /backlog\/Major\.workflow\.json: 2 card\(s\) now listed beside the columns/);
    assert.match(output, /1 board\(s\) of 1 rewritten: 2 card\(s\)/);
});

test('is a no-op the second time', () => {
    const root = newStore();
    const file = path.join(root, 'board.workflow.json');
    write(file, board([{ id: 'c1', title: 'Todo', tasks: [{ id: 't1', title: 'One' }] }]));

    run(root);
    const once = read(file);
    const output = run(root);

    assert.strictEqual(read(file), once);
    assert.match(output, /0 board\(s\)/);
});
