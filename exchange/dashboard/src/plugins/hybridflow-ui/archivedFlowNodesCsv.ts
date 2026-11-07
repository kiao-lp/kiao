/** CSV of archived cards across all boards. */

import { isAgentId } from './flowNodeSettings';
import type {
    AgentDto, FlowNodeDto, FlowNodeUsageTotalsDto, HybridflowClient,
} from './service';

export const ARCHIVED_FLOW_NODES_CSV_FILENAME = 'archived-flow-nodes.csv';

export interface ArchivedFlowNodeCsvRow {
    boardName: string;
    flowNode: FlowNodeDto;
    agents: AgentDto[];
    usage: FlowNodeUsageTotalsDto | null;
}

const HEADER = [
    'board', 'title', 'agent', 'model', 'effort',
    'reports', 'input_tokens', 'output_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'cost_usd',
    'node_class', 'complexity',
];

export const archivedFlowNodesCsv = (rows: ArchivedFlowNodeCsvRow[]): string =>
    [HEADER.join(','), ...rows.map(csvRow)].join('\n') + '\n';

/** Reads all boards including archived ones. */
export const fetchArchivedFlowNodesCsv = async (
    client: HybridflowClient,
): Promise<{ text: string; flowNodes: number }> => {
    const [boards, agents] = await Promise.all([client.boards(true), client.agents()]);
    const details = await Promise.all(boards.map(async board => ({
        board, detail: await client.board(board.slug),
    })));
    const archived = details.flatMap(({ board, detail }) => detail.flowNodes
        .filter(flowNode => flowNode.archived)
        .map(flowNode => ({ board, flowNode })));
    archived.sort((left, right) => left.board.name.localeCompare(right.board.name)
        || left.flowNode.title.localeCompare(right.flowNode.title));
    const usages = await Promise.all(archived.map(({ board, flowNode }) =>
        client.flowNodeUsageTotals(board.slug, flowNode.id).then(
            usage => usage,
            () => null,
        )));
    const rows = archived.map(({ board, flowNode }, at) => ({
        boardName: board.name, flowNode, agents, usage: usages[at],
    }));
    return { text: archivedFlowNodesCsv(rows), flowNodes: rows.length };
};

const csvRow = (row: ArchivedFlowNodeCsvRow): string => {
    const { flowNode, usage } = row;
    const { agent, model } = agentOf(flowNode, row.agents);
    return [
        row.boardName,
        flowNode.title,
        agent,
        model,
        flowNode.settings?.effort?.trim() ?? '',
        count(usage?.reports),
        count(usage?.inputTokens),
        count(usage?.outputTokens),
        count(usage?.cacheReadTokens),
        count(usage?.cacheWriteTokens),
        count(usage?.reasoningTokens),
        costOf(usage),
        flowNode.classVersion?.classTitle ?? '',
        flowNode.complexity ?? '',
    ].map(cell).join(',');
};

/** Resolves a managed id to name and model. */
const agentOf = (
    flowNode: FlowNodeDto, agents: AgentDto[],
): { agent: string; model: string } => {
    const ref = flowNode.settings?.agent?.trim() ?? '';
    const held = ref ? agents.find(agent => agent.id === ref) : undefined;
    if (held) return { agent: held.name, model: held.model ?? '' };
    return {
        agent: ref && !isAgentId(ref) ? ref : '',
        model: flowNode.settings?.model?.trim() ?? '',
    };
};

const count = (value: number | undefined): string | number =>
    value === undefined ? '' : value;

const costOf = (usage: FlowNodeUsageTotalsDto | null): string | number =>
    usage?.costUsdMicros === undefined ? '' : usage.costUsdMicros / 1_000_000;

const cell = (value: string | number): string => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
