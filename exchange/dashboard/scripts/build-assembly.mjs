// ── The assembly build ────────────────────────────────────────────────────────
//
// `npm run build` produces one directory, and every runtime that serves Dashboard — nginx in
// the kiao image, `bin/kiao-launcher/web.go`, a production server — serves it exactly as
// they always have. What changed is what is inside it:
//
//   build/
//     index.html              the shell, with the import map naming the runtime modules
//     assets/…                the shell's own chunks
//     runtime/react.js …      the shared surface, at fixed names the import map points to
//     plugins/<id>/           one directory per plugin: index.js, and style.css if it has one
//     plugins/catalogue.json  what this assembly holds, for the Configuration panel
//
// Which plugins are built is `VITE_PLUGINS` (a comma-separated list of ids, all of them when
// unset). Which of *those* a store loads is that store's own `.kiao-config/dashboard.json`.
//
// **The plugins are built first.** They write inside the shell's output directory, so the order is
// forced one way or the other; this way round is the one that gets the service worker right. The
// worker's precache is generated at the end of the shell build by globbing what is in `build/` at
// that moment — plugins built afterwards would simply not be in it, and an offline reload would
// come up with a shell that then loads no plugin at all. The plugin builds are independent of each
// other and run a few at a time.

import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { init as lexerReady, parse as parseModule } from 'es-module-lexer';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogue, assembledPlugins, publishedEntry, SHARED_MODULES } from '../vite-plugins/assembly-shared.mjs';
import { pluginBuildConfig } from '../vite-plugins/pluginBuild.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(root, 'build');
const base = process.env.VITE_BASE_PATH || '/dashboard/';
// One timestamp for the whole assembly: the shell and its plugins were built together and should
// say so.
const buildDateTime = new Date().toISOString();

/** How many plugin builds run at once. Each is already a parallel Rollup pass. */
const CONCURRENCY = 4;

const typecheck = project => execFileSync(
    resolve(root, 'node_modules/.bin/tsc'), ['--noEmit', '-p', project], { stdio: 'inherit' });

