/**
 * The migration half of `toStoreName`, checked against the table both halves read.
 *
 * The other half is `toStoreName` in kiao-worker (`reference/kiao-worker/src/utils.ts`),
 * which currently has no test reading this table — the corpus is exercised here only.
 * Nothing here restates a case: a rule the two must agree on belongs in
 * `store-name-corpus.json`, and only what is specific to this implementation is written
 * out below.
 */

const test = require('node:test');
const assert = require('node:assert');

const { toStoreName, MAX_NAME_BYTES } = require('../lib/store-name');
const corpus = require('./store-name-corpus.json');

test('the shared corpus', async (t) => {
    for (const { why, title, name } of corpus.cases) {
        await t.test(why, () => {
            assert.strictEqual(toStoreName(title, corpus.fallback), name);
        });
    }
});

test('a name is never longer than the cap, whatever it is made of', () => {
    for (const filler of ['a', 'é', '漢', '🎓']) {
        const name = toStoreName(filler.repeat(400), 'fallback');
        assert.ok(Buffer.byteLength(name, 'utf8') <= MAX_NAME_BYTES,
            `${filler}: ${Buffer.byteLength(name, 'utf8')} bytes`);
        assert.strictEqual(name, name.normalize('NFC'), `${filler}: not NFC`);
        assert.ok(!name.endsWith('�'), `${filler}: cut inside a character`);
    }
});

test('a title given twice gives the same name — a rename has to be idempotent', () => {
    const once = toStoreName('S 1 — Azure Monitor: the mental model', 'x');
    assert.strictEqual(toStoreName(once, 'x'), once);
});

test('an absent title is the empty one', () => {
    assert.strictEqual(toStoreName(undefined, 'fallback'), 'fallback');
    assert.strictEqual(toStoreName(null, 'fallback'), 'fallback');
});

test('a decomposed title is named the same as a composed one', () => {
    const composed = 'Créativité';           // é as one character
    const decomposed = 'Créativité';       // e + combining acute
    assert.strictEqual(toStoreName(decomposed, 'x'), toStoreName(composed, 'x'));
});

test('a name carries nothing the link fixer would read as a token boundary… except the ones that travel', () => {
    // ':' is a boundary AND opens a markdown scheme, so it must be gone. Space, quote, parens and
    // commas are boundaries too, but a stored reference is matched with them in place — the pattern
    // spells the old path out — so they stay, and a title keeps reading as a title.
    assert.ok(!toStoreName('a : b', 'x').includes(':'));
    assert.strictEqual(toStoreName("Ce n'est (pas) fini, non", 'x'), "Ce n'est (pas) fini, non");
});
