import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runtime configuration, resolved from env with production defaults. */
export interface Config {
    /** Base URL of the worker REST API — the loopback address of the service that spawned us. */
    workerUrl: string;
    /** The Bearer [REDACTED] worker minted for the turn this process serves. */
    accessToken: string;
    /** When true, skip auth entirely (worker `debug` profile). */
    noAuth: boolean;
    /** Absolute directory the tool-call log is appended to. Empty disables the log entirely. */
    logDir: string;
    /** A call at least this slow is flagged `slow_call` in the log. */
    slowCallMs: number;
}

const env = (key: string, fallback: string): string => {
    const value = process.env[key];
    return value && value.trim() !== '' ? value.trim() : fallback;
};

/**
 * Where the tool-call log goes.
 *
 * Beside the installed package by default — deliberately *not* the working directory, which for a
 * turn is the store itself: a file written there is a document Dashboard lists and the agent can
 * read straight back, and this log is meant to be invisible to the turn it measures. Both the
 * source tree (`src/config.ts`) and the bundle (`dist/*.js`) sit one directory below the package
 * root, so the same expression finds it either way.
 *
 * `KIAO_MCP_LOG=0` turns it off; `KIAO_MCP_LOG_DIR` puts it somewhere a deployment can write to.
 */
const logDirectory = (): string => {
    const enabled = process.env.KIAO_MCP_LOG;
    if (enabled === '0' || enabled === 'false') return '';
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    return resolve(env('KIAO_MCP_LOG_DIR', join(packageRoot, 'logs', 'kiao-mcp')));
};

export const loadConfig = (): Config => ({
    workerUrl: env('WORKER_URL', 'http://127.0.0.1:8080'),
    accessToken: env('KIAO_MCP_ACCESS_TOKEN', ''),
    noAuth: process.env.KIAO_MCP_NO_AUTH === 'true' || process.env.KIAO_MCP_NO_AUTH === '1',
    logDir: logDirectory(),
    slowCallMs: Number(env('KIAO_MCP_SLOW_CALL_MS', '5000')) || 5000,
});
