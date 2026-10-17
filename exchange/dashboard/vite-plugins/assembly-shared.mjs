// Plain ESM lets both Vite and the Node build script use the assembly without a TypeScript step.

import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '..');

/** Delivered plugin ids are folder names under src/plugins/, each with an index.tsx entry point. */
const lot = () => JSON.parse(readFileSync(resolve(root, 'src/plugins/catalogue.json'), 'utf-8'))
    .map(entry => ({ ...entry, dir: resolve(root, 'src/plugins', entry.id) }));

/**
 * VITE_PLUGIN_PATHS adds comma-separated project directories, each with index.tsx and a
 * package.json kiaoPlugin manifest. VITE_PLUGINS filters delivered and external plugins together.
 */
const dropped = () => (process.env.VITE_PLUGIN_PATHS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(path => {
        const dir = resolve(root, path);
        let project;
        try {
            project = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8'));
        } catch (error) {
            throw new Error(`VITE_PLUGIN_PATHS: no readable package.json in ${dir}`, { cause: error });
        }
        const manifest = project.kiaoPlugin;
        if (!manifest?.id) throw new Error(`VITE_PLUGIN_PATHS: ${dir}/package.json declares no kiaoPlugin.id`);
        lendModules(dir, project);
        return { ...manifest, dir };
    });

/**
 * External projects cannot resolve the assembly's node_modules by walking their parent directories.
 * Lend it via symlink; projects with declared dependencies must install those first and keep
 * their own copies. Fill missing entries from the assembly so TS, esbuild and Vite resolve alike.
 * npm install may prune lent links; each assembly run restores them idempotently.
 */
const lendModules = (dir, manifest) => {
    const link = resolve(dir, 'node_modules');
    const target = resolve(root, 'node_modules');
    const own = [
        ...Object.keys(manifest?.dependencies ?? {}),
        ...Object.keys(manifest?.devDependencies ?? {}),
    ];
    let current;
    try { current = lstatSync(link); } catch { current = null; }
    if (!own.length) {
        if (current && !current.isSymbolicLink()) return;
        if (current && readlinkSync(link) === target) return;
        if (current) unlinkSync(link);
        symlinkSync(target, link, 'junction');
        return;
    }
    if (current && current.isSymbolicLink()) {
        unlinkSync(link);
        current = null;
    }
    if (!current) mkdirSync(link, { recursive: true });
    for (const dep of own) {
        try { lstatSync(resolve(link, dep)); } catch {
            throw new Error(
                `VITE_PLUGIN_PATHS: ${dir} declares its own "${dep}" but it is not installed — ` +
                `run \`npm install\` in that directory first.`);
        }
    }
    const isRealDir = path => {
        try { return lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(); }
        catch { return false; }
    };
    for (const entry of readdirSync(target)) {
        if (entry.startsWith('.')) continue;
        const at = resolve(link, entry);
        try { lstatSync(at); } catch {
            symlinkSync(resolve(target, entry), at, 'junction');
            continue;
        }
        // Merge scopes (e.g. @types/three beside @types/react), preserving project-owned entries.
        if (!own.includes(entry) && isRealDir(at) && isRealDir(resolve(target, entry))) {
            for (const child of readdirSync(resolve(target, entry))) {
                const atChild = resolve(at, child);
                try { lstatSync(atChild); continue; } catch { }
                symlinkSync(resolve(target, entry, child), atChild, 'junction');
            }
        }
    }
};

export const readCatalogue = () => {
    const catalogue = [...lot(), ...dropped()];
    const seen = catalogue.map(entry => entry.id).filter((id, i, all) => all.indexOf(id) !== i);
    if (seen.length) throw new Error(`two plugins claim the same id: ${[...new Set(seen)].join(', ')}`);
    return catalogue;
};

/** Source directories are build-only metadata; never publish them to the browser. */
export const publishedEntry = ({ dir, ...entry }) => entry;

/**
 * Explicit contract aliases work outside src/, where importer-based tsconfig aliases do not.
 * Exclude @/* to prevent access to shell internals. Anchor matches: string aliases would also
 * rewrite subpaths such as react-advanced-interactions/pointing to a subpath of a file.
 */
export const contractAliases = () => {
    const { paths } = JSON.parse(readFileSync(resolve(root, 'tsconfig.paths.json'), 'utf-8')).compilerOptions;
    return Object.entries(paths)
        .filter(([specifier, targets]) => specifier in SHARED_MODULES && targets.length === 1)
        .map(([specifier, [target]]) => ({
            find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
            replacement: resolve(root, target),
        }));
};

/**
 * VITE_PLUGINS selects delivered ids (comma-separated); unset/empty includes the whole catalogue.
 * Store configuration separately chooses which delivered plugins to load.
 */
export const assembledPlugins = (catalogue) => {
    const wanted = (process.env.VITE_PLUGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!wanted.length) return catalogue;
    const unknown = wanted.filter(id => !catalogue.some(entry => entry.id === id));
    if (unknown.length) throw new Error(`VITE_PLUGINS names no such plugin: ${unknown.join(', ')}`);
    return catalogue.filter(entry => wanted.includes(entry.id));
};

/**
 * Bare specifier -> published filename. Shared modules ship whole with the shell:
 * - React, antd, router, OIDC, pointing/context helpers and the files client need shared identity
 *   (hooks, contexts, instanceof); CodeMirror needs shared facets and language registries.
 * - Mermaid needs one global configuration/diagram registry; language-data is already in the kit.
 * - @cms-core and @cms-kit/* must refer to the shell's framework and shared kit instances.
 * Unlisted dependencies bundle with each plugin. Keep stateless @ant-design/icons unlisted:
 * publishing it prevents tree-shaking (~900 kB), while per-plugin imports cost only a few kB.
 */
export const SHARED_MODULES = {
    'react': 'react',
    'react-dom': 'react-dom',
    'react-dom/client': 'react-dom-client',
    'react/jsx-runtime': 'react-jsx-runtime',
    'react-router-dom': 'react-router-dom',
    'antd': 'antd',
    'kiao-worker': 'kiao-worker',
    'react-oidc-context': 'react-oidc-context',
    '@codemirror/state': 'codemirror-state',
    '@codemirror/view': 'codemirror-view',
    '@codemirror/language': 'codemirror-language',
    '@codemirror/lang-markdown': 'codemirror-lang-markdown',
    '@lezer/highlight': 'lezer-highlight',
    '@uiw/react-codemirror': 'react-codemirror',
    'mermaid': 'mermaid',
    '@codemirror/language-data': 'codemirror-language-data',
    'react-advanced-interactions': 'react-advanced-interactions',
    'react-concise': 'react-concise',
    '@cms-core': 'cms-core',
    '@cms-kit/markdown-editor': 'kit-markdown-editor',
    '@cms-kit/reorder': 'kit-reorder',
    '@cms-kit/tts': 'kit-tts',
    '@cms-kit/markdown': 'kit-markdown',
    '@cms-kit/template-lang': 'kit-template-lang',
    '@cms-kit/color': 'kit-color',
    '@cms-kit/zoom-control': 'kit-zoom-control',
    '@cms-kit/doc-id': 'kit-doc-id',
    '@cms-kit/components': 'kit-components',
    '@cms-kit/template-fields': 'kit-template-fields',
    '@cms-kit/code-editor': 'kit-code-editor',
    '@cms-kit/capabilities': 'kit-capabilities',
    '@cms-kit/archdia': 'kit-archdia',
    '@cms-kit/graph': 'kit-graph',
    '@cms-kit/diagram-shared': 'kit-diagram-shared',
};

/** External projects run tests and typechecks against the assembly that builds them. */
const droppedDirs = () => readCatalogue()
    .filter(entry => !entry.dir.startsWith(resolve(root, 'src/plugins')))
    .map(entry => entry.dir);

export const droppedTestGlobs = () => droppedDirs().map(dir => `${dir}/**/*.{test,spec}.?(c|m)[jt]s?(x)`);

/**
 * Vitest's root-relative exclusions miss external projects. Exclude lent dependency tests and
 * Playwright e2e specs, which need the e2e harness rather than Vitest.
 */
export const droppedTestExcludes = () => droppedDirs()
    .flatMap(dir => [`${dir}/node_modules/**`, `${dir}/e2e/**`]);

export const sharedModuleUrl = (base, name) => `${base}runtime/${name}.js`;

export const RUNTIME_BARREL_ID = 'virtual:kiao-runtime';
export const ASSEMBLY_ID = 'virtual:kiao-plugin-assembly';
