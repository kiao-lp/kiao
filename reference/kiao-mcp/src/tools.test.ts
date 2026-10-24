import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFileTools } from './tools-files.js';
import { registerHybridflowTools } from './tools-hybridflow.js';
import { ok } from './tools-common.js';
import type { WorkerClient } from './files.js';
import type { HybridflowApi } from './hybridflow/api.js';

// Records the tool names a registrar passes to registerTool — the handlers are never invoked,
// so the file/hybridflow dependencies can be empty stubs. Guards the kiao-files /
// kiao-hybridflow split: the two servers must expose disjoint, predictable tool sets.
// (Servers in other packages pin their own sets there.)
const recordToolNames = (register: (server: McpServer) => void): string[] => {
    const names: string[] = [];
    const server = { registerTool: (name: string) => { names.push(name); } } as unknown as McpServer;
    register(server);
    return names;
};

describe('tool registrars', () => {
    const fileTools = recordToolNames((s) => registerFileTools(s, {} as WorkerClient));
    const boardTools = recordToolNames((s) => registerHybridflowTools(s, {} as HybridflowApi));

    it('registerFileTools exposes only files_* / git_* tools', () => {
        expect(fileTools.every((n) => n.startsWith('files_') || n.startsWith('git_'))).toBe(true);
        expect(fileTools).toContain('files_read');
        expect(fileTools).toContain('files_edit');
        expect(fileTools).toContain('git_commit');
        expect(fileTools).toContain('files_delete_batch');
        expect(fileTools).toHaveLength(17);
    });

    it('registerHybridflowTools exposes the hybridflow families', () => {
        const families = ['board_', 'workflow_', 'workflow_class_', 'class_', 'agent_', 'runner_', 'hybridflow_'];
        expect(boardTools.every((n) => families.some((prefix) => n.startsWith(prefix)))).toBe(true);
        expect(boardTools).toEqual(
            expect.arrayContaining([
                'board_list', 'board_create', 'board_get', 'board_patch', 'board_delete',
                'board_add_cards', 'board_get_card', 'board_patch_card', 'board_delete_cards',
                'board_chain_card', 'board_card_usage', 'board_card_to_class', 'board_changes',
                'workflow_create', 'workflow_get', 'workflow_patch', 'workflow_delete',
                'workflow_class_list', 'workflow_class_create', 'workflow_class_get',
                'workflow_class_patch', 'workflow_class_delete', 'workflow_class_instantiate',
                'class_list', 'class_create', 'class_get', 'class_patch', 'class_delete',
                'class_chain', 'class_create_version', 'class_patch_version',
                'class_delete_version', 'class_instantiate',
                'agent_list', 'agent_create', 'agent_get', 'agent_patch', 'agent_delete', 'agent_publish', 'agent_versions',
                'runner_list', 'runner_create', 'runner_get', 'runner_patch', 'runner_delete',
                'hybridflow_schema',
            ]),
        );
        // Playing a card is the runner's alone: no tool here reaches play, played, settle, the
        // usage report a turn files, or the heartbeat a runner stamps.
        for (const forbidden of ['board_play', 'board_played', 'board_settle', 'board_record_usage', 'runner_heartbeat']) {
            expect(boardTools).not.toContain(forbidden);
        }
        expect(boardTools).toHaveLength(46);
    });

    it('the two tool sets are disjoint and free of duplicates', () => {
        expect(new Set(fileTools).size).toBe(fileTools.length);
        expect(new Set(boardTools).size).toBe(boardTools.length);
        const all = [...fileTools, ...boardTools];
        expect(new Set(all).size).toBe(all.length);
    });
});

// A tool result is read by a model and by nothing else, and the tool list it belongs to is
// re-sent on every request of a turn. Both of the economies that follow from that are easy to
// undo by accident, so both are pinned here.
describe('token economy', () => {
    it('serializes a tool result compact, without indentation', () => {
        const text = ok({ a: 1, b: [{ c: 'x' }] }).content[0].text;
        expect(text).toBe('{"a":1,"b":[{"c":"x"}]}');
        expect(text).not.toContain('\n');
    });

    it('passes a string result through untouched', () => {
        expect(ok('already text').content[0].text).toBe('already text');
    });
});


