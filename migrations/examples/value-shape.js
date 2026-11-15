// Pure source example; no store traversal or migration entry point.
const AT_ROOT = new Set(['type', 'value', 'object', '__pinned', '__pinnedAt']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isValue(entry) {
    return isObject(entry) && typeof entry.type === 'string' && typeof entry.value === 'string';
}

function migrateEntry(entry) {
    if (!isValue(entry)) return { changed: false };
    if ('object' in entry && !isObject(entry.object)) {
        return { changed: false, skipped: 'holds a non-object `object`' };
    }
    const flat = Object.keys(entry).filter((key) => !AT_ROOT.has(key));
    if (flat.length === 0) return { changed: false };
    // After whatever `object` already holds, the flat keys winning on a name both hold — the
    // dashboard reads the root first.
    const grouped = { ...(isObject(entry.object) ? entry.object : {}) };
    for (const key of flat) grouped[key] = entry[key];
    const next = { type: entry.type, value: entry.value, object: grouped };
    for (const key of ['__pinned', '__pinnedAt']) {
        if (key in entry) next[key] = entry[key];
    }
    return { changed: true, entry: next };
}

module.exports = { migrateEntry };
