/**
 * V011 — a task board's cards leave their `.workflow.json` file for one SQL script at the store root.
 *
 *     backlog/Major.workflow.json  \
 *     backlog/Minor.workflow.json   >  boards-seed.sql — run by hand, once, against PostgreSQL
 *     ...                           /
 *
 * The boards live in PostgreSQL now, kept by workflows-service
 * (`operation/workflows-service`, `docs/architecture/workflows-service.md`). This is the move's last
 * step on the file side: every board the store holds is exported to the same script
 * `tools/seedgen` writes — one transaction, the same deterministic ids — and the files it came from
 * are deleted. Nothing reads them any more: with a workflows-service configured files-service plays
 * from the database, and QuickCMS's board plugin claims no file type, so a leftover file opens as
 * the JSON it is.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a file is a board by the same shape V010 asked for: a `.workflow.json`
 * that parses as JSON carrying a `content.columns` array — or a bare `columns` array — and, when it
 * declares a `docType` at all, `KiaoWorkflow`. Both card shapes are read, so a board V010 skipped is
 * still exported whole. What is not a board is left alone and named.
 *
 * A board is exported whole or left whole: one whose cards cannot be carried — a card without a
 * usable id, a column without an id, a list of cards that is not a list — stays as a file and is
 * reported, and so does one whose name a board already exported answers to, the name being unique in
 * the database. Only the files that went into the script are deleted, and only after it is written.
 * The script keeps every card id, re-mints the board and column ids from the store path (every board
 * carries the file template's own), and ranks the columns and cards in the order the documents had
 * them — byte for byte what seedgen would have written from `BEGIN;` on.
 *
 * Two things are deliberately not done. The board template in `kiao-user-config/file-templates/` is
 * skipped: it is board-shaped and it is not a board. And no link is rewritten for the deleted files:
 * nothing a store holds names a board by its path — a chain names a card by its id, inside the board
 * itself — so there is nothing to follow.
 *
 * After this, an instance whose files-service names no workflows-service has no boards until the
 * script is imported somewhere and the instance pointed at it: the document fallback it used to read
 * has nothing left to read. That is the transition ending, and the script at the root is what ends
 * it deliberately rather than by accident.
 *
 * Re-running is a no-op: with the boards gone there is nothing to export and nothing is written.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson } = require('./lib/kiao-fs');

const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';

/** The script, at the store root — the name seedgen writes and the runbooks quote. */
const SEED_FILE = 'boards-seed.sql';

/** What a new board is instantiated from: board-shaped, and not a board. seedgen skips it too. */
const TEMPLATES_PREFIX = 'kiao-user-config/file-templates/';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A scalar read as text. Numbers and booleans are what a hand-written board says plainly; objects
 * and arrays are not text at all, and come back undefined so the caller can refuse the board.
 */
function asText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

/** Thrown with the reason a board stays a file: reported, never written halfway. */
class SkipBoard extends Error {}

/** The identity the store keeps, as `entities.ValidID` checks it. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const looksLikeUUID = (value) => UUID_RE.test(String(value ?? '').trim());

/**
 * A uuid derived from a name: SHA-256 of it, cut to sixteen bytes, with the version and variant
 * bits of a v4. What seedgen mints, so the script is reproducible and a board imported twice fails
 * on its primary key instead of arriving as a second copy.
 */
function mint(name) {
    const sum = crypto.createHash('sha256').update('kiao-workflows-seed:' + name).digest();
    const buf = Buffer.from(sum.subarray(0, 16));
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = buf.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── fractional ranks, as core/entities/rank.go mints them ────────────────────────────

const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const RANK_BASE = RANK_DIGITS.length;
const MAX_RANK_LEN = 512;

function digitAt(key, i) {
    if (i >= key.length) return 0;
    return RANK_DIGITS.indexOf(key[i]);
}

function aboveRank(prev, out, i) {
    for (;; i++) {
        if (out.length >= MAX_RANK_LEN) throw new Error('rank too long');
        const d = digitAt(prev, i);
        if (d === RANK_BASE - 1) {
            out.push(RANK_DIGITS[d]);
            continue;
        }
        return out.join('') + RANK_DIGITS[Math.floor((d + RANK_BASE) / 2)];
    }
}

function betweenRank(prev, next) {
    if (prev !== '' && next !== '' && prev >= next) {
        throw new Error(`ranks out of order: ${prev} is not below ${next}`);
    }
    const out = [];
    for (let i = 0; ; i++) {
        if (out.length >= MAX_RANK_LEN) throw new Error('rank too long');
        const lo = digitAt(prev, i);
        let hi = RANK_BASE;
        if (next !== '') {
            if (i >= next.length) {
                throw new Error(`ranks out of order: nothing fits between ${prev} and ${next}`);
            }
            hi = digitAt(next, i);
        }
        if (lo === hi) {
            out.push(RANK_DIGITS[lo]);
        } else if (hi - lo > 1) {
            return out.join('') + RANK_DIGITS[Math.floor((lo + hi) / 2)];
        } else {
            out.push(RANK_DIGITS[lo]);
            return aboveRank(prev, out, i + 1);
        }
    }
}

function ranksBetween(prev, next, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const rank = betweenRank(prev, next);
        out.push(rank);
        prev = rank;
    }
    return out;
}

