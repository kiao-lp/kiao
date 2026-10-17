/**
 * Shared helpers for worker migration scripts.
 *
 * A migration script is named `V<NNN>__<description>.js` and is run on startup by the
 * worker migration runner as:
 *
 *     node V<NNN>__<description>.js <data-root-abs-path>
 *
 * with the working directory set to the data root and the env vars KIAO_DATA_ROOT and
 * KIAO_MIGRATION_VERSION populated. A non-zero exit code marks the migration as failed and (by
 * default) aborts service startup, so scripts should throw / process.exit(1) on error.
 *
 * The data root can also be passed explicitly when running a migration by hand, exactly like
 * the old manual workflow:  `cd <data-root> && node V001__….js`
 *
 * The store is not necessarily a document store — see ../README.md. What in it is content is
 * declared by the store itself, in `.kiao-files` files that may sit in any folder, so `scan`
 * honours them by default and a hand-rolled walk must consult `loadIgnore()` for itself. Nothing
 * names the declaration to a script any more: it has a fixed name at a known place, so the data
 * root is all a script needs to find the whole set.
 */

const fs = require('fs');
const path = require('path');

/** Document file extensions understood by the store (see reference/npm/kiao-worker types). */
const DOCUMENT_EXTENSIONS = ['.mmap.json', '.mlunit.json', '.temp.md'];

/** The service's own state directory inside the data root. Never content. */
const STATE_DIR_NAME = '.kiao-config';

/** A folder's declaration of what, in it and below, is not KIAO content. See ../README.md. */
const KIAO_FILES_NAME = '.kiao-files';

/** What the declaration was called when it lived in the state directory and answered for migrations
 * alone. Still read when a store has not been served since, so a by-hand run on an unconverted
 * store honours the rules the operator wrote there. */
const LEGACY_IGNORE_FILE = 'migration-ignore';

/** The passes a declaration can bound, of those a migration has any business asking about. Patterns
 * written before any [section] apply to every pass, including the ones only worker runs —
 * `[search]`, which bounds a search and the scope a delete reports, is never consulted here. */
const CONCERN_MIGRATION = 'migration';
const CONCERN_REFACTOR = 'refactor';

/**
 * What the root declaration says when nobody has written one — the same list worker seeds
 * into a new store, so a migration run by hand on a store that has never been served is bounded
 * exactly like one run by the service.
 *
 * `.git` and the state directory are not here: they are excluded whatever a declaration says.
 */
const DEFAULT_EXCLUSIONS = [
    'node_modules',
    'bower_components',
    'vendor',
    'build',
    'dist',
    'out',
    'target',
    'coverage',
    '__pycache__',
    '.*',
];

/** Resolves the data root: argv[2], then $KIAO_DATA_ROOT, then the current working directory. */
function dataRoot() {
    return path.resolve(process.argv[2] || process.env.KIAO_DATA_ROOT || process.cwd());
}

/**
 * Compiles one pattern into a regex over paths relative to the folder that declared it.
 *
 * The two rules worth knowing are gitignore's: a pattern containing a slash is anchored at the
 * declaring folder, one without matches at any depth. A trailing slash is stripped before that
 * decision, so `vendor/` is the any-depth rule an author writing gitignore expects. A match on a
 * directory covers everything under it, which is why the trailing slash is decoration rather than a
 * third rule. `*` stops at a path separator; there is no `**`, no negation and no character class —
 * a store is protected by naming the folders that are not content, and that needs no more than this.
 */
function compilePattern(pattern) {
    let p = pattern.trim();
    while (p.endsWith('/')) p = p.slice(0, -1);
    const anchored = p.includes('/');
    while (p.startsWith('/')) p = p.slice(1);
    // A line of nothing but slashes names the declaring folder itself: none of it is content.
    if (p === '') return /^/;
    const body = p
        .split('/')
        .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? '[^/]*' : '\\' + ch)))
        .join('/');
    return new RegExp('^' + (anchored ? '' : '(?:.*/)?') + body + '(?:/.*)?$');
}

/**
 * Parses declaration text into rules per concern. Blank lines and `#` comments are dropped; a
 * `[section]` header narrows the patterns after it to one pass, and patterns before any header
 * apply to every pass. A section this build does not know is parsed and never consulted, so a later
 * consumer can be added without breaking an older reader.
 */
function parseDeclaration(text, dir, sourceFile = null) {
    const byConcern = { '': [] };
    const textByConcern = { '': [] };
    const patterns = [];
    let section = '';
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            section = line.slice(1, -1).trim().toLowerCase();
            if (!byConcern[section]) byConcern[section] = [];
            if (!textByConcern[section]) textByConcern[section] = [];
            continue;
        }
        patterns.push(line);
        byConcern[section].push(compilePattern(line));
        textByConcern[section].push(line);
    }
    return { dir: path.resolve(dir), sourceFile, patterns, byConcern, textByConcern };
}

/** The patterns in force for `concern`, verbatim — what a migration prints before it starts. */
function declRules(decl, concern) {
    return [...(decl.textByConcern[''] || []), ...(decl.textByConcern[concern] || [])];
}

