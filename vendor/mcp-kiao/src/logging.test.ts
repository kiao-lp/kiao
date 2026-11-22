import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { buildRecord, flushLog, installToolLogging, sanitizeArguments, type CallRecord } from './logging.js';
import { guard, ok } from './tools-common.js';
import { z } from 'zod';

const baseConfig = (logDir: string): Config => ({
    workerUrl: 'http://127.0.0.1:0',
    accessToken: 'turn-abc',
    noAuth: false,
    logDir,
    slowCallMs: 5000,
});

const record = (over: Partial<Parameters<typeof buildRecord>[0]> = {}): CallRecord =>
    buildRecord({
        timestamp: new Date().toISOString(),
        serverName: 'kiao-files',
        toolName: 'files_read',
        args: { path: 'docs/a.md' },
        result: ok('done'),
        durationMs: 12,
        aborted: false,
        slowCallMs: 5000,
        ...over,
    });

describe('buildRecord', () => {
    it('describes a normal call: what was called, with what, for how long, at what size', () => {
        const line = record({ requestId: 7, sessionId: 'sess-1' });
        expect(line).toMatchObject({
            server: 'kiao-files',
            tool_name: 'files_read',
            request_id: 7,
            session_id: 'sess-1',
            status: 'success',
            duration_ms: 12,
            arguments: { path: 'docs/a.md' },
        });
        expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(line.input_bytes).toBe(Buffer.byteLength(JSON.stringify({ path: 'docs/a.md' })));
        expect(line.output_bytes).toBeGreaterThan(0);
        expect(line.anomalies).toBeUndefined();
        expect(line.error).toBeUndefined();
    });

    // These servers reach worker and nothing that bills tokens, so bytes are what every
    // record carries. Tokens appear only for a tool that reported upstream usage.
    it('leaves the token fields out when no upstream LLM was involved', () => {
        const line = record();
        expect(line.input_tokens).toBeUndefined();
        expect(line.total_tokens).toBeUndefined();
    });

    it('totals reported usage when the upstream did not', () => {
        expect(record({ usage: { inputTokens: 30, outputTokens: 12 } })).toMatchObject({
            input_tokens: 30,
            output_tokens: 12,
            total_tokens: 42,
        });
    });

    it('keeps the stack of an error a handler caught and flattened into a message', () => {
        const thrown = new Error('file not found');
        const line = record({ result: { content: [{ type: 'text', text: 'Error: file not found' }], isError: true }, reported: thrown });
        expect(line.status).toBe('error');
        expect(line.error?.message).toBe('file not found');
        expect(line.error?.stack).toContain('logging.test.ts');
    });

    it('falls back to the error result text when nothing reported the error', () => {
        const line = record({ result: { content: [{ type: 'text', text: 'Error: nope' }], isError: true } });
        expect(line.status).toBe('error');
        expect(line.error?.message).toBe('Error: nope');
    });

    it('calls an answer with nothing in it unexpected rather than successful', () => {
        expect(record({ result: { content: [] } })).toMatchObject({ status: 'unexpected', anomalies: ['empty_result'] });
        expect(record({ result: { content: [{ type: 'text', text: '  ' }] } })).toMatchObject({ status: 'unexpected' });
    });

    it('flags a result that is not a tool result at all', () => {
        expect(record({ result: 'plain string' })).toMatchObject({ status: 'unexpected', anomalies: ['malformed_result'] });
    });

    it('flags a client that gave up waiting', () => {
        expect(record({ aborted: true })).toMatchObject({ status: 'unexpected', anomalies: ['aborted'] });
    });

    // Slowness and bulk say something about the call, not about whether it worked.
    it('flags slowness and bulk without calling the call a failure', () => {
        expect(record({ durationMs: 9000 })).toMatchObject({ status: 'success', anomalies: ['slow_call'] });
        expect(record({ result: ok('x'.repeat(70_000)) })).toMatchObject({ status: 'success', anomalies: ['large_output'] });
    });

    it('survives a payload that will not serialize', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => record({ args: cyclic, result: cyclic })).not.toThrow();
    });
});

describe('sanitizeArguments', () => {
    it('never writes down a value whose key looks like a credential', () => {
        expect(sanitizeArguments({ accessToken: 'turn-abc', apiKey: 'k', password: 'p', path: 'docs/a.md' })).toEqual({
            accessToken: '[redacted]',
            apiKey: '[redacted]',
            password: '[redacted]',
            path: 'docs/a.md',
        });
    });

    it('samples a long value instead of copying it — a files_write carries a whole document', () => {
        const sampled = sanitizeArguments({ content: 'x'.repeat(2000) }) as { content: string };
        expect(sampled.content).toHaveLength(500 + '…(+1500 chars)'.length);
        expect(sampled.content.endsWith('…(+1500 chars)')).toBe(true);
    });

    it('caps a long array and says how much it dropped', () => {
        const capped = sanitizeArguments({ paths: Array.from({ length: 25 }, (_, i) => `p${i}`) }) as { paths: string[] };
        expect(capped.paths).toHaveLength(21);
        expect(capped.paths[20]).toBe('…(+5 more)');
    });

    it('stops descending rather than following a deep structure down', () => {
        expect(sanitizeArguments({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: '[object]' } } } });
    });
});

