import { pathToFileURL } from 'node:url';
import { startServer } from './server.js';
import { registerFileTools } from './tools-files.js';

// The kiao-files MCP server: direct file access + git tools over the worker.

// Only auto-start when run as the entrypoint, so the module can also be imported in tests.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
    startServer('kiao-files', ({ server, files }) => registerFileTools(server, files)).catch((err) => {
        process.stderr.write(`[kiao-files] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
        process.exit(1);
    });
}
