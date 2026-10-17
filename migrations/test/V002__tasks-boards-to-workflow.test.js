/**
 * Tests for V002__tasks-boards-to-workflow.js and the reading of the old format it is built on.
 *
 *     node --test "migrations/test/V002*.test.js"
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

const { taskOfSection, workflowOf } = require('../lib/tasks-to-workflow');

const MIGRATION = path.join(__dirname, '..', 'V002__tasks-boards-to-workflow.js');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v002-')));
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

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Markdown a line at a time — a template literal cannot hold a fence. */
const md = (...lines) => lines.join('\n');

// ── the reading of a column file ──────────────────────────────────────────────

test('a task is its heading, its settings block and its body', () => {
    const task = taskOfSection(md(
        '## Write the plan',
        '',
        '```yaml',
        'model: opus',
        'effort: high',
        'permission: bypassPermissions',
        'folder: "/"',
        '```',
        '',
        'Introduction.',
        '',
        '### Objectif',
        '',
        'The objective.',
    ));

    assert.strictEqual(task.title, 'Write the plan');
    assert.deepStrictEqual(task.settings, {
        model: 'opus', effort: 'high', permission: 'bypassPermissions', folder: '/',
    });
    assert.strictEqual(task.body, 'Introduction.\n\n### Objectif\n\nThe objective.');
});

test('a block that is not flat key-value pairs is the task’s own YAML', () => {
    const task = taskOfSection(md('## Shows some YAML', '', '```yaml', '- one', '- two', '```'));
    assert.deepStrictEqual(task.settings, {});
    assert.match(task.body, /- one/);
});

test('a key written with nothing after it says what no key says', () => {
    const task = taskOfSection(md('## By hand', '', '```yaml', 'model:', '```', '', 'mine'));
    assert.deepStrictEqual(task.settings, {});
    assert.strictEqual(task.body, 'mine');
});

test('an answer filed under a task stays part of its body', () => {
    const task = taskOfSection(md('## Played', '', 'asked', '', '---', '', 'Done: all of it.'));
    assert.strictEqual(task.body, 'asked\n\n---\n\nDone: all of it.');
});

test('a ## inside a code block is code, not a second task', () => {
    const { columns } = workflowOf(
        [{ file: 'b/Todo.tasks.md', text: md('## One', '', '```md', '## Not a task', '```', '', '## Two') }],
        id(),
    );
    assert.deepStrictEqual(columns[0].tasks.map((task) => task.title), ['One', 'Two']);
});

test('columns come out in the order a person reads their names', () => {
    const { columns } = workflowOf([
        { file: 'b/10 - Done.tasks.md', text: '' },
        { file: 'b/2 - Doing.tasks.md', text: '' },
        { file: 'b/1 - Todo.tasks.md', text: '' },
    ], id());
    assert.deepStrictEqual(columns.map((column) => column.title), ['1 - Todo', '2 - Doing', '10 - Done']);
});

test('the # title a column file opened on goes, a note written under it stays', () => {
    const [titled, noted] = workflowOf([
        { file: 'b/1 - Todo.tasks.md', text: '# Todo\n\n## A\n' },
        { file: 'b/2 - Doing.tasks.md', text: '# Doing\n\nOne card at a time.\n\n## B\n' },
    ], id()).columns;
    assert.strictEqual(titled.notes, undefined);
    assert.strictEqual(noted.notes, 'One card at a time.');
});

test('every column and every task is given an id of its own', () => {
    const { columns } = workflowOf(
        [{ file: 'b/Todo.tasks.md', text: '## A\n\n## B\n' }],
        () => require('crypto').randomUUID(),
    );
    const ids = [columns[0].id, ...columns[0].tasks.map((task) => task.id)];
    assert.strictEqual(new Set(ids).size, 3);
    for (const value of ids) assert.match(value, /^[0-9a-f-]{36}$/);
});

