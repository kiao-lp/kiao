const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pins = require('./active-checksums.json');

test('active migrations are registered and byte-identical to their delivered checksums', () => {
    const directory = path.join(__dirname, '..');
    const scripts = fs.readdirSync(directory).filter(name => /^V\d+__.+\.js$/.test(name)).sort();
    assert.deepEqual(scripts, Object.keys(pins).sort());
    for (const name of scripts) {
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex'), pins[name], name);
    }
});
