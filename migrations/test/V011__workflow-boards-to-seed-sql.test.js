/**
 * Tests for V011__workflow-boards-to-seed-sql.js.
 *
 *     node --test "migrations/test/V011*.test.js"
 *
 * The migration is run the way the runner runs it — a child process, given the data root as
 * argv[2] — because half of what is being asserted is what it refuses to do, and a script that is
 * required rather than spawned could not be trusted to have refused for the right reason.
 *
 * The golden file beside this test is the whole script one rich store produces. It was diffed
 * against what Go seedgen writes for the same files (`BEGIN;` on, byte for byte) and imported
 * into a real PostgreSQL before being committed, so it pins the port rather than merely the
 * current output.
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

const MIGRATION = path.join(__dirname, '..', 'V011__workflow-boards-to-seed-sql.js');
const EXPECTED = path.join(__dirname, 'boards-seed-v011.expected.sql');

// realpath: on some platforms the temp directory is reached through a symlink, and the ignore
// matcher compares a path against the root it was built with.
function newStore() {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-v011-')));
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

function writeJson(file, obj) {
    write(file, JSON.stringify(obj, null, 2));
}

/** Runs the migration the way the runner does, and returns everything it printed. */
function run(root) {
    const res = spawnSync(process.execPath, [MIGRATION, root], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `migration exited ${res.status}: ${res.stderr}`);
    return res.stdout + res.stderr;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const exists = (file) => fs.existsSync(file);

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T4 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T5 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const T6 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const T7 = '12345678-1234-4123-8123-123456789abc';

/** The store the golden file was generated from: flat, nested, bare and empty boards, colliding
 * ids and slugs, and one file template both exporters skip. */
function writeRichStore(root) {
    writeJson(path.join(root, 'backlog', 'Major.workflow.json'), {
        docType: 'KiaoWorkflow',
        docId: '99999999-9999-4999-8999-999999999999',
        docTypeVersion: 2,
        content: {
            columns: [
                { id: C1, title: 'Todo' },
                { id: C2, title: 'Doing', notes: "In progress — don't touch" },
            ],
            tasks: [
                {
                    id: T1, column: C1, title: "L'ami du matin", type: 'ai',
                    tags: ['bug', '  UI ', 'BUG', '', 'two  words'],
                    body: "Do it.\n\nSecond line with 'quotes' and <angle> & ampersand.",
                    settings: { agent: 'claude', model: 'opus', effort: 'high', permission: 'manualLive', folder: '/', extra1: 'a<b>&"c"', zebra: 'last' },
                    status: 'running', chat: 'chat-1',
                    onSuccess: { task: T2, mode: 'compact' },
                    log: '> Asked.\n\nAnswered.',
                    spot: { x: 10.6, y: -3.2 },
                },
                { id: T2, column: C1, title: 'Second', type: 'ai', settings: { agent: 'claude', model: 'opus', effort: 'low', permission: 'manual', folder: '/docs' }, status: 'waiting-refresh', onSuccess: T3 },
                { id: T3, column: 'no-such-column', title: 'Lost column', status: 'bogus-status', onSuccess: { task: 'deadbeef-dead-beef-dead-beefdeadbeef', mode: 'continue' } },
                { id: T4, title: 'Backlog human', body: '', status: 'done', type: 'human', onSuccess: { task: T1, mode: 'compact' } },
                { id: T5, column: C2, title: 'Scheduler', type: 'scheduler', at: '2026-09-03T22:00', onSuccess: { task: T6, mode: 'end' }, status: 'draft' },
                { id: T6, column: C2, title: 'Shutdown', type: 'shutdown', onSuccess: { task: T1, mode: 'continue' } },
                { id: T7, column: C2, title: 'Typeless with model', settings: { model: 'opus' }, onSuccess: 42, status: 'error', tags: ['solo'] },
            ],
        },
    });
    writeJson(path.join(root, 'teams', 'Alpha.workflow.json'), {
        docType: 'KiaoWorkflow',
        docId: 'not-a-uuid',
        content: {
            columns: [
                { id: C1, title: 'Refine', tasks: [{ id: T1, title: 'Same id as Major card', body: 'collision' }] },
                { id: C2, title: 'Done', tasks: [] },
            ],
            tasks: [{ id: T2, column: C2, title: 'Listed alongside', type: 'ai', settings: { agent: 'codex', model: 'gpt', effort: 'max', permission: 'bypassPermissions', folder: '/x' }, at: 'garbage', spot: { x: 0, y: 0 } }],
        },
    });
    writeJson(path.join(root, 'Single.workflow.json'), { columns: [], tasks: [] });
    writeJson(path.join(root, 'backlog', 'Sprint!.workflow.json'), {
        docType: 'KiaoWorkflow', docId: T3,
        content: { columns: [{ id: C1, title: 'A' }], tasks: [{ id: T4, column: C1, title: 't' }] },
    });
    writeJson(path.join(root, 'teams', 'Sprint?.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C2, title: 'B' }], tasks: [{ id: T5, column: C2, title: 'u' }] },
    });
    writeJson(path.join(root, 'backlog', 'Café Équipe.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'A' }], tasks: [{ id: T6, column: C1, title: 'v' }] },
    });
    writeJson(path.join(root, 'kiao-user-config', 'file-templates', 'ClaudeBoard.workflow.json'), {
        docType: 'KiaoWorkflow', docId: 'e6eb4160-a318-4335-bc93-918b2d2dfac4',
        content: { columns: [{ id: C1, title: 'Refine' }], tasks: [] },
    });
}

test('exports every board to boards-seed.sql, exactly as seedgen would', () => {
    const root = newStore();
    writeRichStore(root);

    const output = run(root);

    const script = path.join(root, 'boards-seed.sql');
    assert.ok(exists(script), 'the script is at the store root');
    const normalised = read(script).replace(
        /(Generated by migrations\/V011__workflow-boards-to-seed-sql\.js on )\d{4}-\d{2}-\d{2}/,
        '$1DATE');
    assert.strictEqual(normalised, read(EXPECTED));

    for (const gone of [
        'backlog/Major.workflow.json', 'teams/Alpha.workflow.json', 'Single.workflow.json',
        'backlog/Sprint!.workflow.json', 'teams/Sprint?.workflow.json', 'backlog/Café Équipe.workflow.json',
    ]) {
        assert.ok(!exists(path.join(root, gone)), `${gone} was deleted`);
    }
    // The template is board-shaped and is not a board.
    assert.ok(exists(path.join(root, 'kiao-user-config', 'file-templates', 'ClaudeBoard.workflow.json')));
    assert.doesNotMatch(read(script), /ClaudeBoard/);

    assert.match(output, /6 board\(s\), 12 card\(s\) exported to boards-seed\.sql; 6 file\(s\) deleted/);
    assert.match(output, /given a fresh one/);
    assert.match(output, /1 board template\(s\) under kiao-user-config\/file-templates\/ skipped/);
});

/** A board is exported whole or left whole: one bad card costs the board, not its siblings. */
test('leaves a board alone whose cards cannot be carried, and names it', () => {
    const root = newStore();
    const bad = path.join(root, 'backlog', 'Broken.workflow.json');
    writeJson(bad, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: [{ id: 'not-an-id', title: 'No identity' }] },
    });
    const noColumnId = path.join(root, 'backlog', 'NoColumn.workflow.json');
    writeJson(noColumnId, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ title: 'Todo' }], tasks: [] },
    });
    const noList = path.join(root, 'backlog', 'NoList.workflow.json');
    writeJson(noList, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: { not: 'a list' } },
    });
    const good = path.join(root, 'backlog', 'Fine.workflow.json');
    writeJson(good, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: [{ id: T1, column: C1, title: 'One' }] },
    });
    const before = [bad, noColumnId, noList].map(read);

    const output = run(root);

    assert.deepStrictEqual([bad, noColumnId, noList].map(read), before);
    assert.ok(!exists(good), 'the exportable board was still exported and deleted');
    assert.match(output, /Broken\.workflow\.json: left alone — card "No identity" has no usable id/);
    assert.match(output, /NoColumn\.workflow\.json: left alone — column 0 \("Todo"\) has no id/);
    assert.match(output, /NoList\.workflow\.json: left alone — its "tasks" is not a list of cards/);
    assert.match(output, /1 board\(s\), 1 card\(s\) exported to boards-seed\.sql; 1 file\(s\) deleted; 3 file\(s\) left alone/);
});

