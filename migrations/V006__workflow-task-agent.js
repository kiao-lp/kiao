/**
 * V006 — a task board says which agent plays each of its cards.
 *
 *     "settings": { "model": "opus", … }   ->   "settings": { "agent": "claude", "model": "opus", … }
 *
 * A task's settings gained a fifth field, `agent`, and it is part of what makes a card playable at
 * all: the other four are written in *that agent's* vocabulary and no one else's. `opus` is a model
 * on Claude and no model at all on Codex; the three permission modes a Claude turn offers are one on
 * a Codex turn. So a card naming a model without naming the engine that model belongs to is not a
 * card with a sensible default — it is a card whose settings cannot be read, and reading them
 * against whichever agent the deployment happens to offer first is exactly how a board written for
 * one would silently play on another.
 *
 * Every board written before this build meant Claude, because Claude was the only agent there was.
 * This says so out loud, once, so that a board keeps its Play buttons instead of losing them to a
 * field nobody could have written.
 *
 * ## What it will and will not touch
 *
 * The scan is bounded by the store's `.kiao-files` for the `[migration]` concern, like every
 * migration. Within that, a file is a board because it is a `.workflow.json` that parses as JSON
 * carrying a `content.columns` array and, when it declares a `docType` at all, because that is
 * `KiaoWorkflow`. A `.workflow.json` that is a fixture or an export of something else parses to
 * another shape and is left alone.
 *
 * Within a board, only **an AI card that names a model and no agent** is written. That is how an AI
 * card is recognised on a board written before the `type` field existed, and it is the same reading
 * the two services perform: a named model is AI, and nothing at all is Human. A card that already
 * names an agent is left exactly as it is — including one naming an agent this host does not have,
 * which is a board that has travelled and not a board to correct. A Human, Shutdown or Scheduler
 * card names no model and is not touched: none of them is played by an agent.
 *
 * The key is written **first** in the settings object, which is where the editor writes it and where
 * it reads best — the four fields after it are its vocabulary.
 *
 * Re-running is a no-op: the second pass finds every AI card already naming an agent.
 */

const path = require('path');
const { dataRoot, loadIgnore, scan, loadJson, saveJson } = require('./lib/kiao-fs');

const WORKFLOW_EXTENSION = '.workflow.json';
const WORKFLOW_DOC_TYPE = 'KiaoWorkflow';

/**
 * The agent every board written before this field meant. It is not read from a deployment: what is
 * being recorded is what these cards have always been played on, not what this host offers today.
 */
const CLAUDE = 'claude';

/**
 * The columns held by a parsed document, or null when the file is not a board: the wrapped
 * `content.columns` of a saved document, or the bare `columns` of one written before the envelope
 * existed.
 */
function columnsOf(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.docType !== undefined && json.docType !== WORKFLOW_DOC_TYPE) return null;

    const columns = json.content?.columns ?? json.columns;
    return Array.isArray(columns) ? columns : null;
}

/**
 * Whether this card is one an agent plays. The type where the document says one, and otherwise the
 * reading every board written before that field gets: a named model is AI, and nothing is Human.
 */
function isAiTask(task) {
    const said = typeof task?.type === 'string' ? task.type.trim().toLowerCase() : '';
    if (said) return said === 'ai';
    return typeof task?.settings?.model === 'string' && task.settings.model.trim() !== '';
}

/** The settings with the agent named first, the rest kept in the order they were written in. */
function withAgent(settings) {
    return { agent: CLAUDE, ...settings };
}

/**
 * The board's cards with an agent named on every AI one that had none. Returns how many were
 * written, or 0 when there was nothing to do — the document is then not touched at all.
 */
function nameTheAgent(columns) {
    let named = 0;
    for (const column of columns) {
        if (!Array.isArray(column?.tasks)) continue;
        column.tasks = column.tasks.map(task => {
            if (!isAiTask(task)) return task;
            const settings = task.settings;
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return task;
            if (typeof settings.agent === 'string' && settings.agent.trim() !== '') return task;
            named++;
            return { ...task, settings: withAgent(settings) };
        });
    }
    return named;
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V006: naming the agent on task boards in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V006: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const files = scan(root, [WORKFLOW_EXTENSION], ignore);
    let written = 0;
    let cards = 0;

    for (const file of files) {
        let json;
        try {
            json = loadJson(file);
        } catch {
            continue;                        // not JSON, so not a board
        }

        const columns = columnsOf(json);
        if (!columns) continue;

        const named = nameTheAgent(columns);
        if (named === 0) continue;

        saveJson(file, json);
        written++;
        cards += named;
        console.log(`  ${path.relative(root, file)}: ${named} card(s) now say they are played by ${CLAUDE}`);
    }

    console.log(`V006: done — ${written} board(s) of ${files.length} rewritten: ${cards} AI card(s) `
        + `given the agent they have always been played on.`);
}

main();
