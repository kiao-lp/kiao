import { defineConfig } from 'tsup';

export default defineConfig({
    // utils.ts is a second entry, not just part of the barrel, so a Node-side consumer can reach
    // the pure helpers without the barrel — which re-exports the React context and hooks and so
    // makes react/react-dom a hard runtime requirement. See the "./utils" export in package.json.
    entry: ['src/index.ts', 'src/utils.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom'],
});
