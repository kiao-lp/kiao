import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticTokenProvider } from './auth.js';
import { WorkerClient } from './files.js';
import { HybridflowApi } from './hybridflow/api.js';
import { registerHybridflowTools } from './tools-hybridflow.js';

// Exercise tools/call through SDK validation, the domain API and HTTP serialization.
// The store owns topology and export validation; its refusals must reach the caller.
describe('hybridflow MCP contract', () => {
    let client: Client;
    let server: McpServer;
    const fetchMock = vi.fn<typeof fetch>();
    const schemaId = '00000000-0000-0000-0000-000000000001';
    const producerId = '00000000-0000-0000-0000-000000000002';
    const consumerId = '00000000-0000-0000-0000-000000000003';
    const settings = {
        agent: 'reviewer', effort: 'high', permission: 'bypassPermissions', folder: '/',
        runner: 'local', extra: { custom: 'preserve me' },
    };

    beforeEach(async () => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        const files = new WorkerClient({
            workerUrl: 'http://worker.test', accessToken: 'turn-token', noAuth: false,
            logDir: '', slowCallMs: 5000,
        }, new StaticTokenProvider('turn-token'));
        server = new McpServer({ name: 'kiao-hybridflow', version: '0.0.1' });
        registerHybridflowTools(server, new HybridflowApi(files));
        client = new Client({ name: 'contract-test', version: '0.0.1' });
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    });

    afterEach(async () => {
        await client.close();
        await server.close();
        vi.unstubAllGlobals();
    });

    it('lists schema values from other boards without changing their JSON', async () => {
        const catalogue = { schemaValues: [{
            id: schemaId, title: 'Message', boardSlug: 'types', boardName: 'Types',
            value: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        }] };
        fetchMock.mockResolvedValueOnce(Response.json(catalogue));

        const result = await client.callTool({ name: 'board_schema_values', arguments: {} });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith('http://worker.test/hybridflow-runner/schema-values', {
            method: 'GET', headers: { Authorization: 'Bearer turn-token' }, body: undefined,
        });
        expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(catalogue) }] });
    });

    it('creates schema values, typed values and a producer/consumer chain in one batch', async () => {
        const flowNodes = [
            {
                id: schemaId, title: 'Message schema', type: 'value', valueType: 'json-schema',
                value: {
                    $defs: { message: { type: 'string' } }, type: 'object',
                    properties: { message: { $ref: '#/$defs/message' } },
                    required: ['message'], additionalProperties: false,
                },
            },
            { title: 'Example', type: 'value', valueType: schemaId, value: { message: 'hello' } },
            {
                id: producerId, title: 'Write', type: 'ai', outputType: schemaId, settings,
                onSuccess: { flowNode: consumerId, mode: 'end', compact: false },
            },
            {
                id: consumerId, title: 'Review', type: 'ai', settings,
                body: 'Review {{input.message}} and {{input.items.0}}.',
                criteria: [{ text: 'Check {{input.person.name}} against {{input}}.' }],
            },
        ];
        fetchMock.mockResolvedValueOnce(Response.json({ flowNodes }));

        const result = await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });

        expect(result.isError).not.toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith('http://worker.test/hybridflow-runner/boards/major/flow-nodes', {
            method: 'POST', headers: { Authorization: 'Bearer turn-token', 'Content-Type': 'application/json' },
            body: expect.any(String),
        });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });
    });

    it.each([null, false, true, 0, '', [], { nested: [null, false, { output: 'data', type: 'string' }] }])(
        'preserves the JSON value %j on creation and patch', async (value) => {
            const flowNodes = [{ title: 'Value', type: 'value', value }];
            fetchMock.mockResolvedValueOnce(Response.json({ flowNodes }));
            fetchMock.mockResolvedValueOnce(Response.json({ value }));

            const created = await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
            const patched = await client.callTool({
                name: 'board_patch_card', arguments: { handle: 'major', id: 'value', patch: { value } },
            });

            expect(created.isError).not.toBe(true);
            expect(patched.isError).not.toBe(true);
            expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });
            expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ value });
        },
    );

    it('sets and clears outputType without dropping revision or settings extensions', async () => {
        for (const patch of [{ outputType: schemaId, settings }, { outputType: '' }, { valueType: '' }]) {
            fetchMock.mockResolvedValueOnce(Response.json(patch));
            const result = await client.callTool({
                name: 'board_patch_card', arguments: { handle: 'major', id: 'card', patch, ifMatch: 7 },
            });
            expect(result.isError).not.toBe(true);
            expect(fetchMock).toHaveBeenLastCalledWith('http://worker.test/hybridflow-runner/boards/major/flow-nodes/card', {
                method: 'PATCH',
                headers: { Authorization: 'Bearer turn-token', 'Content-Type': 'application/json', 'If-Match': '7' },
                body: expect.any(String),
            });
            expect(JSON.parse(fetchMock.mock.lastCall![1]!.body as string)).toEqual(patch);
        }
    });

    it('returns read-only structured output, including null and false', async () => {
        for (const output of [{ message: 'hello', items: [1, null, false] }, null, false]) {
            const card = { id: 'producer', type: 'ai', outputType: schemaId, output, revision: 4 };
            fetchMock.mockResolvedValueOnce(Response.json(card));
            const result = await client.callTool({ name: 'board_get_card', arguments: { handle: 'major', id: 'producer' } });
            expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(card) }] });
        }
    });

    it('forwards gateway branches and explicit unlink requests', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_patch_card', arguments: {
            handle: 'major', id: 'gateway', patch: { onSuccess: { flowNodes: ['left', 'right'] } },
        } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ onSuccess: { flowNodes: ['left', 'right'] } });

        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_chain_card', arguments: { handle: 'major', id: 'gateway', flowNode: '' } });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ flowNode: '' });
    });

    it.each([
        ['board_add_cards', { handle: 'major', flowNodes: [{ type: 'ai', output: { message: 'forged' } }] }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { output: { message: 'forged' }, body: 'Keep' } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { output_type: schemaId, body: 'Keep' } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { settings: { ...settings, effrot: 'max' } } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { onSuccess: { flow_node: 'next', mode: 'continue' } } }],
        ['board_add_cards', { handle: 'major', flowNodes: [{ type: 'ai', criteria: [{ text: 'Done', checked: true }] }] }],
        ['class_patch', { handle: 'major', id: 'class', patch: { outputType: schemaId, title: 'Keep' } }],
    ])('rejects unknown or read-only fields in %s before any HTTP write', async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['gateway', 'note', 'value'])('rejects unsupported %s node classes', async (type) => {
        const created = await client.callTool({ name: 'class_create', arguments: { handle: 'major', title: 'Class', type } });
        const patched = await client.callTool({ name: 'class_patch', arguments: { handle: 'major', id: 'class', patch: { type } } });
        expect(created.isError).toBe(true);
        expect(patched.isError).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['board_chain_card', { handle: 'major', id: 'source', flowNode: 'occupied' }],
        ['board_patch_card', { handle: 'major', id: 'source', patch: { onSuccess: { flowNode: 'occupied' } } }],
        ['board_add_cards', { handle: 'major', flowNodes: [{ type: 'ai', onSuccess: { flowNode: 'occupied' } }] }],
    ])('carries connection refusals from %s back to the model', async (name, args) => {
        const reason = 'card "Review" can have only one predecessor; use a gateway to join branches';
        fetchMock.mockResolvedValueOnce(Response.json({ error: reason }, { status: 400 }));

        const result = await client.callTool({ name, arguments: args });

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining(reason) }]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
