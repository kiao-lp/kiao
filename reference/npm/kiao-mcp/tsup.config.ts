import { defineConfig } from 'tsup';

// Two MCP servers, launched by worker as `node dist/index.js` (kiao-files) and
// `node dist/hybridflow-entry.js` (kiao-hybridflow); ship ESM only with a shebang.
const servers = {
    entry: ['src/index.ts', 'src/hybridflow-entry.ts'],
    format: ['esm'],
    // No declarations and no sourcemaps: nothing imports these binaries — a deployment runs
    // them — and the CLI spawns them without `--enable-source-maps`, so both were half
    // a megabyte staged onto a server for nobody to read.
    dts: false,
    sourcemap: false,
    splitting: false,
    clean: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
};

// The shared slice (`src/shared.ts`) an out-of-package server imports and bundles: the one entry
// that ships declarations, since a consumer typechecks against it. It lands beside the binaries
// above, which is also where the staged bundle carries it.
const shared = {
    entry: { shared: 'src/shared.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    splitting: false,
    clean: false,
    target: 'node20',
};

export default defineConfig([servers, shared]);