describe('agent tools', () => {
    it('accepts and forwards selection descriptions separately from instructions', async () => {
        const registered = new Map<string, { config: { inputSchema: z.ZodRawShape }; handler: (input: unknown) => Promise<unknown> }>();
        const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: (input: unknown) => Promise<unknown>) => {
            registered.set(name, { config, handler });
        } } as unknown as McpServer;
        const api = {
            createAgent: vi.fn().mockResolvedValue({}), patchAgent: vi.fn().mockResolvedValue({}),
            publishAgent: vi.fn().mockResolvedValue({}), agentVersions: vi.fn().mockResolvedValue({ versions: [] }),
            listAgents: vi.fn().mockResolvedValue({ agents: [] }),
        };
        registerHybridflowTools(server, api as unknown as HybridflowApi);

        const agent = { name: 'Reviewer', platform: 'pi', profileId: 'shared-profile', model: 'openai/shared', description: 'Review code.', instructions: 'Be concise.' };
        const create = registered.get('agent_create')!;
        await create.handler(z.object(create.config.inputSchema).parse(agent));
        expect(api.createAgent).toHaveBeenCalledWith(agent);

        const patch = registered.get('agent_patch')!;
        await patch.handler(z.object(patch.config.inputSchema).parse({ id: 'reviewer', patch: { archived: true } }));
        expect(api.patchAgent).toHaveBeenLastCalledWith('reviewer', { archived: true }, undefined);
        const publish = registered.get('agent_publish')!;
        await publish.handler(z.object(publish.config.inputSchema).parse({ id: 'reviewer', ifMatch: 3 }));
        expect(api.publishAgent).toHaveBeenCalledWith('reviewer', 3);
        await registered.get('agent_versions')!.handler({ id: 'reviewer' });
        expect(api.agentVersions).toHaveBeenCalledWith('reviewer');
        await registered.get('agent_list')!.handler({ archived: true });
        expect(api.listAgents).toHaveBeenCalledWith(true);
        await patch.handler(z.object(patch.config.inputSchema).parse({id:'reviewer',patch:{profileId:'another-profile'}}));
        expect(api.patchAgent).toHaveBeenLastCalledWith('reviewer',{profileId:'another-profile'},undefined);
        for (const description of ['Review Go code.', '']) {
            await patch.handler(z.object(patch.config.inputSchema).parse({ id: 'reviewer', patch: { description } }));
            expect(api.patchAgent).toHaveBeenLastCalledWith('reviewer', { description }, undefined);
        }
    });
});

describe('scheduler tools', () => {
    it('accepts and forwards duration on card and class creation and patches', async () => {
        const registered = new Map<string, { config: { inputSchema: z.ZodRawShape }; handler: (input: unknown) => Promise<unknown> }>();
        const server = { registerTool: (name: string, config: { inputSchema: z.ZodRawShape }, handler: (input: unknown) => Promise<unknown>) => {
            registered.set(name, { config, handler });
        } } as unknown as McpServer;
        const api = {
            createFlowNodes: vi.fn().mockResolvedValue([]), patchFlowNode: vi.fn().mockResolvedValue({}),
            createFlowNodeClass: vi.fn().mockResolvedValue({}), patchFlowNodeClass: vi.fn().mockResolvedValue({}),
        };
        registerHybridflowTools(server, api as unknown as HybridflowApi);
        for (const [name, input, method] of [
            ['board_add_cards', { handle: 'major', flowNodes: [{ title: 'Wait', type: 'scheduler', duration: '15m' }] }, 'createFlowNodes'],
            ['board_patch_card', { handle: 'major', id: 'card', patch: { duration: '30s' } }, 'patchFlowNode'],
            ['class_create', { handle: 'major', title: 'Wait', type: 'scheduler', duration: '1h' }, 'createFlowNodeClass'],
            ['class_patch', { handle: 'major', id: 'class', patch: { duration: '2h' } }, 'patchFlowNodeClass'],
        ] as const) {
            const tool = registered.get(name)!;
            const parsed = z.object(tool.config.inputSchema).parse(input);
            await tool.handler(parsed);
            const args = api[method].mock.calls[0];
            expect(JSON.stringify(args)).toContain('"duration"');
        }
    });
});
