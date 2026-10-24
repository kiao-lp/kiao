const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stage } = require('../../bin/stage-file-migrations');

test('pub-only delivery contains runtime resources and replaces stale scripts', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-package-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const target = path.join(temporary, 'migrations');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'V001__stale.js'), 'throw Error("stale")');
    stage(path.resolve(__dirname, '../sources.json'), target);
    assert.equal(fs.existsSync(path.join(target, 'V001__stale.js')), false);
    assert.equal(fs.existsSync(path.join(target, 'examples')), false);
    assert.equal(fs.existsSync(path.join(target, 'test')), false);
    assert.equal(fs.existsSync(path.join(target, 'lib/kiao-fs.js')), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'sources.json'))), { base: '.', additional: [] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'source.json'))).id, 'kiao');
});

test('a relocated assembly retains identity and both shared and source-local dependencies', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-assembly-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const extension = path.join(temporary, 'extension');
    fs.mkdirSync(path.join(extension, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(extension, 'source.json'), '{"id":"extension","baseline":0}');
    fs.writeFileSync(path.join(extension, 'lib/answer.js'), 'module.exports = 42;');
    fs.writeFileSync(path.join(extension, 'V001__probe.js'), `
const { dataRoot } = require(process.env.KIAO_MIGRATION_LIB + '/kiao-fs');
require('fs').writeFileSync(dataRoot() + '/answer', String(require('./lib/answer')));`);
    const manifest = path.join(temporary, 'sources.json');
    fs.writeFileSync(manifest, JSON.stringify({ base: path.resolve(__dirname, '..'), additional: ['./extension'] }));
    const staged = path.join(temporary, 'staged');
    stage(manifest, staged);
    const relocated = path.join(temporary, 'installed elsewhere');
    fs.renameSync(staged, relocated);
    fs.rmSync(extension, { recursive: true });
    const assembly = JSON.parse(fs.readFileSync(path.join(relocated, 'sources.json')));
    const extra = path.join(relocated, assembly.additional[0]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(extra, 'source.json'))).id, 'extension');
    const result = spawnSync(process.execPath, [path.join(extra, 'V001__probe.js'), temporary], {
        cwd: temporary, encoding: 'utf8', env: { ...process.env, KIAO_MIGRATION_LIB: path.join(relocated, 'lib') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(temporary, 'answer'), 'utf8'), '42');
});

test('staging rejects retired scripts before replacing the last good delivery', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kiao-stale-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const base = path.join(temporary, 'base');
    fs.mkdirSync(base);
    fs.writeFileSync(path.join(base, 'source.json'), '{"id":"base","baseline":18}');
    fs.writeFileSync(path.join(base, 'V001__stale.js'), '');
    const manifest = path.join(temporary, 'sources.json');
    fs.writeFileSync(manifest, '{"base":"base","additional":[]}');
    const target = path.join(temporary, 'delivered');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'kept'), 'last good delivery');
    assert.throws(() => stage(manifest, target), /Retired/);
    assert.equal(fs.readFileSync(path.join(target, 'kept'), 'utf8'), 'last good delivery');
});
