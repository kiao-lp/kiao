import { pathToFileURL } from 'node:url';
import { startServer } from './server.js';
import { registerHybridflowTools } from './tools-hybridflow.js';
import { HybridflowApi } from './hybridflow/api.js';

// The kiao-hybridflow MCP server: inspect, modify and create every kind of hybridflow object —
// boards and their cards, workflows and workflow classes, node classes and their versions,
// managed agents and runners — in real time. HybridflowApi is layered on the same files client,
// so this server still reaches the worker — which proxies these calls to the
// hybridflow-store with its service token, attributing the change to this turn's owner. The turn
// holds no store credential and names no store address. Playing a card is not here — play,
// played, settle, the usage report and the runner heartbeat are the runner's alone.

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
    startServer('kiao-hybridflow', ({ server, files }) =>
        registerHybridflowTools(server, new HybridflowApi(files)),
    ).catch((err) => {
        process.stderr.write(`[kiao-hybridflow] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
        process.exit(1);
    });
}
