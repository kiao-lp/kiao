/**
 * Tests for lib/link-fix.js, the JS half of worker's link fixer.
 *
 *     node --test "migrations/test/link-fix.test.js"
 *
 * What is asserted here is the shape of a link token — what counts as one and what merely looks
 * like one — because that is the half of the pass the two implementations have to agree on down to
 * the byte. Its twin is `TestLinkFixColonBoundaryLeavesUrlsAlone` and its neighbours in
 * `operation/worker/linkfix_test.go`, and the cases are deliberately the same ones.
 *
 * It lives in this subdirectory because the runner discovers `V<NNN>__<name>.js` in the folder
 * above; a test file here is never mistaken for a migration.
 */

const test = require('node:test');
const assert = require('node:assert');

const { renameOp, fixLine } = require('../lib/link-fix');

const DOC = 'units/abc/abc.mlunit.json';
const MOVED = 'cours/abc/abc.mlunit.json';

/** The op a unit that moved would be fixed with. The path is given bare; the pattern anchors it. */
const movedUnit = () => renameOp(DOC, MOVED);

test('a markdown scheme carries a path, and the path is maintained', () => {
    const op = movedUnit();
    assert.strictEqual(fixLine(`[a](unit::/${DOC})`, op).line, `[a](unit::/${MOVED})`);
    assert.strictEqual(fixLine(`[b](template::/${DOC})`, op).line, `[b](template::/${MOVED})`);
    // No leading slash, so not a link — the scheme in front of it changes nothing.
    assert.strictEqual(fixLine(`bare unit::${DOC} here`, op).line, `bare unit::${DOC} here`);
});

test('a link is a path with a leading slash, and nothing else is one', () => {
    // The rule the whole pass now rests on. A store's root folders are ordinary words, and a bare
    // path token in prose, in a shell snippet or in a pasted stack trace is not a reference. What
    // it costs is a document-relative markdown link, which points somewhere else anyway.
    const op = movedUnit();
    const unchanged = [
        `cp ${DOC} /tmp`,
        `the ${DOC} of that unit`,
        `[a](${DOC})`,
        `"${DOC}"`,
    ];
    for (const line of unchanged) {
        assert.strictEqual(fixLine(line, op).line, line, line);
    }
    assert.strictEqual(fixLine(`[a](/${DOC})`, op).line, `[a](/${MOVED})`);
});

test('a members entry and a quoted value are the same token', () => {
    const op = movedUnit();
    assert.strictEqual(fixLine(`{"members":["/${DOC}"]}`, op).line, `{"members":["/${MOVED}"]}`);
    assert.strictEqual(fixLine(`unit: /${DOC}`, op).line, `unit: /${MOVED}`);
});

test('a url that ends in a store path is not a link to it', () => {
    // Not because a scheme is recognised — nothing here parses one — but because the byte in front
    // of the path is the '/' that follows the host, and a '/' is no boundary.
    const op = movedUnit();
    const unchanged = [
        `see http://host/${DOC} ok`,
        `see https://host/${DOC} ok`,
        `see https://host:8080/${DOC} ok`,
        `see file:///${DOC} ok`,
        'see http://units/abc/abc.mlunit.json ok',
        `see /dashboard/${DOC} ok`,
    ];
    for (const line of unchanged) {
        assert.strictEqual(fixLine(line, op).line, line, line);
    }
});

test('a colon ends a token as well as starting one', () => {
    const op = movedUnit();
    assert.strictEqual(fixLine(`see /${DOC}: it moved`, op).line, `see /${MOVED}: it moved`);

    const folder = renameOp('docs/old', 'docs/new');
    assert.strictEqual(fixLine('[a](/docs/old/my:file.md)', folder).line, '[a](/docs/new/my:file.md)');
});

test('`config` is only a link when it carries a leading slash', () => {
    // The case that first asked for the anchoring, back when it was an option. A ':' in front of a
    // bare `config/values` does not make it a link either: there is no leading slash to match.
    const op = renameOp('/config', '/kiao-user-config');
    const unchanged = ['cd config/values && ls', 'read ~/.config/app.json', 'note:config/values'];
    for (const line of unchanged) {
        assert.strictEqual(fixLine(line, op).line, line, line);
    }
    assert.strictEqual(fixLine('[v](/config/values/kiao.json)', op).line,
        '[v](/kiao-user-config/values/kiao.json)');
});

test('a markdown destination is escaped when the new path could not sit in one raw', () => {
    // A destination ends at its first space, so a rename onto a titled folder has to come back
    // percent-encoded there — whatever form the reference was written in, since that form was
    // decided by the old path and a docId never needed escaping.
    const op = renameOp('/units/abc', '/units/Mon titre');
    assert.strictEqual(fixLine('[a](/units/abc/abc.mlunit.json)', op).line,
        '[a](/units/Mon%20titre/abc.mlunit.json)');
    assert.strictEqual(fixLine('[a](unit::/units/abc/abc.mlunit.json)', op).line,
        '[a](unit::/units/Mon%20titre/abc.mlunit.json)');
});

test('everything that is not a destination keeps the path as it reads', () => {
    // A members entry is a JSON string, and every reader of one hands what it finds straight to
    // getFile, which takes the path undecoded. The two contexts are written differently in one line.
    const op = renameOp('/units/abc', '/units/Mon titre');
    assert.strictEqual(fixLine('  "members": ["/units/abc/abc.mlunit.json"],', op).line,
        '  "members": ["/units/Mon titre/abc.mlunit.json"],');
    assert.strictEqual(fixLine('see /units/abc/cadre.md for the framing', op).line,
        'see /units/Mon titre/cadre.md for the framing');
});

test('a new path with nothing to escape is written the way the reference was', () => {
    // The narrow rule: only a space forces the issue. A rename between two spaceless names leaves
    // an escaped reference escaped and a raw one raw, exactly as before.
    const op = renameOp('/docs/🎓/Board', '/docs/🎓/LearnBoard');
    assert.strictEqual(fixLine('[a](/docs/🎓/Board/note.md)', op).line, '[a](/docs/🎓/LearnBoard/note.md)');
    assert.strictEqual(fixLine('[a](/docs/%F0%9F%8E%93/Board/note.md)', op).line,
        '[a](/docs/%F0%9F%8E%93/LearnBoard/note.md)');
});