test('leaves a .workflow.json that is not a board alone, and writes no script for none', () => {
    const root = newStore();
    const stray = path.join(root, 'notes.workflow.json');
    write(stray, JSON.stringify({ docType: 'SomethingElse', content: { columns: [{ id: 'c' }] } }));
    const notJson = path.join(root, 'broken.workflow.json');
    write(notJson, 'not json at all');
    const noColumns = path.join(root, 'empty.workflow.json');
    write(noColumns, JSON.stringify({ docType: 'KiaoWorkflow', content: { lanes: [] } }));
    const before = [stray, notJson, noColumns].map(read);

    const output = run(root);

    assert.deepStrictEqual([stray, notJson, noColumns].map(read), before);
    assert.ok(!exists(path.join(root, 'boards-seed.sql')), 'no boards means no script');
    assert.match(output, /no boards to export \(3 \.workflow\.json file\(s\) scanned, all skipped\)/);
    assert.match(output, /broken\.workflow\.json: left alone — not JSON/);
});

// The name is unique in the database: carrying the second would fail the whole script at import,
// after the files were gone.
test('exports the first of two boards answering to one name, and keeps the second', () => {
    const root = newStore();
    writeJson(path.join(root, 'a', 'Sprint.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'A' }], tasks: [{ id: T1, column: C1, title: 't' }] },
    });
    const kept = path.join(root, 'b', 'sprint.workflow.json');
    writeJson(kept, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'B' }], tasks: [{ id: T2, column: C1, title: 'u' }] },
    });
    const before = read(kept);

    const output = run(root);

    assert.strictEqual(read(kept), before);
    assert.match(output, /b\/sprint\.workflow\.json: left alone — a board named "Sprint" was already exported/);
    assert.match(output, /1 board\(s\), 1 card\(s\) exported/);
});

