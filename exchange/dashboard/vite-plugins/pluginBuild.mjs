// Emit build/plugins/<id>/index.js and style.css. Shared modules stay external;
// the shell's import map supplies their single instances. cssCodeSplit: false
// preserves the loader contract: link style.css before importing index.js.

import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';
import { isAbsolute, relative, resolve } from 'node:path';
import { SHARED_MODULES, contractAliases } from './assembly-shared.mjs';

const within = (parent, child) => {
    const step = relative(parent, child);
    return step === '' || (!step.startsWith('..') && !isAbsolute(step));
};

/**
 * Reject shell source bundled through paths that bypass the external shared API:
 * duplicated state (especially React contexts) silently breaks plugins at runtime.
 * Keep @/* out of contract aliases so dropped plugins cannot bypass the shared API.
 * This also covers delivered plugins, which can reach src/ without an alias.
 * src/plugins/ is exempt: copying another plugin does not duplicate shell state.
 */
const contractOnly = (entry, root) => {
    const shell = resolve(root, 'src');
    const plugins = resolve(root, 'src/plugins');
    const own = resolve(entry.dir);
    return {
        name: 'kiao:contract-only',
        buildEnd() {
            const trespasses = [...this.getModuleIds()]
                .filter(id => !id.startsWith('\0'))
                .map(id => id.split('?')[0])
                .filter(file => within(shell, file) && !within(plugins, file) && !within(own, file))
                .map(file => {
                    const from = (this.getModuleInfo(file)?.importers ?? [])
                        .map(importer => relative(root, importer)).join(', ');
                    return `  ${relative(root, file)}${from ? `  ← ${from}` : ''}`;
                });
            if (!trespasses.length) return;
            this.error(
                `plugin "${entry.id}" bundles its own copy of the shell:\n${trespasses.join('\n')}\n` +
                `A copy is a second instance of whatever state that module holds — a React context in it ` +
                `has no provider, and the plugin fails at runtime, only in a built assembly. Import it from ` +
                `@cms-core or a @cms-kit/*, adding it to that public API if it is not on it yet.`);
        },
    };
};

/**
 * The loader always requests style.css, even for plugins without CSS.
 * Run after Vite emits CSS: claiming the name first renames real CSS to style2.css,
 * which the loader never loads.
 */
const alwaysAStylesheet = () => ({
    name: 'kiao:always-a-stylesheet',
    generateBundle: {
        order: 'post',
        handler(_options, bundle) {
            if (Object.keys(bundle).some(name => name.endsWith('.css'))) return;
            this.emitFile({ type: 'asset', fileName: 'style.css', source: '/* this plugin styles nothing */\n' });
        },
    },
});

export const pluginBuildConfig = (entry, { base, root, buildDateTime }) => ({
    configFile: false,
    root,
    // Asset URLs must include the plugin directory; the app base would return SPA HTML.
    // BASE_URL is plugin-local here; shared @cms-core retains the shell base for links.
    base: `${base.replace(/\/*$/, '/')}plugins/${entry.id}/`,
    logLevel: 'warn',
    plugins: [react(), tsconfigPaths({ root }), svgr(), alwaysAStylesheet(), contractOnly(entry, root)],
    // tsconfig paths exclude dropped sources outside src/; these aliases apply everywhere.
    resolve: { alias: contractAliases() },
    css: { preprocessorOptions: { less: { javascriptEnabled: true } } },
    define: {
        PACKAGE_VERSION: JSON.stringify('3.2.1'),
        BUILD_DATETIME: JSON.stringify(buildDateTime),
    },
    build: {
        outDir: `build/plugins/${entry.id}`,
        emptyOutDir: true,
        cssCodeSplit: false,
        // The shell already owns build/ and public/; keep output confined to this plugin.
        copyPublicDir: false,
        rollupOptions: {
            input: `${entry.dir}/index.tsx`,
            external: Object.keys(SHARED_MODULES),
            // Preserve the imported plugin export; application entry defaults would eliminate it.
            preserveEntrySignatures: 'strict',
            output: {
                format: 'es',
                entryFileNames: 'index.js',
                chunkFileNames: '[name]-[hash].js',
                assetFileNames: asset =>
                    asset.names?.[0]?.endsWith('.css') ? 'style.css' : '[name]-[hash][extname]',
            },
        },
    },
});
