/**
 * Applied migrations are immutable: pinning their checksums.
 *
 *     node --test "migrations/test/applied-migrations-immutable.test.js"
 *
 * The worker records the sha256 of every migration script it applies and refuses to start when a
 * script on disk no longer matches the ledger ("checksum mismatch for already-applied migration").
 * That covers the whole file, comments included: rewording a comment of an applied script stops
 * every server that already applied it, as V008 proved. So an applied script is never edited — a
 * fix is a new V<NNN> script — and this test fails on any edit, deletion, or unregistered addition.
 *
 * Writing the next migration: add its `V<NNN>__<name>.js` line below with the sha256 of the file
 * (`sha256sum migrations/V<NNN>__<name>.js`), beside the code. Nothing else here ever changes.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..');

// sha256 hex of the exact bytes the production ledger recorded as applied.
const PINNED = {
    'V001__rename-root-folders.js': '388133c0edd4487ddc2f4f4cfa9c27d284d55ebfe27494b22d35f014071f644b',
    'V002__tasks-boards-to-workflow.js': '234ea607744bafdd386883f7bbd9d5747a4def6475090d533bd67467bd02dd77',
    'V003__unit-links-by-path.js': '95bc61c59f736c011a8ba56b4e4ebbc46f3d5128fc8f4473542f0aee7dfcbda5',
    'V004__mindmap-binary-relations.js': 'cea84fa2ab1b25c58c63aaf0051f28800515fe060812ff93fde32202a0511739',
    'V005__mindmap-straight-relations.js': '575d88821c738805781c5453306928c9921417a3acf3f68e646f8f6a1f046e32',
    'V006__workflow-task-agent.js': '9a2c39e21e13d7881270dcdefc910cd8bb084b3defa3813584b05d5830733615',
    'V007__unit-folders-by-title.js': '7cd28538ca0377bbbdad473ea48c1fd7dfe0d0cf963d171bd1109c6b54297889',
    'V008__drop-dangling-members.js': '984644ee848864981963cbec1bcb15d8b1c737c7a2d2568b40e5154a1ee358e1',
    'V009__absolute-internal-links.js': 'c8fe8788f64c7451b18246aa5ce668103812061ff25c03590f7d5d5a38fbabbb',
    'V010__workflow-tasks-out-of-columns.js': '98befd106edf493d047902eff7539440d63879e270d8296f2a0367a2458c8478',
    'V011__workflow-boards-to-seed-sql.js': '55b3dda43b3c231e31ccf4b3228521fe9d93ede197831570a0e3700a13a9dd3e',
    'V012__boards-seed-compact-box.js': 'a9445fed83ccf53f3594c7a49336cdaa3465bf3b85472f736ef35d5bf0b19a46',
    'V013__workflow-tasks-are-flow-nodes.js': '91fd864d1a5505ab990ccf387d61fe9b7afaeca5d6402bfb9e77c51ccfed12d6',
    'V014__mlex-flatten-titles.js': 'cd1b955103f2cad0dc6a918003829ce69efc42c632037882428e057d84805bab',
    'V015__bookmarks-to-json.js': '8a6565db2e9be432f9d9a1de658848ab6ea2c0a9d1d81df86ec6a7edd3fd671d',
    'V016__dashboard-rename.js': 'f8659a42406f5768795afafb5e92e4157365bdd08fee512f73fdc7273bf39942',
    'V017__values-object-field.js': '482dfdde839053b34697a985a41b47a4b98e77c319dd0951ce9ab290f9907e90',
};

const sha256Hex = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const onDisk = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^V\d+__.+\.js$/.test(name));

test('every migration script on disk is registered here', () => {
    const unregistered = onDisk.filter((name) => !(name in PINNED));
    assert.deepStrictEqual(unregistered, [],
        `new migration script(s) without a pinned checksum: ${unregistered.join(', ')}. ` +
        `Add each with its sha256 to PINNED in ${path.basename(__filename)} — and if one of these ` +
        `is a rename of an applied script, undo it: the worker matches the ledger by version, ` +
        `but a rename still rewrites history every checkout diffs against.`);
});

test('every pinned migration script is still on disk, byte-identical', () => {
    for (const [name, checksum] of Object.entries(PINNED)) {
        const file = path.join(MIGRATIONS_DIR, name);
        assert.ok(fs.existsSync(file),
            `${name} is gone from ${MIGRATIONS_DIR}: an applied migration is never deleted.`);
        assert.strictEqual(sha256Hex(file), checksum,
            `${name} changed on disk: an applied migration is never edited, not even its comments ` +
            `— the worker checksums the whole file and refuses to start on a mismatch. ` +
            `Revert it and ship the fix as a new V<NNN> script.`);
    }
});
