/**
 * Every archived card, as a spreadsheet: one row per flow node put away on any board, with what
 * played it and what it spent.
 *
 * Archived cards are hidden everywhere — the board never draws them — so this is the one place
 * they are still read: a `.csv` download from the boards list. The columns are the card's title,
 * the agent that played it and that agent's model, the effort it was played with, the sums of the
 * usage reports its turns filed, the class it was made from, and its complexity. A board column
 * says where each row was put away, since the export spans every board, archived ones included.
 *
 * An empty consumption cell means unknown, not zero: a usage read that failed is left blank
 * rather than refusing the whole export, while a card whose turns filed nothing reads `0`. The
 * cost is in dollars, converted from the millionths the usage reports file.
 */

import { isAgentId } from './flowNodeSettings';
import type {
    AgentDto, FlowNodeDto, FlowNodeUsageTotalsDto, HybridflowClient,
} from './service';

export const ARCHIVED_FLOW_NODES_CSV_FILENAME = 'archived-flow-nodes.csv';

/** One row's answers: the card, where it was put away, and what the export resolves around it. */
export interface ArchivedFlowNodeCsvRow {
    boardName: string;
    flowNode: FlowNodeDto;
    /** Every managed agent: what `settings.agent` resolves through for the name and the model. */
    agents: AgentDto[];
    /** The card's usage sums, or null where the read failed — left blank, never zeroed. */
    usage: FlowNodeUsageTotalsDto | null;
}

const HEADER = [
    'board', 'title', 'agent', 'model', 'effort',
    'reports', 'input_tokens', 'output_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'cost_usd',
    'node_class', 'complexity',
];

/** The rows as `.csv` text: the header, then one line per card. */
export const archivedFlowNodesCsv = (rows: ArchivedFlowNodeCsvRow[]): string =>
    [HEADER.join(','), ...rows.map(csvRow)].join('\n') + '\n';

/**
 * Reads every board — archived ones included — and every archived card on them, with the usage
 * sums of each. Ordered by board name, then card title, so the file reads the same way twice.
 */
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
    // Each card's sums, read beside the others: one refusal blanks that card's cells rather than
    // refusing the export — a consumption left blank says unknown, while a board left out would
    // say nothing at all.
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

/**
 * Who played the card, as two columns: the agent's name, and its model. A managed id resolves
 * through the list; a legacy engine name travels as-is; an id the store no longer holds says
 * nothing — and the legacy model beside it is read only where no managed agent answered.
 */
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

/** Millionths of a dollar, as dollars: `2.5`, down to the micro — empty where no report priced itself. */
const costOf = (usage: FlowNodeUsageTotalsDto | null): string | number =>
    usage?.costUsdMicros === undefined ? '' : usage.costUsdMicros / 1_000_000;

/** One cell, quoted where it must be: a comma, a quote or a line break quotes it, a quote doubles. */
const cell = (value: string | number): string => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