/** True when `abs` is out of bounds for `concern` under this one declaration. */
function declExcludes(decl, abs, concern) {
    const rel = path.relative(decl.dir, abs).split(path.sep).join('/');
    // The declaring folder is the thing being walked, not an entry in it; and what is outside it is
    // none of its business.
    if (rel === '' || rel === '..' || rel.startsWith('../')) return false;
    const rules = [...(decl.byConcern[''] || []), ...(decl.byConcern[concern] || [])];
    return rules.some((re) => re.test(rel));
}

/** Reads a folder's own declaration, or null when it has none. */
function readDeclaration(dir) {
    try {
        return parseDeclaration(fs.readFileSync(path.join(dir, KIAO_FILES_NAME), 'utf8'), dir,
            path.join(dir, KIAO_FILES_NAME));
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
        throw err;
    }
}

/**
 * Parses declaration text as governing `root` and returns the matcher shape the rest of this module
 * uses. Exported for callers that hold the text already — tests, and a migration that wants to
 * report what is protected before it starts writing.
 */
function parseIgnore(text, root, sourceFile = null, concern = CONCERN_MIGRATION) {
    const decl = parseDeclaration(text, root, sourceFile);
    return {
        patterns: decl.patterns,
        sourceFile,
        /** True when `target` — absolute, or relative to the data root — is protected. */
        ignores(target) {
            return declExcludes(decl, path.resolve(decl.dir, target), concern);
        },
    };
}

/**
 * Builds the matcher a walk consults, for one concern (migrations, unless asked otherwise).
 *
 * A declaration can sit in any folder and covers that folder and everything below it, so a path is
 * tested against every declaration governing one of its ancestors — the root's included. A nested
 * one only ever adds: there is no negation, so composition is "excluded by any of them" and needs
 * no ordering. Declarations are read once each and cached, which is what keeps this affordable when
 * a walk asks about every file in the store.
 *
 * The root falls back, in order, to a legacy `<state>/migration-ignore` (a store worker has
 * not converted yet) and then to the built-in defaults — never to "nothing is protected", which a
 * store says by writing an empty file.
 */
function loadIgnore(root = dataRoot(), concern = CONCERN_MIGRATION) {
    const base = path.resolve(root);
    const cache = new Map();
    const declFor = (dir) => {
        if (!cache.has(dir)) cache.set(dir, dir === base ? rootDeclaration(base) : readDeclaration(dir));
        return cache.get(dir);
    };
    return {
        /** The root declaration's patterns that bound THIS concern, verbatim. */
        get patterns() {
            const decl = declFor(base);
            return [...(decl ? declRules(decl, concern) : [])];
        },
        get sourceFile() {
            const decl = declFor(base);
            return decl ? decl.sourceFile : null;
        },
        /** True when `target` — absolute, or relative to the data root — is protected. */
        ignores(target) {
            const abs = path.resolve(base, target);
            const rel = path.relative(base, abs);
            if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep)) return false;
            // Excluded whatever any declaration says: in production the data root IS the git work
            // tree, and the state directory holds the service's own registries and transcripts.
            if (rel.split(path.sep).some((seg) => seg === '.git' || seg === STATE_DIR_NAME)) return true;
            for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) {
                const decl = declFor(dir);
                if (decl && declExcludes(decl, abs, concern)) return true;
                if (dir === base || path.dirname(dir) === dir) return false;
            }
        },
    };
}

/** The declaration governing the data root: its own, a legacy one, or the built-in defaults. */
function rootDeclaration(base) {
    const own = readDeclaration(base);
    if (own) return own;
    const legacy = path.join(base, STATE_DIR_NAME, LEGACY_IGNORE_FILE);
    try {
        return parseDeclaration(fs.readFileSync(legacy, 'utf8'), base, legacy);
    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
    return parseDeclaration(DEFAULT_EXCLUSIONS.join('\n'), base, null);
}

/**
 * Recursively lists files under `dir` whose name ends with one of `extensions`, skipping everything
 * the store declares is not content.
 *
 * Walks the tree manually rather than using `readdirSync(..., { recursive: true })` so the
 * script works on the older Node shipped by the distro package manager (recursive readdir
 * needs Node 20+); the migration runner relies on a plain `apt install nodejs`.
 */
function scan(dir, extensions = DOCUMENT_EXTENSIONS, ignore = loadIgnore()) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (ignore.ignores(full)) continue;
        if (entry.isDirectory()) {
            out.push(...scan(full, extensions, ignore));
        } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

function loadJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Writes `obj` back as pretty-printed JSON (2-space indent), matching the store's format. */
function saveJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

/** File modification time as an ISO-8601 string — a sensible default for backfilled timestamps. */
function modifiedAtIso(file) {
    return fs.statSync(file).mtime.toISOString();
}

module.exports = {
    DOCUMENT_EXTENSIONS,
    KIAO_FILES_NAME,
    LEGACY_IGNORE_FILE,
    STATE_DIR_NAME,
    CONCERN_MIGRATION,
    CONCERN_REFACTOR,
    DEFAULT_EXCLUSIONS,
    dataRoot,
    loadIgnore,
    parseIgnore,
    parseDeclaration,
    scan,
    loadJson,
    saveJson,
    modifiedAtIso,
};
