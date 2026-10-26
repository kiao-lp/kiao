import { describe, it, expect } from 'vitest';

/**
 * Every archived card as a spreadsheet row: the card's title, the agent that played it and that
 * agent's model, the effort it was played with, the sums of the usage reports its turns filed,
 * the class it was made from, and its complexity — with the board each row was put away on,
 * since the export spans every board.
 */
import {
    ARCHIVED_FLOW_NODES_CSV_FILENAME, archivedFlowNodesCsv, fetchArchivedFlowNodesCsv,
} from './archivedFlowNodesCsv';
import { FakeHybridflowClient, HybridflowClient } from './service';
import type { AgentDto, FlowNodeDto, FlowNodeUsageTotalsDto } from './service';
import { boardOf, boardNamed } from './test/fixtures';
import { newFlowNode } from './boardContent';

const flowNode = (over: Partial<FlowNodeDto> & { id: string }): FlowNodeDto => ({
    title: `card ${over.id}`, type: 'ai', status: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    ...over,
});

const agent = (over: Partial<AgentDto> & { id: string }): AgentDto => ({
    name: `agent ${over.id}`, platform: 'muse',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    ...over,
});

const usage = (over: Partial<FlowNodeUsageTotalsDto> = {}): FlowNodeUsageTotalsDto => ({
    reports: 2, inputTokens: 12380, outputTokens: 4210,
    cacheReadTokens: 8000, cacheWriteTokens: 1200, reasoningTokens: 900,
    costUsdMicros: 2_500_000,
    ...over,
});

describe('archivedFlowNodesCsv', () => {
    it('names the file after what it holds', () => {
        expect(ARCHIVED_FLOW_NODES_CSV_FILENAME).toBe('archived-flow-nodes.csv');
    });

    it('writes one row per archived card, with what played it and what it spent', () => {
        const text = archivedFlowNodesCsv([{
            boardName: 'Major',
            flowNode: flowNode({
                id: 'card-1', title: 'First', archived: true, complexity: 5,
                settings: { agent: 'agent-1', effort: 'high' },
                classVersion: {
                    classId: 'class-1', classTitle: 'First class',
                    versionId: 'version-1', versionNumber: 1,
                },
            }),
            agents: [agent({ id: 'agent-1', name: 'Scribe', model: 'muse-spark' })],
            usage: usage(),
        }]);

        const [header, row] = text.trim().split('\n');
        expect(header).toBe('board,title,agent,model,effort,reports,input_tokens,output_tokens,'
            + 'cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,node_class,complexity');
        expect(row).toBe('Major,First,Scribe,muse-spark,high,2,12380,4210,8000,1200,900,2.5,'
            + 'First class,5');
    });

    it('quotes what a comma, a quote or a line break would otherwise split', () => {
        const text = archivedFlowNodesCsv([{
            boardName: 'Major, the "first"\nboard',
            flowNode: flowNode({ id: 'card-1', title: 'Do it, "well"\nplease', archived: true }),
            agents: [],
            usage: usage({ costUsdMicros: undefined }),
        }]);

        // The row carries its own line breaks inside its quotes, so the whole text is
        // asserted rather than split into lines.
        expect(text).toBe('board,title,agent,model,effort,reports,input_tokens,output_tokens,'
            + 'cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,node_class,'
            + 'complexity\n"Major, the ""first""\nboard","Do it, ""well""\nplease",,,,2,12380,4210,'
            + '8000,1200,900,,,\n');
    });

    it('leaves the consumption cells blank where the usage could not be read', () => {
        const text = archivedFlowNodesCsv([{
            boardName: 'Major',
            flowNode: flowNode({ id: 'card-1', title: 'First', archived: true }),
            agents: [],
            usage: null,
        }]);

        const [, row] = text.trim().split('\n');
        expect(row).toBe('Major,First,,,,,,,,,,,,');
    });

    it('keeps a legacy engine name and model where no managed agent answers', () => {
        const text = archivedFlowNodesCsv([{
            boardName: 'Major',
            flowNode: flowNode({
                id: 'card-1', title: 'First', archived: true,
                settings: { agent: 'Muse', model: 'opus', effort: 'max' },
            }),
            agents: [agent({ id: 'agent-1', name: 'Scribe', model: 'muse-spark' })],
            usage: usage({ reports: 0, inputTokens: 0, outputTokens: 0 }),
        }]);

        const [, row] = text.trim().split('\n');
        expect(row.split(',').slice(2, 5)).toEqual(['Muse', 'opus', 'max']);
    });

    it('says nothing for an agent id the store no longer holds', () => {
        const text = archivedFlowNodesCsv([{
            boardName: 'Major',
            flowNode: flowNode({
                id: 'card-1', title: 'First', archived: true,
                settings: { agent: '00000000-0000-4000-8000-000000000001' },
            }),
            agents: [],
            usage: usage({ reports: 0, inputTokens: 0, outputTokens: 0 }),
        }]);

        const [, row] = text.trim().split('\n');
        expect(row.split(',').slice(2, 4)).toEqual(['', '']);
    });
});

