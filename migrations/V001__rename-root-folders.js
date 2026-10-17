/**
 * V001 — renames two folders at the store root and repairs the links into them.
 *
 *     qd-notes  ->  docs
 *     config    ->  kiao-user-config
 *
 * `config` is renamed because it is the one store folder whose name a store does not own: any
 * source repository dropped into a store has one, and DCMS serves any folder — kiao-pub itself is
 * a store root, and its `config/` holds the deployment environments. `kiao-user-config` is a name
 * nothing else claims. The code that reads the folder moved with it (QuickCMS's value providers,
 * file templates, CV and cursus pools; kiao-mcp's `CV_DATA_PATH`), so a store that is not migrated
 * loses sight of those documents until it is.
 *
 * ## What it will and will not touch
 *
 * Both the rename and the link pass are bounded by the store's `.kiao-files`, for the `[migration]`
 * concern — a migration is a migration whatever it does, and a store that says nothing here is
 * migrated means it. That is what keeps this script off kiao-pub's own `config/`.
 *
 * A pair whose target already exists is **skipped with a warning**, never merged: `docs/` is an
 * ordinary folder name and a store may well have both. Refusing to start over it would be worse
 * than leaving it alone, so the script exits 0 and says what it left.
 *
 * Links are rewritten exactly as files-service rewrites them after a rename (see lib/link-fix.js),
 * with one narrowing: `config` is only matched with a leading slash — the form QuickCMS stores an
 * internal link in — because a bare `config/…` is a shell snippet as often as it is a link.
 * `qd-notes` is matched either way; nothing else is called that.
 *
 * The view state in `.kiao-config/quickcms-view-state.json` is deliberately not touched: the state
 * directory is out of bounds for every pass, and a remembered path that no longer resolves is
 * dropped by QuickCMS on the next load.
 */

const fs = require('fs');
const path = require('path');
const { dataRoot, loadIgnore } = require('./lib/kiao-fs');
const { renameOp, fixLinks } = require('./lib/link-fix');

/**
 * `absoluteOnly` marks a name too common to be recognised as a link without its leading slash.
 */
const RENAMES = [
    { from: 'qd-notes', to: 'docs', absoluteOnly: false },
    { from: 'config', to: 'kiao-user-config', absoluteOnly: true },
];

const isDirectory = (p) => {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
};

const exists = (p) => fs.existsSync(p);

/**
 * Performs one rename, and answers whether the links for that pair have to be looked at.
 *
 * They do for a pair this run renamed, and also for one whose target is present without its
 * source — the half-applied state a run that renamed the folder and then died leaves behind, and
 * the one the ledger cannot distinguish from "never ran". Re-running is a no-op either way: there
 * is nothing left for the pattern to match, so every file is left byte-identical.
 */
function applyRename(root, rename, ignore) {
    const from = path.join(root, rename.from);
    const to = path.join(root, rename.to);

    if (ignore.ignores(from) || ignore.ignores(to)) {
        console.log(`  ${rename.from}: declared not content by .kiao-files — left alone`);
        return false;
    }
    if (isDirectory(from) && exists(to)) {
        console.warn(`  ${rename.from}: NOT renamed — ${rename.to} already exists. ` +
            'Merging the two is not this script\'s call; move them together by hand, ' +
            'then rename the links with QuickCMS so they are fixed for you.');
        return false;
    }
    if (isDirectory(from)) {
        fs.renameSync(from, to);
        console.log(`  ${rename.from} -> ${rename.to}`);
        return true;
    }
    if (isDirectory(to)) {
        console.log(`  ${rename.from}: no such folder, ${rename.to} is there — checking the links into it`);
        return true;
    }
    console.log(`  ${rename.from}: not in this store`);
    return false;
}

/**
 * A `.kiao-files` pattern naming a folder this migration moves stops protecting it, and no script
 * should edit an operator's declaration. Saying so is the most that can be done from here.
 */
function warnOnStaleDeclaration(ignore) {
    for (const pattern of ignore.patterns) {
        const head = pattern.replace(/^\/+/, '').split('/')[0];
        const stale = RENAMES.find((r) => head === r.from);
        if (stale) {
            console.warn(`  note: .kiao-files still says "${pattern}" — that folder is now ` +
                `"${stale.to}", so the rule no longer covers it. Update it by hand.`);
        }
    }
}

function main() {
    const root = dataRoot();
    const ignore = loadIgnore(root);
    console.log(`V001: renaming root folders in ${root}`);
    if (ignore.patterns.length > 0) {
        console.log(`V001: honouring ${ignore.patterns.length} .kiao-files rule(s): ${ignore.patterns.join(' ')}`);
    }

    const ops = [];
    for (const rename of RENAMES) {
        if (applyRename(root, rename, ignore)) {
            ops.push(renameOp('/' + rename.from, '/' + rename.to, { absoluteOnly: rename.absoluteOnly }));
        }
    }
    warnOnStaleDeclaration(ignore);

    if (ops.length === 0) {
        console.log('V001: done — nothing to rename.');
        return;
    }

    const changed = fixLinks(root, ops, ignore);
    for (const { file, substitutions } of changed) {
        console.log(`  ${path.relative(root, file)} (${substitutions} link${substitutions === 1 ? '' : 's'})`);
    }
    const total = changed.reduce((sum, c) => sum + c.substitutions, 0);
    console.log(`V001: done — ${ops.length} folder(s) renamed, ${total} link(s) in ${changed.length} file(s).`);
}

main();
