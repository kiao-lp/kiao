// Plain ESM: shared by Vite and Node without a TypeScript step.

import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '..');

// Plugin id = folder name under src/plugins/; entry is index.tsx.
const lot = () => JSON.parse(readFileSync(resolve(root, 'src/plugins/catalogue.json'), 'utf-8'))
    .map(entry => ({ ...entry, dir: resolve(root, 'src/plugins', entry.id) }));

// VITE_PLUGIN_PATHS: comma-separated external projects (index.tsx + package.json kiaoPlugin).
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

// Symlink assembly node_modules into external projects; declared dependencies stay project-owned.
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

export const publishedEntry = ({ dir, ...entry }) => entry;

// Aliases for sources outside src/; @/* excluded. Anchored so subpaths do not match.
export const contractAliases = () => {
    const { paths } = JSON.parse(readFileSync(resolve(root, 'tsconfig.paths.json'), 'utf-8')).compilerOptions;
    return Object.entries(paths)
        .filter(([specifier, targets]) => specifier in SHARED_MODULES && targets.length === 1)
        .map(([specifier, [target]]) => ({
            find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
            replacement: resolve(root, target),
        }));
};

// VITE_PLUGINS: comma-separated ids; empty = whole catalogue.
export const assembledPlugins = (catalogue) => {
    const wanted = (process.env.VITE_PLUGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!wanted.length) return catalogue;
    const unknown = wanted.filter(id => !catalogue.some(entry => entry.id === id));
    if (unknown.length) throw new Error(`VITE_PLUGINS names no such plugin: ${unknown.join(', ')}`);
    return catalogue.filter(entry => wanted.includes(entry.id));
};

// Bare specifier -> runtime file. Listed modules share the shell instance; unlisted bundle per plugin.
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
    '@codemirror/autocomplete': 'codemirror-autocomplete',
    '@codemirror/lint': 'codemirror-lint',
    '@codemirror/lang-markdown': 'codemirror-lang-markdown',
    '@lezer/highlight': 'lezer-highlight',
    '@uiw/react-codemirror': 'react-codemirror',
    'mermaid': 'mermaid',
    '@codemirror/language-data': 'codemirror-language-data',
    'react-advanced-interactions': 'react-advanced-interactions',
    'react-concise': 'react-concise',
    '@kiao-dashboard-core': 'core',
    '@kiao-dashboard-kit/markdown-editor': 'kit-markdown-editor',
    '@kiao-dashboard-kit/reorder': 'kit-reorder',
    '@kiao-dashboard-kit/tts': 'kit-tts',
    '@kiao-dashboard-kit/markdown': 'kit-markdown',
    '@kiao-dashboard-kit/template-lang': 'kit-template-lang',
    '@kiao-dashboard-kit/color': 'kit-color',
    '@kiao-dashboard-kit/zoom-control': 'kit-zoom-control',
    '@kiao-dashboard-kit/doc-id': 'kit-doc-id',
    '@kiao-dashboard-kit/date-time': 'kit-date-time',
    '@kiao-dashboard-kit/components': 'kit-components',
    '@kiao-dashboard-kit/template-fields': 'kit-template-fields',
    '@kiao-dashboard-kit/code-editor': 'kit-code-editor',
    '@kiao-dashboard-kit/capabilities': 'kit-capabilities',
    '@kiao-dashboard-kit/archdia': 'kit-archdia',
    '@kiao-dashboard-kit/graph': 'kit-graph',
    '@kiao-dashboard-kit/diagram-shared': 'kit-diagram-shared',
};

const droppedDirs = () => readCatalogue()
    .filter(entry => !entry.dir.startsWith(resolve(root, 'src/plugins')))
    .map(entry => entry.dir);

export const droppedTestGlobs = () => droppedDirs().map(dir => `${dir}/**/*.{test,spec}.?(c|m)[jt]s?(x)`);

// Exclude external node_modules and e2e from Vitest.
export const droppedTestExcludes = () => droppedDirs()
    .flatMap(dir => [`${dir}/node_modules/**`, `${dir}/e2e/**`]);

export const sharedModuleUrl = (base, name) => `${base}runtime/${name}.js`;

export const ASSEMBLY_ID = 'virtual:kiao-plugin-assembly';