describe('fetchArchivedFlowNodesCsv', () => {
    it('reads the archived cards of every board, live cards left out', async () => {
        const kept = newFlowNode('Live');
        const away = { ...newFlowNode('Away'), archived: true };
        const service = new FakeHybridflowClient(boardOf([kept, away]));
        service.boardsList = [
            { ...service.summary, id: 'id-minor', name: 'Minor', slug: 'minor' },
            { ...service.summary, id: 'id-major', name: 'Major', slug: 'major' },
        ];
        service.agentsList = [agent({ id: 'agent-1', name: 'Scribe', model: 'muse-spark' })];
        away.settings = { agent: 'agent-1', effort: 'high' };
        service.usageTotalsByFlowNode = { [away.id]: usage() };

        const { text, flowNodes } = await fetchArchivedFlowNodesCsv(service.asClient());

        // The fake answers every board with the same content, so the one archived card reads
        // once per board — ordered by board name, the live card nowhere.
        expect(flowNodes).toBe(2);
        expect(text).toContain('Major,Away,Scribe,muse-spark,high,2,12380,4210,8000,1200,900,2.5,,');
        expect(text).toContain('Minor,Away,Scribe,muse-spark,high,2,12380,4210,8000,1200,900,2.5,,');
        expect(text).not.toContain('Live');
        expect(service.calls).toContain('boards');
        expect(service.calls).toContain('board major');
        expect(service.calls).toContain('board minor');
    });

    it('leaves a card blank where its usage refuses, and still exports the rest', async () => {
        const failing = {
            boards: async () => [{ name: 'Major', slug: 'major' }],
            agents: async () => [],
            board: async () => ({
                flowNodes: [
                    flowNode({ id: 'card-1', title: 'First', archived: true }),
                    flowNode({ id: 'card-2', title: 'Second', archived: true }),
                ],
            }),
            flowNodeUsageTotals: async (_handle: string, id: string) => {
                if (id === 'card-1') throw new Error('gone');
                return usage();
            },
        } as unknown as HybridflowClient;

        const { text, flowNodes } = await fetchArchivedFlowNodesCsv(failing);

        expect(flowNodes).toBe(2);
        const [, first, second] = text.trim().split('\n');
        expect(first).toBe('Major,First,,,,,,,,,,,,');
        expect(second).toBe(
            'Major,Second,,,,2,12380,4210,8000,1200,900,2.5,,');
    });

    it('says zero where no board holds an archived card', async () => {
        const service = new FakeHybridflowClient(boardNamed('Live'));

        const { text, flowNodes } = await fetchArchivedFlowNodesCsv(service.asClient());

        expect(flowNodes).toBe(0);
        expect(text.trim().split('\n')).toHaveLength(1);
    });
});