// ── the forgiving readers, as core/entities reads them ──────────────────────────────

const TASK_TYPES = new Set(['ai', 'human', 'shutdown', 'scheduler']);
const TASK_STATUSES = new Set(['draft', 'ready', 'running', 'waiting-refresh', 'interrupted', 'done', 'error']);
const TRANSITION_MODES = new Set(['continue', 'compact', 'end']);

/** The handle a name is reached by — `services.Slugify`, lossy on purpose. */
function slugify(name) {
    let slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug === '') return 'board';
    if (slug.length > 60) slug = slug.slice(0, 60).replace(/^-+|-+$/g, '');
    return slug;
}

function readTaskType(said, settings) {
    const t = said.trim().toLowerCase();
    if (TASK_TYPES.has(t)) return t;
    return settings.model ? 'ai' : 'human';
}

function readTaskStatus(said) {
    const s = said.trim();
    return TASK_STATUSES.has(s) ? s : 'ready';
}

function readTransitionMode(said) {
    const m = said.trim();
    return TRANSITION_MODES.has(m) ? m : 'end';
}

/** The words a card is filed under: trimmed, inner whitespace collapsed, each kept once. */
function readTags(said) {
    const out = [];
    const seen = new Set();
    for (const entry of said) {
        const label = entry.trim().split(/\s+/).join(' ');
        if (label === '' || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        out.push(label);
    }
    return out;
}

const SCHEDULE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** A Scheduler's datetime, or nothing — which leaves the card unplayable, as it should be. */
function readSchedule(said) {
    const at = said.trim();
    return SCHEDULE_RE.test(at) ? at.slice(0, 16) : '';
}

/**
 * The chain in both shapes the format has had: an object, and the bare task id a board written
 * before the transition mode carried. Anything else says nothing, which says `end`.
 */
function readSuccess(raw) {
    if (raw === null || raw === undefined) return { task: '', mode: 'end' };
    if (typeof raw === 'string') {
        const id = raw.trim();
        return id === '' ? { task: '', mode: 'end' } : { task: id, mode: 'continue' };
    }
    if (isObject(raw)) {
        const task = raw.task === null || raw.task === undefined ? '' : raw.task;
        const mode = raw.mode === null || raw.mode === undefined ? '' : raw.mode;
        if (typeof task !== 'string' || typeof mode !== 'string') return { task: '', mode: 'end' };
        return { task: task.trim(), mode: readTransitionMode(mode) };
    }
    return { task: '', mode: 'end' };
}

/** A chain read against the card's type: only an AI card hands a chat on, and a Shutdown ends the
 * board, so a chain on one is dropped rather than carried. */
function successFor(success, type) {
    const out = { ...success };
    if (!TRANSITION_MODES.has(out.mode)) out.mode = 'end';
    if (type !== 'ai') out.mode = 'end';
    if (type === 'shutdown') out.task = '';
    return out;
}

// ── the document, read the way seedgen reads it ──────────────────────────────────────

/** The five settings this build knows; anything else a card carries goes to `settings_extra`. */
const KNOWN_SETTINGS = new Set(['agent', 'model', 'effort', 'permission', 'folder']);

/**
 * One card as the script will write it. A field that is not text where text belongs refuses the
 * whole board — except the spot, which is where the card sits on the workflow canvas and nothing
 * else: a malformed one is dropped and named, rather than costing the board.
 */
function convert(raw, rank, dropped) {
    const id = asText(raw.id) ?? '';
    if (!looksLikeUUID(id.trim())) {
        throw new SkipBoard(`card ${JSON.stringify(asText(raw.title) ?? '')} has no usable id`);
    }
    const settings = { agent: '', model: '', effort: '', permission: '', folder: '', extra: {} };
    if (raw.settings !== null && raw.settings !== undefined) {
        if (!isObject(raw.settings)) throw new SkipBoard(`card ${JSON.stringify(id)}: its settings are not an object`);
        for (const key of Object.keys(raw.settings)) {
            const value = asText(raw.settings[key]);
            if (value === undefined) throw new SkipBoard(`card ${JSON.stringify(id)}: setting ${JSON.stringify(key)} is not text`);
            const trimmed = value.trim();
            if (trimmed === '') continue;
            if (KNOWN_SETTINGS.has(key)) settings[key] = trimmed;
            else settings.extra[key] = trimmed;
        }
    }
    const field = (name) => {
        const value = asText(raw[name]);
        if (value === undefined) throw new SkipBoard(`card ${JSON.stringify(id)}: ${name} is not text`);
        return value;
    };
    const type = readTaskType(field('type'), settings);
    let tags = [];
    if (raw.tags !== null && raw.tags !== undefined) {
        if (!Array.isArray(raw.tags)) throw new SkipBoard(`card ${JSON.stringify(id)}: its tags are not a list`);
        tags = readTags(raw.tags.map((entry) => {
            const value = asText(entry);
            if (value === undefined) throw new SkipBoard(`card ${JSON.stringify(id)}: a tag is not text`);
            return value;
        }));
    }
    let spot = null;
    if (raw.spot !== null && raw.spot !== undefined) {
        const placed = isObject(raw.spot) && Number.isFinite(raw.spot.x) && Number.isFinite(raw.spot.y);
        if (placed) {
            spot = { x: Math.trunc(raw.spot.x + 0.5), y: Math.trunc(raw.spot.y + 0.5) };
        } else {
            dropped.push(`card ${JSON.stringify(id)}: its spot is not a place, and was dropped`);
        }
    }
    let status = readTaskStatus(field('status'));
    // A card the run was holding when the board was last written is imported **ready**, not running:
    // nothing is playing it any more, and a card that said `running` for ever is exactly what the
    // restart sweep exists to prevent.
    if (status === 'running' || status === 'waiting-refresh') status = 'ready';
    return {
        id: id.trim(), column: field('column').trim(), title: field('title'), type, tags,
        body: field('body'), settings, at: readSchedule(field('at')), spot, status,
        chat: field('chat').trim(), onSuccess: successFor(readSuccess(raw.onSuccess), type),
        log: field('log'), rank,
    };
}

/**
 * The content of a parsed document, or null when the file is not a board: the wrapped `content` of
 * a saved document, or the document itself where it was written without the envelope.
 */
function contentOf(json) {
    if (!isObject(json)) return null;
    if (json.docType !== undefined && json.docType !== WORKFLOW_DOC_TYPE) return null;
    const content = 'content' in json ? json.content : json;
    if (!isObject(content)) return null;
    return Array.isArray(content.columns) ? content : null;
}

/** One document as the script will write it. The id is minted later, once every board has been
 * read: each carries the file template's docId, so the docId is provenance and not identity. */
function readBoard(file, json, storePath) {
    const content = contentOf(json);
    if (!content) throw new SkipBoard('not a board');
    const board = {
        file, path: storePath, name: path.basename(file, WORKFLOW_EXTENSION),
        docId: asText(json.docId) ?? '', columns: [], tasks: [], dropped: [],
    };
    let columnRanks;
    try {
        columnRanks = ranksBetween('', '', content.columns.length);
    } catch (err) {
        throw new SkipBoard(err.message);
    }
    const known = new Set();
    const nested = [];
    content.columns.forEach((entry, i) => {
        if (!isObject(entry)) throw new SkipBoard(`column ${i} is not an object`);
        const id = asText(entry.id) ?? '';
        if (id.trim() === '') throw new SkipBoard(`column ${i} (${JSON.stringify(asText(entry.title) ?? '')}) has no id`);
        const title = asText(entry.title);
        if (title === undefined) throw new SkipBoard('a column title is not text');
        const notes = asText(entry.notes);
        if (notes === undefined) throw new SkipBoard('a column note is not text');
        known.add(id.trim());
        board.columns.push({ id: id.trim(), title, notes, rank: columnRanks[i] });
        // The pre-V010 shape: each card filed in the column it was found in, after the document's
        // own list — which is where a card an older reader added to a column lands.
        if (entry.tasks !== null && entry.tasks !== undefined) {
            if (!Array.isArray(entry.tasks)) throw new SkipBoard(`column ${JSON.stringify(title)}: its tasks are not a list`);
            for (const card of entry.tasks) {
                if (!isObject(card)) throw new SkipBoard(`column ${JSON.stringify(title)}: an entry of its tasks is not a card`);
                nested.push({ ...card, column: id.trim() });
            }
        }
    });

    let listed = [];
    if (content.tasks !== null && content.tasks !== undefined) {
        if (!Array.isArray(content.tasks)) throw new SkipBoard('its "tasks" is not a list of cards');
        listed = content.tasks;
        for (const card of listed) {
            if (!isObject(card)) throw new SkipBoard('an entry of its tasks is not a card');
        }
    }
    // Ranked per column, in document order, so a board comes out looking exactly as it looked.
    const byColumn = new Map();
    for (const card of [...listed, ...nested]) {
        let place = (asText(card.column) ?? '').trim();
        // A card naming a column the board does not hold is in the backlog — which is what a card
        // in no column is, and where one whose column has gone is still on the board rather than off
        // it.
        if (place !== '' && !known.has(place)) place = '';
        if (!byColumn.has(place)) byColumn.set(place, []);
        byColumn.get(place).push({ ...card, column: place });
    }
    const compareBytes = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    for (const place of [...byColumn.keys()].sort(compareBytes)) {
        const cards = byColumn.get(place);
        let ranks;
        try {
            ranks = ranksBetween('', '', cards.length);
        } catch (err) {
            throw new SkipBoard(err.message);
        }
        cards.forEach((card, i) => board.tasks.push(convert(card, ranks[i], board.dropped)));
    }
    // A chain onto a card this board does not hold is taken off rather than carried: the column
    // constraint is the schema's, and a dangling chain would fail the script for a card somebody
    // deleted by hand months ago.
    const held = new Set(board.tasks.map((card) => card.id));
    for (const card of board.tasks) {
        if (card.onSuccess.task !== '' && !held.has(card.onSuccess.task)) card.onSuccess.task = '';
    }
    return board;
}

// ── the script ────────────────────────────────────────────────────────────────────

/**
 * Every board, column and card an id that is unique across the whole import. The columns are
 * re-minted unconditionally and the cards only when two boards genuinely name one — a case a copied
 * file produces. A re-minted card takes every reference to it with it. Notes go to the console, so
 * the script stays what seedgen would have written from `BEGIN;` on.
 */
function namespace(boards) {
    const notes = [];
    const seenTask = new Map();
    for (const board of boards) {
        board.id = mint('board:' + board.path);
        const columns = new Map();
        for (const column of board.columns) {
            const fresh = mint('column:' + board.path + ':' + column.id);
            columns.set(column.id, fresh);
            column.id = fresh;
        }
        const cards = new Map();
        for (const card of board.tasks) {
            if (seenTask.has(card.id)) {
                const fresh = mint('task:' + board.path + ':' + card.id);
                cards.set(card.id, fresh);
                notes.push(`card ${card.id} of ${board.path} has the id of a card of ` +
                    `${seenTask.get(card.id)}, and was given a fresh one`);
                card.id = fresh;
            }
            seenTask.set(card.id, board.path);
        }
        for (const card of board.tasks) {
            if (columns.has(card.column)) card.column = columns.get(card.column);
            if (cards.has(card.onSuccess.task)) card.onSuccess.task = cards.get(card.onSuccess.task);
        }
    }
    return notes;
}

/** The handle is unique in the database, so a collision is resolved here rather than by a failed
 * script: two files whose names slug the same get `-2`, as the service itself would. */
function assignSlugs(boards) {
    const taken = new Set();
    for (const board of boards) {
        const base = slugify(board.name);
        let slug = base;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        taken.add(slug);
        board.slug = slug;
    }
}

function quote(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
}

function nullable(value) {
    return String(value).trim() === '' ? 'NULL' : quote(value);
}

function nullableUUID(value) {
    const trimmed = String(value ?? '').trim();
    return looksLikeUUID(trimmed) ? quote(trimmed) + '::uuid' : 'NULL';
}

/**
 * The settings this build has no meaning for, as `jsonb`. Keys sorted and the encoding Go's own —
 * `<`, `>` and `&` do not survive `encoding/json` unescaped — so the script reads the same however
 * it was generated.
 */
function jsonbExtra(extra) {
    const keys = Object.keys(extra);
    if (keys.length === 0) return "'{}'";
    const sorted = {};
    for (const key of keys.sort()) sorted[key] = extra[key];
    const encoded = JSON.stringify(sorted)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return quote(encoded) + '::jsonb';
}

function renderTask(board, card) {
    const extra = jsonbExtra(card.settings.extra);
    const spotX = card.spot ? String(card.spot.x) : 'NULL';
    const spotY = card.spot ? String(card.spot.y) : 'NULL';
    // The chat as a lookup rather than a literal: the conversation may not have been imported, and
    // a literal would fail the whole script for a link that is a convenience.
    const chat = card.chat === '' ? 'NULL' : `(SELECT id FROM conversation WHERE id = ${quote(card.chat)})`;
    const out = `INSERT INTO task (id, board_id, column_id, title, type, body, log, status,
    agent, model, effort, permission, folder, settings_extra, scheduled_at, spot_x, spot_y,
    conversation_id, on_success_task_id, on_success_mode, rank) VALUES
  (${quote(card.id)}, ${quote(board.id)}, ${nullableUUID(card.column)}, ${quote(card.title)}, ` +
        `${quote(card.type)}, ${quote(card.body)}, ${quote(card.log)}, ${quote(card.status)},
   ${nullable(card.settings.agent)}, ${nullable(card.settings.model)}, ${nullable(card.settings.effort)}, ` +
        `${nullable(card.settings.permission)}, ${nullable(card.settings.folder)}, ${extra}, ` +
        `${nullable(card.at)}, ${spotX}, ${spotY},
   ${chat}, ${nullableUUID(card.onSuccess.task)}, ${quote(card.onSuccess.mode)}, ${quote(card.rank)});
`;
    return out + card.tags.map((tag, i) =>
        `INSERT INTO task_tag (task_id, tag, ordinal) VALUES (${quote(card.id)}, ${quote(tag)}, ${i});\n`).join('');
}

function render(boards) {
    const cards = boards.reduce((sum, board) => sum + board.tasks.length, 0);
    const date = new Date().toISOString().slice(0, 10);
    let script = `-- The store's boards, as SQL.
--
-- Generated by migrations/V011__workflow-boards-to-seed-sql.js on ${date}: ${boards.length} boards, ${cards} cards.
--
-- Run it by hand, once, against the workflows-service database **after** the service has created
-- the schema (it applies its migrations at startup):
--
--     psql "$KIAO_WORKFLOWS_SERVICE_DATABASE_URL" -v ON_ERROR_STOP=1 -f ${SEED_FILE}
--
-- It is ONE transaction: it either imports every board or leaves the database exactly as it was.
-- Running it twice fails on the primary keys and rolls back, which is the right answer — the second
-- run would otherwise be a silent half-import.
--
-- What it preserves, and what it cannot:
--
--   * Every card id is the document's own, so every chain still points where it pointed and
--     anything that wrote a card's id down still names that card. The board and column ids are
--     re-minted from the store path: every board carries the file template's own, and a primary key
--     is not a namespace.
--   * The order of the columns and of the cards is the order the documents had, as fractional ranks.
--   * A card's chat is preserved IF that conversation is already in the database. The
--     conversations live outside these files, so each link is written as a lookup that yields NULL
--     when the conversation is not there: import the conversations first if you want the links, and
--     the boards import cleanly either way.
--   * A card the runner was holding when its board was last written is imported ready. Nothing
--     is playing it any more.
--
-- The .workflow.json files this was generated from were deleted by the same migration. Each board's
-- origin_path below is the path of the file it came from.
`;
    script += `
BEGIN;

-- Every row written here is attributed to "import" in the change log (see kiao_actor in the schema).
SELECT set_config('kiao.actor', 'import', true);

-- A pasted chain names a card of its own batch, and so does an imported one: the chain's foreign
-- key is deferred to the commit, so the cards go in whatever order they come in.
SET CONSTRAINTS ALL DEFERRED;
`;
    for (const board of boards) {
        const rule = '─'.repeat(Math.max(0, 68 - Buffer.byteLength(board.name, 'utf8')));
        script += `\n-- ── ${board.name} ──${rule}\n`;
        script += `-- ${board.path} — ${board.columns.length} columns, ${board.tasks.length} cards\n`;
        script += 'INSERT INTO board (id, name, slug, origin_path, doc_id) VALUES\n' +
            `  (${quote(board.id)}, ${quote(board.name)}, ${quote(board.slug)}, ${quote(board.path)}, ` +
            `${nullableUUID(board.docId)});\n`;
        if (board.columns.length > 0) {
            script += 'INSERT INTO board_column (id, board_id, title, notes, rank) VALUES\n';
            script += board.columns.map((column) =>
                `  (${quote(column.id)}, ${quote(board.id)}, ${quote(column.title)}, ` +
                `${quote(column.notes)}, ${quote(column.rank)})`).join(',\n') + ';\n';
        }
        for (const card of board.tasks) script += renderTask(board, card);
    }
    script += `
-- What came in, to read before committing to it.
SELECT b.name, b.slug,
       (SELECT count(*) FROM board_column c WHERE c.board_id = b.id) AS columns,
       (SELECT count(*) FROM task t WHERE t.board_id = b.id) AS cards,
       (SELECT count(*) FROM task t WHERE t.board_id = b.id AND t.conversation_id IS NOT NULL) AS chats
  FROM board b ORDER BY b.name;

COMMIT;
`;
    return script;
}

// ── the migration ───────────────────────────────────────────────────────────────

/** The first free name for the script: it never writes over a file the operator put there. */
function seedTarget(root) {
    const candidate = (n) => path.join(root, n === 1 ? SEED_FILE : `boards-seed-${n}.sql`);
    for (let n = 1; ; n++) {
        if (!fs.existsSync(candidate(n))) return candidate(n);
    }
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V011: exporting task boards to ${SEED_FILE} in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V011: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const compareBytes = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    const found = [];
    let templates = 0;
    for (const file of scan(root, [WORKFLOW_EXTENSION], ignore)) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        if (rel.startsWith(TEMPLATES_PREFIX)) templates++;
        else found.push({ file, rel });
    }
    found.sort((a, b) => compareBytes(a.rel, b.rel));

    const boards = [];
    const skipped = [];
    for (const { file, rel } of found) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            skipped.push([rel, 'not JSON']);
            continue;
        }
        try {
            boards.push(readBoard(file, json, '/' + rel));
        } catch (err) {
            skipped.push([rel, err instanceof SkipBoard ? err.message : String(err && err.message || err)]);
        }
    }

    // The name is unique in the database, so a second board answering to one already exported stays
    // a file: carrying it would fail the whole script at import, after the files were gone.
    const exported = [];
    const named = new Map();
    for (const board of boards) {
        const folded = board.name.toLowerCase();
        if (named.has(folded)) {
            skipped.push([board.path.slice(1), `a board named ${JSON.stringify(named.get(folded))} was already exported`]);
        } else {
            named.set(folded, board.name);
            exported.push(board);
        }
    }

    if (exported.length === 0) {
        console.log('V011: done — no boards to export' +
            (found.length > 0 ? ` (${found.length} .workflow.json file(s) scanned, all skipped)` : '') + '.');
        for (const [rel, reason] of skipped) console.log(`  ${rel}: left alone — ${reason}`);
        if (templates > 0) console.log(`V011: ${templates} board template(s) under ${TEMPLATES_PREFIX} skipped.`);
        return;
    }

    assignSlugs(exported);
    for (const note of namespace(exported)) console.log(`V011: ${note}`);
    for (const board of exported) {
        for (const note of board.dropped) console.log(`  ${board.path.slice(1)}: ${note}`);
    }

    const target = seedTarget(root);
    const cards = exported.reduce((sum, board) => sum + board.tasks.length, 0);
    fs.writeFileSync(target, render(exported), 'utf8');

    for (const board of exported) {
        fs.unlinkSync(board.file);
        console.log(`  ${board.path.slice(1)}: ${board.columns.length} column(s), ` +
            `${board.tasks.length} card(s) exported — file deleted`);
    }
    for (const [rel, reason] of skipped) console.log(`  ${rel}: left alone — ${reason}`);
    if (templates > 0) console.log(`V011: ${templates} board template(s) under ${TEMPLATES_PREFIX} skipped.`);

    console.log(`V011: done — ${exported.length} board(s), ${cards} card(s) exported to ` +
        `${path.relative(root, target)}; ${exported.length} file(s) deleted` +
        (skipped.length > 0 ? `; ${skipped.length} file(s) left alone (listed above)` : '') + '.');
}

main();
