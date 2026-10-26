#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

// Deliver runtime resources only, replacing the previous script set in full.
function stage(manifest, destination) {
    const assembly = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (!assembly.base || !Array.isArray(assembly.additional)) throw new Error('Expected base and additional sources');
    const ids = new Set();
    const dirs = new Set();
    const sources = [assembly.base, ...assembly.additional].map((entry, index) => {
        const dir = fs.realpathSync(path.resolve(path.dirname(manifest), entry));
        const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
        if (!/^[a-z][a-z0-9._-]*$/.test(source.id) || ids.has(source.id) || dirs.has(dir)) {
            throw new Error(`Invalid or duplicate migration source: ${dir}`);
        }
        if (!Number.isSafeInteger(source.baseline) || source.baseline < 0) throw new Error(`Invalid baseline: ${dir}`);
        if (source.legacyLastScript) {
            const terminal = /^V(\d+)__.+\.js$/.exec(source.legacyLastScript);
            if (index !== 0 || !terminal || source.baseline === 0 || Number(terminal[1]) !== source.baseline) {
                throw new Error(`Invalid legacy endpoint: ${dir}`);
            }
        }
        if (dir === destination || dir.startsWith(destination + path.sep) || destination.startsWith(dir + path.sep)) {
            throw new Error('Source and destination directories must be disjoint');
        }
        ids.add(source.id);
        dirs.add(dir);
        const versions = new Set();
        const scripts = fs.readdirSync(dir).filter(name => /^V\d+__.+\.js$/.test(name));
        for (const name of scripts) {
            const version = Number(/^V(\d+)/.exec(name)[1]);
            if (!Number.isSafeInteger(version) || version <= source.baseline || versions.has(version)) {
                throw new Error(`Retired or duplicate migration version: ${dir}/${name}`);
            }
            if (!fs.lstatSync(path.join(dir, name)).isFile()) throw new Error(`Not a regular migration script: ${name}`);
            versions.add(version);
        }
        return { dir, scripts, relative: index === 0 ? '.' : `sources/${source.id}` };
    });
    const temporary = destination + `.tmp-${process.pid}`;
    fs.rmSync(temporary, { recursive: true, force: true });
    try {
        for (const source of sources) {
            const target = path.join(temporary, source.relative);
            fs.mkdirSync(target, { recursive: true });
            for (const name of ['source.json', ...source.scripts]) {
                fs.copyFileSync(path.join(source.dir, name), path.join(target, name));
            }
            const lib = path.join(source.dir, 'lib');
            if (fs.existsSync(lib)) fs.cpSync(lib, path.join(target, 'lib'), { recursive: true, dereference: true });
        }
        fs.writeFileSync(path.join(temporary, 'sources.json'), JSON.stringify({
            base: '.', additional: sources.slice(1).map(source => source.relative),
        }, null, 2) + '\n');
        fs.rmSync(destination, { recursive: true, force: true });
        fs.renameSync(temporary, destination);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

if (require.main === module) {
    if (process.argv.length !== 4) throw new Error('Usage: stage-file-migrations.js <sources.json> <destination>');
    stage(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
}

module.exports = { stage };
