// Build plugins/<id>/index.js + style.css; shared modules external via import map.

import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';
import { isAbsolute, relative, resolve } from 'node:path';
import { SHARED_MODULES, contractAliases } from './assembly-shared.mjs';

const within = (parent, child) => {
    const step = relative(parent, child);
    return step === '' || (!step.startsWith('..') && !isAbsolute(step));
};

// Fail if a plugin bundles shell source outside src/plugins/ and its own dir.
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
                `@kiao-dashboard-core or a @kiao-dashboard-kit/*, adding it to that public API if it is not on it yet.`);
        },
    };
};

// Emit empty style.css when the plugin has no CSS; post order keeps real CSS named style.css.
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
    base: `${base.replace(/\/*$/, '/')}plugins/${entry.id}/`,
    logLevel: 'warn',
    plugins: [react(), tsconfigPaths({ root }), svgr(), alwaysAStylesheet(), contractOnly(entry, root)],
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
        copyPublicDir: false,
        rollupOptions: {
            input: `${entry.dir}/index.tsx`,
            external: Object.keys(SHARED_MODULES),
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