/** Ids a test can read: `id-1`, `id-2`, … in the order they are minted. */
function id() {
    let n = 0;
    return () => `id-${++n}`;
}

// ── the migration itself ──────────────────────────────────────────────────────

test('a folder of columns becomes one document beside it, and the folder goes', () => {
    const root = newStore();
    write(path.join(root, 'backlog/board/01 - Todo.tasks.md'),
        md('# Todo', '', '## Write the plan', '', '```yaml', 'model: opus', 'effort: high',
            'permission: manual', 'folder: "/"', '```', '', 'Introduction.', ''));
    write(path.join(root, 'backlog/board/02 - Done.tasks.md'), '## Shipped\n');

    const log = run(root);

    const document = read(path.join(root, 'backlog/board.workflow.json'));
    assert.strictEqual(document.docType, 'KiaoWorkflow');
    assert.strictEqual(document.docTypeVersion, 1);
    assert.deepStrictEqual(
        document.content.columns.map((column) => column.title),
        ['01 - Todo', '02 - Done'],
    );
    assert.deepStrictEqual(document.content.columns[0].tasks[0].settings, {
        model: 'opus', effort: 'high', permission: 'manual', folder: '/',
    });
    assert.strictEqual(fs.existsSync(path.join(root, 'backlog/board')), false);
    assert.match(log, /1 board\(s\) converted/);
});

test('a folder holding more than its columns is kept, and says so', () => {
    const root = newStore();
    write(path.join(root, 'board/Todo.tasks.md'), '## A\n');
    write(path.join(root, 'board/README.md'), 'about this board\n');

    const log = run(root);

    assert.ok(fs.existsSync(path.join(root, 'board.workflow.json')));
    assert.ok(fs.existsSync(path.join(root, 'board/README.md')));
    assert.strictEqual(fs.existsSync(path.join(root, 'board/Todo.tasks.md')), false);
    assert.match(log, /kept — 1 other file/);
});

test('a document that is already there is never written over', () => {
    const root = newStore();
    write(path.join(root, 'board/Todo.tasks.md'), '## A\n');
    write(path.join(root, 'board.workflow.json'), '{"mine":true}');

    const log = run(root);

    assert.deepStrictEqual(read(path.join(root, 'board.workflow.json')), { mine: true });
    assert.ok(fs.existsSync(path.join(root, 'board/Todo.tasks.md')));
    assert.match(log, /NOT converted/);
});

test('running it again does nothing at all', () => {
    const root = newStore();
    write(path.join(root, 'board/Todo.tasks.md'), '## A\n');

    run(root);
    const first = fs.readFileSync(path.join(root, 'board.workflow.json'), 'utf8');
    const log = run(root);

    assert.strictEqual(fs.readFileSync(path.join(root, 'board.workflow.json'), 'utf8'), first);
    assert.match(log, /0 board\(s\) converted/);
});

test('a folder the store declares is not content is left alone', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\nsource\n');
    write(path.join(root, 'source/board/Todo.tasks.md'), '## A\n');
    write(path.join(root, 'work/board/Todo.tasks.md'), '## A\n');

    run(root);

    assert.ok(fs.existsSync(path.join(root, 'source/board/Todo.tasks.md')));
    assert.strictEqual(fs.existsSync(path.join(root, 'source/board.workflow.json')), false);
    assert.ok(fs.existsSync(path.join(root, 'work/board.workflow.json')));
});

test('several boards in one store are converted independently', () => {
    const root = newStore();
    write(path.join(root, 'a/board/Todo.tasks.md'), '## A\n');
    write(path.join(root, 'b/plan/Todo.tasks.md'), '## B\n');

    const log = run(root);

    assert.ok(fs.existsSync(path.join(root, 'a/board.workflow.json')));
    assert.ok(fs.existsSync(path.join(root, 'b/plan.workflow.json')));
    assert.match(log, /2 board\(s\) converted/);
});
