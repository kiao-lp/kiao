const fs = require('fs');
const path = require('path');
const helpers = process.env.KIAO_MIGRATION_LIB || path.join(__dirname, 'lib');
const { dataRoot, loadIgnore, scan } = require(path.join(helpers, 'kiao-fs'));

const MOVED = ['status', 'role', 'provenance'];
const STATUSES = new Set(['DRAFT', 'EXPERIMENTAL', 'APPROVED']);
const ROLES = new Set(['PRIMARY_SOURCE', 'DERIVED']);
const FRONTMATTER = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m;

function scalarValue(line) {
    const rest = line.slice(line.indexOf(':') + 1).trim();
    const plain = rest.replace(/\s+#.*$/, '').trim();
    const quoted = plain.match(/^"([^"]*)"$/) || plain.match(/^'([^']*)'$/);
    return quoted ? quoted[1] : plain.split(/\s/)[0];
}

function frontmatterEntries(lines) {
    const entries = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const top = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t].*)?$/);
        if (top) {
            current = { key: top[1], start: i, end: i + 1 };
            entries.push(current);
        } else if (current && /^[ \t]/.test(line)) {
            current.end = i + 1;
        } else if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
            return null;
        }
    }
    return entries;
}

function childKeys(lines, entry) {
    const keys = new Set();
    for (let i = entry.start + 1; i < entry.end; i++) {
        const m = lines[i].match(/^[ \t]+([A-Za-z_][A-Za-z0-9_-]*):/);
        if (m) keys.add(m[1]);
    }
    return keys;
}

function indented(lines, entry) {
    const out = [];
    for (let i = entry.start; i < entry.end; i++) {
        out.push(lines[i] === '' ? '' : '  ' + lines[i]);
    }
    return out;
}

function transform(text) {
    const match = FRONTMATTER.exec(text);
    if (!match || match.index !== 0) return null;
    const opening = match[1];
    const bodyStart = match[0].length;
    const front = match[2].replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = front.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const entries = frontmatterEntries(lines);
    if (!entries) return null;
    const byKey = new Map();
    for (const e of entries) {
        if (byKey.has(e.key)) return null;
        byKey.set(e.key, e);
    }
    const moved = entries.filter((e) => MOVED.includes(e.key));
    if (moved.length === 0) return null;
    for (const e of moved) {
        const value = scalarValue(lines[e.start]);
        if (e.key === 'status' && !STATUSES.has(value)) return null;
        if (e.key === 'role' && !ROLES.has(value)) return null;
        if (e.key === 'provenance' && (value.startsWith('[') || value.startsWith('{'))) return null;
    }
    const existing = byKey.get('document');
    if (existing) {
        const head = lines[existing.start].slice(lines[existing.start].indexOf(':') + 1).trim();
        if (head !== '' && head !== '|' && head !== '>') return null;
        if (existing.end - existing.start > 1 && childKeys(lines, existing).size === 0) return null;
    }
    const removed = new Set();
    for (const e of moved) for (let i = e.start; i < e.end; i++) removed.add(i);
    const present = existing ? childKeys(lines, existing) : new Set();
    const additions = moved.filter((e) => !present.has(e.key)).flatMap((e) => indented(lines, e));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (existing && i === existing.end - 1 && additions.length > 0) {
            out.push(lines[i]);
            out.push(...additions);
            continue;
        }
        if (removed.has(i)) {
            if (!existing && i === moved[0].start) {
                out.push('document:');
                out.push(...moved.flatMap((e) => indented(lines, e)));
            }
            continue;
        }
        out.push(lines[i]);
    }
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const yaml = out.join('\n') + '\n';
    const rebuilt = opening + yaml.replace(/\n/g, newline) + match[3] + text.slice(bodyStart);
    return rebuilt === text ? null : rebuilt;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`migration: operating on ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`migration: honouring ${ignore.patterns.length} .kiao-files rule(s): ` +
            ignore.patterns.join(' '));
    }
    const files = scan(root, ['.md'], ignore)
        .filter((f) => path.basename(f) !== 'SKILL.md'
            && !f.endsWith('.temp.md') && !f.endsWith('.arch.md'));
    let changed = 0;
    let skipped = 0;
    for (const file of files) {
        let text;
        try {
            const buf = fs.readFileSync(file);
            text = buf.toString('utf8');
            if (!Buffer.from(text, 'utf8').equals(buf)) { skipped++; continue; }
        } catch { skipped++; continue; }
        const next = transform(text);
        if (next === null) {
            const head = FRONTMATTER.exec(text);
            if (head && head.index === 0 && /^(status|role|provenance):/m.test(head[2])) skipped++;
            continue;
        }
        fs.writeFileSync(file, next, 'utf8');
        console.log(`migration: ${path.relative(root, file)}`);
        changed++;
    }
    console.log(`migration: done — ${changed} file(s) changed, ${skipped} skipped.`);
}

if (require.main === module) main();
module.exports = { transform };