test('never writes over a script the operator put at the root', () => {
    const root = newStore();
    writeJson(path.join(root, 'board.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: [{ id: T1, column: C1, title: 'One' }] },
    });
    const operators = path.join(root, 'boards-seed.sql');
    write(operators, '-- the operator’s own export\n');

    const output = run(root);

    assert.strictEqual(read(operators), '-- the operator’s own export\n');
    assert.ok(exists(path.join(root, 'boards-seed-2.sql')));
    assert.match(output, /exported to boards-seed-2\.sql/);
    assert.ok(!exists(path.join(root, 'board.workflow.json')));
});

// A scalar where text belongs is what a hand-written board says plainly; a spot that is not a
// place is cosmetic, and costs the spot rather than the board.
test('carries a hand-written board across small type sins, and says so', () => {
    const root = newStore();
    writeJson(path.join(root, 'hand.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: {
            columns: [{ id: C1, title: 'Todo' }],
            tasks: [{
                id: T1, column: C1, title: 'One', type: 'ai',
                tags: ['bug', 2024, null], body: 42,
                settings: { agent: 'claude', model: 'opus', effort: 'high', permission: 'manual', folder: '/', retries: 3 },
                spot: { x: 'high', y: 0 },
            }],
        },
    });

    const output = run(root);

    const script = read(path.join(root, 'boards-seed.sql'));
    assert.match(script, /'2024'/);
    assert.match(script, /'42'/);
    assert.match(script, /"retries":"3"/);
    assert.match(script, /NULL, NULL,\n   NULL, NULL, 'end',/);
    assert.match(output, /its spot is not a place, and was dropped/);
    assert.ok(!exists(path.join(root, 'hand.workflow.json')));
});

test('refuses a board whose settings are not an object of text', () => {
    const root = newStore();
    const file = path.join(root, 'odd.workflow.json');
    writeJson(file, {
        docType: 'KiaoWorkflow',
        content: {
            columns: [{ id: C1, title: 'Todo' }],
            tasks: [{ id: T1, column: C1, title: 'One', settings: { nested: { deep: true } } }],
        },
    });
    const before = read(file);

    const output = run(root);

    assert.strictEqual(read(file), before);
    assert.ok(!exists(path.join(root, 'boards-seed.sql')));
    assert.match(output, /odd\.workflow\.json: left alone — card "[^"]*": setting "nested" is not text/);
});

test('honours the store’s .kiao-files', () => {
    const root = newStore();
    write(path.join(root, '.kiao-files'), '[migration]\n/fixtures\n');
    const skipped = path.join(root, 'fixtures', 'sample.workflow.json');
    writeJson(skipped, {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: [{ id: T1, column: C1, title: 'One' }] },
    });
    const before = read(skipped);

    run(root);

    assert.strictEqual(read(skipped), before, 'a declared-out-of-bounds board is not migrated');
    assert.ok(!exists(path.join(root, 'boards-seed.sql')));
});

test('is a no-op the second time', () => {
    const root = newStore();
    writeJson(path.join(root, 'board.workflow.json'), {
        docType: 'KiaoWorkflow',
        content: { columns: [{ id: C1, title: 'Todo' }], tasks: [{ id: T1, column: C1, title: 'One' }] },
    });

    run(root);
    const once = read(path.join(root, 'boards-seed.sql'));
    const output = run(root);

    assert.strictEqual(read(path.join(root, 'boards-seed.sql')), once);
    assert.ok(!exists(path.join(root, 'boards-seed-2.sql')));
    assert.match(output, /no boards to export/);
});

test('writes nothing for a store with no boards', () => {
    const root = newStore();
    write(path.join(root, 'docs', 'note.md'), '# hello\n');

    const output = run(root);

    assert.ok(!exists(path.join(root, 'boards-seed.sql')));
    assert.match(output, /no boards to export\./);
});