/** Runs `tasks` with at most `limit` in flight, keeping the results in order. */
const pool = async (items, limit, run) => {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await run(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

const plugins = assembledPlugins(readCatalogue());
console.log(`[assembly] shell + ${plugins.length} plugins: ${plugins.map(p => p.id).join(', ')}`);

// The shell first, then each dropped plugin against its own tsconfig — the assembly is the one
// place both halves of the contract exist at once, so it is where the types are checked. Neither
// Vite nor esbuild would: they strip the types without reading them.
typecheck(root);
for (const entry of plugins.filter(entry => !entry.dir.startsWith(resolve(root, 'src/plugins')))) {
    console.log(`[assembly] typechecking ${entry.id}…`);
    typecheck(entry.dir);
}

// Emptied here rather than by either build: the shell's would take the plugins with it.
await rm(outDir, { recursive: true, force: true });

const failed = [];
await pool(plugins, CONCURRENCY, async entry => {
    const started = Date.now();
    try {
        await build(pluginBuildConfig(entry, { base, root, buildDateTime }));
        console.log(`[assembly]   ${entry.id} (${Date.now() - started} ms)`);
    } catch (error) {
        failed.push(entry.id);
        console.error(`[assembly]   ${entry.id} FAILED\n`, error);
    }
});
if (failed.length) {
    console.error(`[assembly] plugins failed to build: ${failed.join(', ')}`);
    process.exit(1);
}

console.log('[assembly] building the shell…');
await build({ configFile: resolve(root, 'vite.config.ts') });

await checkImports(plugins);

/** The names a bundle's import statement asks its module for. `*` is a namespace import. */
function importedNames(statement) {
    const clause = statement.replace(/^import\s*/, '').replace(/\s*from\s*(['"])[\s\S]*$/, '');
    if (!clause || /^['"]/.test(clause)) return [];              // import "x" — side effect only
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
        for (const part of braced[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].trim().replace(/^['"]|['"]$/g, '');
            if (name) names.push(name);
        }
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (head.startsWith('*')) return ['*'];
    if (head) names.push('default');
    return names;
}

/** What each published shim actually exports, read back from the shell's own output. */
async function publishedExports() {
    const bySpecifier = new Map();
    for (const [specifier, name] of Object.entries(SHARED_MODULES)) {
        const [, exports] = parseModule(await readFile(resolve(outDir, 'runtime', `${name}.js`), 'utf-8'));
        bySpecifier.set(specifier, new Set(exports.map(({ n }) => n)));
    }
    return bySpecifier;
}

/**
 * What a plugin bundle is still asking the world for, and whether the import map can answer it.
 *
 * A bare import that survives into a plugin's output is one the import map has to answer, and the
 * map answers exactly the shared surface. Anything else is a name nothing resolves in the browser —
 * or, worse, a second copy of something that was meant to be shared and was left off the list, which
 * is how one gets two Reacts and a page of broken hooks.
 *
 * The specifier resolving is only half of it: the browser also refuses a module that does not export
 * the *name* asked of it, and a shim can publish a module while publishing none of its names —
 * `export * from` a CommonJS package re-exports nothing at all, which is how every plugin in a
 * production assembly once failed on `react` while the dev server, which has no import map, was
 * perfectly happy. So each imported name is checked against the shim that has to answer it. Nothing
 * here shows up until a plugin is opened in a *built* assembly, and all of it is plainly visible at
 * the end of the build, so the build is where it is caught.
 */
async function checkImports(entries) {
    await lexerReady;
    const shared = new Set(Object.keys(SHARED_MODULES));
    const published = await publishedExports();
    const problems = [];
    for (const entry of entries) {
        const dir = resolve(outDir, 'plugins', entry.id);
        for (const file of (await readdir(dir)).filter(name => name.endsWith('.js'))) {
            const code = await readFile(resolve(dir, file), 'utf-8');
            const [imports] = parseModule(code);
            for (const { n: specifier, ss, se } of imports) {
                if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) continue;
                if (!shared.has(specifier)) {
                    problems.push(`${entry.id}/${file} imports '${specifier}'`);
                    continue;
                }
                for (const name of importedNames(code.slice(ss, se))) {
                    if (name === '*' || published.get(specifier).has(name)) continue;
                    problems.push(`${entry.id}/${file} imports '${name}' from '${specifier}', `
                        + `which runtime/${SHARED_MODULES[specifier]}.js does not export`);
                }
            }
        }
    }
    if (problems.length) {
        console.error('[assembly] these imports are on no import map:\n  ' + problems.join('\n  '));
        console.error('[assembly] add them to SHARED_MODULES, or stop importing them from a plugin.');
        process.exit(1);
    }
}

await checkStylesheets(plugins);

/**
 * One stylesheet per plugin, and it is named `style.css`.
 *
 * The loader links `<id>/style.css` and nothing else, so a second CSS file beside it is CSS that
 * ships and is never loaded — which is what a name collision looks like from the outside, and how
 * every plugin's styling once went missing while the build said nothing. Any `.css` that is not
 * `style.css` is that, so it fails the build.
 */
async function checkStylesheets(entries) {
    const strays = [];
    for (const entry of entries) {
        const dir = resolve(outDir, 'plugins', entry.id);
        for (const file of (await readdir(dir)).filter(name => name.endsWith('.css') && name !== 'style.css')) {
            strays.push(`${entry.id}/${file}`);
        }
    }
    if (strays.length) {
        console.error('[assembly] stylesheets nothing will ever load:\n  ' + strays.join('\n  '));
        console.error('[assembly] a plugin has one stylesheet and it is style.css.');
        process.exit(1);
    }
}

await checkAssetUrls(plugins);

/**
 * Every asset a plugin ships is asked for where it was put.
 *
 * A plugin's files land in `build/plugins/<id>/`, one level below the shell's, and the URL Vite
 * writes for each of them is whatever its `base` says — so a plugin built with the app's base
 * alone asks for `<base><file>`, a level too high. Nothing 404s there: that path is under the SPA,
 * the router answers every unclaimed one with index.html, and the asset comes back as a page of
 * HTML with a 200 on it. An image so served renders as its alt text and a worker fails to parse,
 * both silently and only in a built assembly — which is how the CV's photo went missing while the
 * build, the tests and the dev server all said nothing.
 *
 * So each emitted asset — anything that is not the entry, a chunk or the stylesheet, all three of
 * which are reached by other means — has to appear somewhere in the plugin's own output at its
 * real URL. If it does not, some other URL is being asked for instead, and the build says so.
 */
async function checkAssetUrls(entries) {
    const unreachable = [];
    for (const entry of entries) {
        const dir = resolve(outDir, 'plugins', entry.id);
        const files = await readdir(dir);
        const code = (await Promise.all(files
            .filter(name => name.endsWith('.js') || name.endsWith('.css'))
            .map(name => readFile(resolve(dir, name), 'utf-8')))).join('\n');
        for (const file of files.filter(name => !/\.(js|css)$/.test(name))) {
            const url = `${base.replace(/\/*$/, '/')}plugins/${entry.id}/${file}`;
            if (!code.includes(url)) unreachable.push(`${entry.id}/${file} — nothing asks for ${url}`);
        }
    }
    if (unreachable.length) {
        console.error('[assembly] assets asked for at the wrong URL:\n  ' + unreachable.join('\n  '));
        console.error("[assembly] a plugin's base is <base>plugins/<id>/ — see vite-plugins/pluginBuild.mjs.");
        process.exit(1);
    }
}

await checkInstallable();

/**
 * The built page offers to install, on every platform.
 *
 * A browser will only offer it when the page names a manifest that meets its criteria, and every
 * way of getting that wrong is invisible until someone looks for an install button and finds none —
 * on one platform, months later. Which is how it went: the page carried *two* `<link rel="manifest">`,
 * one hand-written and one generated, and a browser reads the first and ignores the rest. The first
 * declared a single 64x64 icon, under the 192px Chromium wants, so no desktop ever offered to
 * install. Android and iOS said nothing because a home-screen shortcut needs no manifest at all.
 *
 * So the three things a build can get wrong are checked here, against what was actually emitted:
 * that exactly one manifest is named, that it holds what makes an app installable, and that every
 * file it points at is really in `build/` at that URL. Nothing else in the build would notice —
 * the manifest is a static file nothing imports, and every icon it names is one nothing links.
 */
async function checkInstallable() {
    // Comments out first: they are not markup, and the one above this link in index.html talks
    // about link tags. Counting those would fail the build over its own explanation.
    const html = (await readFile(resolve(outDir, 'index.html'), 'utf-8')).replace(/<!--[\s\S]*?-->/g, '');
    const links = [...html.matchAll(/<link\b[^>]*\brel=["']?manifest["']?[^>]*>/gi)]
        .map(([tag]) => tag.match(/\bhref=["']([^"']+)["']/)?.[1])
        .filter(Boolean);
    const problems = [];

    if (links.length !== 1) {
        problems.push(links.length === 0
            ? 'index.html names no manifest — nothing will offer to install it'
            : `index.html names ${links.length} manifests (${links.join(', ')}) — a browser reads `
              + 'only the first, so the others are not a fallback but a way to lose it');
    }

    // Relative to build/, which is what a URL under `base` is once served.
    const served = url => resolve(outDir, url.replace(base, '').replace(/^\//, ''));
    const read = async url => {
        try { return JSON.parse(await readFile(served(url), 'utf-8')); } catch { return null; }
    };
    // The first link even when there are several — it is the one the browser will read, so its
    // contents are worth reporting on in the same breath as the count.
    const manifest = links.length ? await read(links[0]) : null;

    if (links.length && !manifest) {
        problems.push(`${links[0]} is named by index.html and is not in build/, or is not JSON`);
    } else if (manifest) {
        // The criteria Chromium applies before it offers to install. Safari and Firefox ask for
        // less; anything that satisfies this satisfies them.
        if (!manifest.name && !manifest.short_name) problems.push('the manifest has no name');
        if (!manifest.start_url) problems.push('the manifest has no start_url');
        if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
            problems.push(`display is '${manifest.display}' — an installed app wants standalone, `
                + 'fullscreen or minimal-ui');
        }

        // Every icon has to be where it says, or the install prompt appears with nothing in it.
        // Only the ones that are really there count towards the size below: an icon the manifest
        // declares and the build does not hold is not an icon a browser can use.
        const manifestDir = links[0].replace(/[^/]*$/, '');
        const present = [];
        for (const icon of manifest.icons ?? []) {
            const url = new URL(icon.src, `https://x${manifestDir}`).pathname;
            try { await readFile(served(url)); present.push(icon); }
            catch { problems.push(`the manifest names ${icon.src}, which is not in build/`); }
        }
        // A launcher crops a maskable icon to a shape of its own, so one declared `any` — which is
        // also what an omitted purpose means — is what a desktop needs to see.
        const square = ({ sizes }) => Math.max(0, ...String(sizes ?? '')
            .split(/\s+/).map(size => Number(size.split('x')[0]) || 0));
        if (!present.some(icon => (icon.purpose ?? 'any').split(/\s+/).includes('any') && square(icon) >= 192)) {
            problems.push('no icon of at least 192x192 with purpose "any" — Chromium will not '
                + 'offer to install without one, which is what leaves Windows and Linux with no button');
        }
    }

    if (problems.length) {
        console.error('[assembly] the built app cannot be installed:\n  ' + problems.join('\n  '));
        console.error('[assembly] the manifest is public/manifest.json and index.html links it — '
            + 'see `manifest: false` in vite.config.ts.');
        process.exit(1);
    }
}

const catalogue = plugins.map(publishedEntry);
await mkdir(resolve(outDir, 'plugins'), { recursive: true });
await writeFile(
    resolve(outDir, 'plugins', 'catalogue.json'),
    JSON.stringify(catalogue, null, 2) + '\n',
);
console.log(`[assembly] done — ${catalogue.length} plugins in build/plugins/`);
