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
    const workflowId = '00000000-0000-0000-0000-000000000004';
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

    it('copies and pastes the workflow clipboard through the board proxy', async () => {
        const values = { phase: { steps: [false, null] }, ['__proto__']: 'a shared value' };
        const clipboard = {
            kind: 'kiao-workflow', version: 1, workflow: { name: 'Review', values },
            flowNodes: [
                { id: producerId, type: 'ai', onSuccess: { flowNode: consumerId },
                    settings: { ...settings, harness: 'pi', profileId: 'profile' }, size: { w: 240, h: 200 } },
                { id: consumerId, type: 'human', body: 'Read {{input}}.' },
            ],
        };
        const created = { workflow: { id: 'second-workflow', name: 'Review', values }, flowNodes: [] };
        fetchMock.mockResolvedValueOnce(Response.json(clipboard)).mockResolvedValueOnce(Response.json(created, { status: 201 }));

        const copied = await client.callTool({ name: 'workflow_copy', arguments: { handle: 'source', id: 'first-workflow' } });
        const spot = { x: 100, y: 40 };
        const pasted = await client.callTool({ name: 'workflow_paste', arguments: { handle: 'target', clipboard, spot } });

        expect(copied).toEqual({ content: [{ type: 'text', text: JSON.stringify(clipboard) }] });
        expect(pasted).toEqual({ content: [{ type: 'text', text: JSON.stringify(created) }] });
        expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
            ['http://worker.test/hybridflow-runner/boards/source/workflows/first-workflow/clipboard', 'GET'],
            ['http://worker.test/hybridflow-runner/boards/target/workflows/clipboard', 'POST'],
        ]);
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ clipboard, spot });
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
                id: producerId, title: 'Write', type: 'ai', outputType: schemaId, settings, workflow: workflowId,
                body: 'Write the result.\n```currentWokflow.message\nReady for review\n```',
                onSuccess: { flowNode: consumerId, mode: 'end', compact: false },
            },
            {
                id: consumerId, title: 'Review', type: 'ai', settings, workflow: workflowId,
                body: 'Review {{input.message}} and {{input.items.0}}. Status is {{currentWokflow.message}}.',
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

    it('returns saved workflow values in workflow and board reads', async () => {
        const workflow = {
            id: workflowId, name: 'Review', revision: 4,
            values: { message: 'Ready for review', verdict: { approved: false, revisions: [null, 0] } },
        };
        const board = { workflows: [workflow], flowNodes: [{ id: consumerId, workflow: workflowId }] };
        fetchMock.mockResolvedValueOnce(Response.json(workflow)).mockResolvedValueOnce(Response.json(board));

        const readWorkflow = await client.callTool({ name: 'workflow_get', arguments: { handle: 'major', id: workflowId } });
        const readBoard = await client.callTool({ name: 'board_get', arguments: { handle: 'major' } });

        expect(readWorkflow).toEqual({ content: [{ type: 'text', text: JSON.stringify(workflow) }] });
        expect(readBoard).toEqual({ content: [{ type: 'text', text: JSON.stringify(board) }] });
        expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
            [`http://worker.test/hybridflow-runner/boards/major/workflows/${workflowId}`, 'GET'],
            ['http://worker.test/hybridflow-runner/boards/major', 'GET'],
        ]);
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

    it('forwards a Start event and its successor', async () => {
        const flowNodes = [{ type: 'start', onSuccess: { flowNode: consumerId } }];
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });
    });

    it('forwards exclusive gateway routes in order', async () => {
        const routes = [{ condition: 'input.approved && currentWokflow.verdict.approved', flowNode: 'left' },
            { condition: 'true', flowNode: 'right' }];
        const flowNodes = [{ type: 'exclusive-gateway', workflow: workflowId, onSuccess: { flowNodes: ['left', 'right'] }, routes }];
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });

        const patch = { routes: [...routes].reverse() };
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_patch_card', arguments: { handle: 'major', id: 'gateway', patch } });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual(patch);
    });

    it('sets the limiter maximum and branches and can reset its counter', async () => {
        const flowNodes = [{ type: 'limiter', maxPasses: 0, onSuccess: { flowNodes: ['left', 'right'] } }];
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });

        const patch = { resetPasses: true };
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_patch_card', arguments: { handle: 'major', id: 'limiter', patch } });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual(patch);
    });

    it.each([
        [{ type: 'bitbucket-pr-status', pullRequestId: 'workspace/repo#42', pullRequestStatus: 'MERGED' },
            { pullRequestStatus: '' }],
        [{ type: 'bitbucket-commit-status', commitId: 'workspace/repo@a1b2c3d', commitStatus: 'SUCCESSFUL' },
            { commitStatus: '' }],
        [{ type: 'bitbucket-pr-status', pullRequestId: '{{input.pullRequestId}}', pullRequestStatus: '{{input.targetStatus}}' },
            { pullRequestId: 'workspace/repo#{{input.pullRequestId}}' }],
        [{ type: 'bitbucket-commit-status', commitId: '{{currentWorkflow.commitId}}', commitStatus: '{{currentWorkflow.targetStatus}}' },
            { commitStatus: '{{ role.build-status }}' }],
    ])('creates and edits Bitbucket wait cards (%j)', async (card, patch) => {
        const flowNodes = [card];
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });

        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_patch_card', arguments: { handle: 'major', id: 'wait', patch } });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual(patch);
    });

    it('creates a role with a description and edits its fields', async () => {
        const flowNodes = [{
            type: 'role', title: 'Reviewers', roleId: 'reviewers', people: ['Alex Rivera', 'Sam Lee'],
            description: 'Review changes before release.',
        }];
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_add_cards', arguments: { handle: 'major', flowNodes } });
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ flowNodes });

        const patch = { roleId: 'editors', people: [], description: '' };
        fetchMock.mockResolvedValueOnce(Response.json({}));
        await client.callTool({ name: 'board_patch_card', arguments: { handle: 'major', id: 'reviewers', patch } });
        expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual(patch);
    });

    it.each([
        ['board_add_cards', { handle: 'major', flowNodes: [{ type: 'ai', output: { message: 'forged' } }] }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { output: { message: 'forged' }, body: 'Keep' } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { output_type: schemaId, body: 'Keep' } }],
        ['board_patch_card', { handle: 'major', id: 'limiter', patch: { remainingPasses: 3 } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { settings: { ...settings, effrot: 'max' } } }],
        ['board_patch_card', { handle: 'major', id: 'card', patch: { onSuccess: { flow_node: 'next', mode: 'continue' } } }],
        ['board_add_cards', { handle: 'major', flowNodes: [{ type: 'ai', criteria: [{ text: 'Done', checked: true }] }] }],
    ])('rejects unknown or read-only fields in %s before any HTTP write', async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
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