// The whole point of the interceptor: a real call, over a real transport, comes back untouched and
// leaves a line behind.
describe('installToolLogging', () => {
    let root = '';
    let logDir = '';

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'kiao-mcp-log-'));
        logDir = root;
    });

    afterEach(async () => {
        await flushLog();
        await rm(root, { recursive: true, force: true });
    });

    const connected = async (register: (server: McpServer) => void, dir = logDir) => {
        const server = new McpServer({ name: 'kiao-files', version: '0.0.1' });
        installToolLogging(server, 'kiao-files', baseConfig(dir));
        register(server);
        const client = new Client({ name: 'test', version: '0.0.1' });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
        return { client, server };
    };

    const lines = async (): Promise<CallRecord[]> => {
        await flushLog();
        const day = new Date().toISOString().slice(0, 10);
        const text = await readFile(join(logDir, `${day}.jsonl`), 'utf8');
        return text.trim().split('\n').map((line) => JSON.parse(line) as CallRecord);
    };

    it('logs a successful call and hands the model exactly what the tool returned', async () => {
        const { client } = await connected((server) =>
            server.registerTool('files_read', { description: 'get', inputSchema: { path: z.string() } },
                guard(async ({ path }) => ok({ path, title: 'Project notes' }))),
        );

        const result = await client.callTool({ name: 'files_read', arguments: { path: 'docs/a.md' } });
        // Nothing of the log leaks into the answer: no extra block, no extra field.
        expect(result).toEqual({ content: [{ type: 'text', text: '{"path":"docs/a.md","title":"Project notes"}' }] });

        const [line] = await lines();
        expect(line).toMatchObject({
            server: 'kiao-files',
            tool_name: 'files_read',
            status: 'success',
            arguments: { path: 'docs/a.md' },
        });
        expect(line.request_id).toBeDefined();
        expect(line.duration_ms).toBeGreaterThanOrEqual(0);
        expect(line.output_bytes).toBeGreaterThan(0);
    });

    it('logs a failing call with the stack the handler threw', async () => {
        const { client } = await connected((server) =>
            server.registerTool('files_read', { description: 'get', inputSchema: { path: z.string() } },
                guard(async () => { throw new Error('file not found'); })),
        );

        const result = await client.callTool({ name: 'files_read', arguments: { path: 'nope' } });
        expect(result.isError).toBe(true);

        const [line] = await lines();
        expect(line.status).toBe('error');
        expect(line.error?.message).toBe('file not found');
        expect(line.error?.stack).toContain('logging.test.ts');
    });

    // The reason this wraps `tools/call` rather than each handler: a call the model gets wrong
    // never reaches a handler, and those are the ones worth seeing.
    it('logs a call that never reached a handler — bad arguments, invented tool name', async () => {
        const { client } = await connected((server) =>
            server.registerTool('files_read', { description: 'get', inputSchema: { path: z.string() } },
                guard(async () => ok('never runs'))),
        );

        await client.callTool({ name: 'files_read', arguments: { path: 42 } });
        await client.callTool({ name: 'files_invented', arguments: {} });

        const [rejected, unknown] = await lines();
        expect(rejected).toMatchObject({ tool_name: 'files_read', status: 'error' });
        expect(unknown).toMatchObject({ tool_name: 'files_invented', status: 'error' });
        expect(unknown.error?.message).toContain('not found');
    });

    it('creates logs/kiao-mcp on the way to the first line', async () => {
        logDir = join(root, 'logs', 'kiao-mcp');
        const { client } = await connected((server) =>
            server.registerTool('files_info', { description: 'exists', inputSchema: {} },
                guard(async () => ok('fine'))),
        );

        await client.callTool({ name: 'files_info', arguments: {} });
        expect(await lines()).toHaveLength(1);
    });

    it('appends one line per call, in order', async () => {
        const { client } = await connected((server) =>
            server.registerTool('files_info', { description: 'exists', inputSchema: { path: z.string() } },
                guard(async ({ path }) => ok({ path }))),
        );

        await client.callTool({ name: 'files_info', arguments: { path: 'a' } });
        await client.callTool({ name: 'files_info', arguments: { path: 'b' } });

        expect((await lines()).map((line) => (line.arguments as { path: string }).path)).toEqual(['a', 'b']);
    });

    it('serves the call normally when the log cannot be written', async () => {
        // A directory that cannot be created: a path under a file.
        const { client } = await connected(
            (server) => server.registerTool('files_info', { description: 'exists', inputSchema: {} },
                guard(async () => ok('fine'))),
            join(root, 'not-a-dir.txt', 'nested'),
        );

        const result = await client.callTool({ name: 'files_info', arguments: {} });
        expect(result).toEqual({ content: [{ type: 'text', text: 'fine' }] });
        await expect(flushLog()).resolves.toBeUndefined();
    });

    it('registers no handler at all when the log is switched off', async () => {
        const { client } = await connected(
            (server) => server.registerTool('files_info', { description: 'exists', inputSchema: {} },
                guard(async () => ok('fine'))),
            '',
        );

        expect(await client.callTool({ name: 'files_info', arguments: {} }))
            .toEqual({ content: [{ type: 'text', text: 'fine' }] });
        await flushLog();
        await expect(readFile(join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8')).rejects.toThrow();
    });
});
