import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NoAuthTokenProvider, StaticTokenProvider, type TokenProvider } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { WorkerClient } from './files.js';
import { installToolLogging } from './logging.js';

/**
 * Bootstrap shared by every entrypoint: resolve config, wire the token provider and files
 * client, let the caller register its tool family on the MCP server, then connect over stdio.
 *
 * Only the files client is built here — an entry that needs more (the higher-level
 * HybridflowApi, a client for another service) constructs it from `files`/`config`/`tokens`
 * in its `register` callback, so each server's bundle stays free of the domain trees it
 * does not serve.
 */
export async function startServer(
    name: string,
    register: (ctx: {
        server: McpServer;
        files: WorkerClient;
        config: Config;
        tokens: TokenProvider;
    }) => void,
): Promise<void> {
    const config = loadConfig();
    const tokens = tokenProvider(config);
    const files = new WorkerClient(config, tokens);

    const server = new McpServer({ name, version: '0.0.1' });
    // Before `register`, not after: McpServer installs its `tools/call` handler on the first
    // registerTool, and the log wraps that handler as it goes in. See logging.ts.
    installToolLogging(server, name, config);
    register({ server, files, config, tokens });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[${name}] connected — worker: ${config.workerUrl} (${credentialLabel(config)})\n`);
}

/**
 * Which credential this process runs on, in order of how specific the signal is.
 *
 * A handed-over token is the narrowest statement of intent — worker spawned this process
 * for one turn and told it who it is acting as — so it wins over the debug switch. That order also
 * keeps the deployment honest on a `debug` worker, where sending the token changes nothing
 * about access but is what puts the real user in the service's log.
 *
 * Neither set is a misconfiguration, not a case to muddle through: nothing here can obtain a
 * credential on its own, so every request would go out unauthenticated and come back 401. Saying
 * so at startup names the two variables; failing later names a file operation.
 */
export function tokenProvider(config: Config): TokenProvider {
    if (config.accessToken) return new StaticTokenProvider(config.accessToken);
    if (config.noAuth) return new NoAuthTokenProvider();
    throw new Error(
        'No credential: set KIAO_MCP_ACCESS_TOKEN to the token worker minted for this turn, '
            + 'or KIAO_MCP_NO_AUTH=1 against a worker running its debug profile.',
    );
}

/** How this server authenticates, for the one line it writes to stderr on connect. That line is
 *  the only place a deployment says out loud which store it reached and as whom, and it lands in
 *  the worker log for the turn. */
const credentialLabel = (config: Config): string => (config.accessToken ? 'turn token' : 'no auth');
