// Production plugins externalize shared modules to the shell's import map, preserving singleton identity.
// Dev and Vitest import plugin sources directly; Vite resolves dependencies without an import map.

import { searchForWorkspaceRoot, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
    ASSEMBLY_ID, RUNTIME_BARREL_ID, SHARED_MODULES, assembledPlugins, contractAliases,
    publishedEntry, readCatalogue, sharedModuleUrl,
} from './assembly-shared.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export interface CatalogueEntry {
    id: string;
    title: string;
    description: string;
    /** Where its source is. Build-side only — the browser never sees a path. */
    dir: string;
}

/** Generated shims need paths inside src/ so vite-tsconfig-paths applies importer-based aliases. */
const runtimeId = (name: string) => resolve(here, '../src/runtime', `${name}.ts`);
const runtimeDir = resolve(here, '../src/runtime');
const specifierOf = (name: string) =>
    Object.entries(SHARED_MODULES).find(([, published]) => published === name)?.[0];

/**
 * Rollup cannot enumerate CommonJS exports via export *; publish names read from each package
 * so React hooks and JSX runtime exports remain available without maintaining a separate list.
 */
const COMMONJS_MODULES = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']);

/**
 * export * omits defaults; request them only from modules that provide one.
 * scripts/build-assembly.mjs checks plugin imports against shim exports.
 */
const DEFAULT_EXPORTS = new Set(['mermaid', '@uiw/react-codemirror']);

const requireHere = createRequire(import.meta.url);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const commonjsExports = (specifier: string) => Object.keys(requireHere(specifier))
    .filter(name => name !== 'default' && IDENTIFIER.test(name));

/** Fixed entry chunks share the shell graph so plugins receive the same module instances. */
const runtimeShim = (specifier: string) => (COMMONJS_MODULES.has(specifier)
    ? [
        `import ns from ${JSON.stringify(specifier)};`,
        `export default ns;`,
        `export const { ${commonjsExports(specifier).join(', ')} } = ns;`,
    ]
    : [
        `export * from ${JSON.stringify(specifier)};`,
        DEFAULT_EXPORTS.has(specifier) ? `export { default } from ${JSON.stringify(specifier)};` : '',
    ]).filter(Boolean).join('\n');

/**
 * Include shared modules and their styles in the shell graph.
 * Dev links styles itself and needs no barrel, avoiding CommonJS export * warnings.
 */
const runtimeBarrel = (fromSource: boolean) => fromSource ? '' : Object.values(SHARED_MODULES)
    .map(name => `import ${JSON.stringify(runtimeId(name))};`).join('\n');

const root = resolve(here, '..');
const srcPlugins = resolve(root, 'src/plugins');

/** External sources use Vite /@fs URLs and must also be in server.fs.allow. */
const sourceUrl = (entry: CatalogueEntry) =>
    entry.dir.startsWith(srcPlugins) ? `/src/plugins/${entry.id}/index.tsx` : `/@fs${entry.dir}/index.tsx`;

const assemblyModule = (plugins: CatalogueEntry[], fromSource: boolean) => {
    const sources = fromSource
        ? plugins.map(p => `  ${JSON.stringify(p.id)}: () => import('${sourceUrl(p)}'),`).join('\n')
        : '';
    return `export const CATALOGUE = ${JSON.stringify(plugins.map(publishedEntry))};
export const SOURCES = {
${sources}
};
`;
};

export const assembly = (base: string): Plugin => {
    const plugins = assembledPlugins(readCatalogue());
    let fromSource = true;

    return {
        name: 'kiao:assembly',
        config(_config, { command }) {
            fromSource = command !== 'build';
            // External plugin sources need explicit aliases and permission to be served.
            const outOfTree = {
                resolve: { alias: contractAliases() },
                // Explicit allow replaces Vite's workspace default; retain it for reference/npm file: packages.
                server: {
                    fs: { allow: [searchForWorkspaceRoot(root), ...plugins.map(entry => entry.dir)] },
                },
            };
            if (fromSource) return outOfTree;
            return {
                ...outOfTree,
                build: {
                    rollupOptions: {
                        input: Object.fromEntries([
                            ['index', resolve(here, '../index.html')],
                            ...Object.values(SHARED_MODULES)
                                .map(name => [`runtime/${name}`, runtimeId(name)]),
                        ]),
                        // Preserve shim exports: application entry defaults would tree-shake them away.
                        preserveEntrySignatures: 'strict',
                        output: {
                            // Import-map URLs must stay unhashed; front servers serve the bundle with no-store.
                            entryFileNames: (chunk: { name: string }) =>
                                chunk.name.startsWith('runtime/') ? '[name].js' : 'assets/[name]-[hash].js',
                        },
                    },
                },
            };
        },
        resolveId(id) {
            if (id === ASSEMBLY_ID || id === RUNTIME_BARREL_ID) return '\0' + id;
            // Resolve generated shims before filesystem lookup.
            if (id.startsWith(runtimeDir)) return id;
            return null;
        },
        load(id) {
            if (id === '\0' + ASSEMBLY_ID) return assemblyModule(plugins, fromSource);
            if (id === '\0' + RUNTIME_BARREL_ID) return runtimeBarrel(fromSource);
            if (id.startsWith(runtimeDir)) {
                const specifier = specifierOf(id.slice(runtimeDir.length + 1).replace(/\.ts$/, ''));
                return specifier ? runtimeShim(specifier) : null;
            }
            return null;
        },
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                if (fromSource) return html;
                const imports = Object.fromEntries(Object.entries(SHARED_MODULES)
                    .map(([specifier, name]) => [specifier, sharedModuleUrl(base, name)]));
                const tag = `<script type="importmap">${JSON.stringify({ imports }, null, 2)}</script>`;
                return html.replace('</head>', `    ${tag}\n  </head>`);
            },
        },
    };
};
