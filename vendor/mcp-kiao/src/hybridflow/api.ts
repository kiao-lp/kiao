import type { WorkerClient } from '../files.js';
import type {
    AgentReleaseBump,
    BoardSchemaValue,
    Board,
    BoardAgent,
    BoardAgentPatch,
    BoardChanges,
    BoardFlowNode,
    BoardFlowNodePatch,
    BoardPatch,
    BoardRunner,
    BoardRunnerPatch,
    BoardSpot,
    BoardUsageTotals,
    BoardWhole,
    BoardWorkflow,
    BoardWorkflowClipboard,
    BoardWorkflowPatch,
    BoardWorkflowWithFlowNodes,
    NewBoardAgent,
    NewBoardFlowNode,
    NewBoardRunner,
    NewBoardWorkflow,
} from './model.js';

/**
 * High-level operations over the boards, layered on the files client. Thin on purpose:
 * a board is a row in the hybridflow-store, and worker proxies
 * these calls to it, so validation lives there and its refusals cross untouched. What is
 * checked here is only what is not worth a round trip — an empty name, an empty id list, a
 * patch naming nothing.
 *
 * play, played, settle, the usage report and the runner heartbeat are the runner's alone: no
 * method here reaches them.
 */
export class HybridflowApi {
    constructor(private readonly files: WorkerClient) {}

    /** Every board — names and handles, nothing on them. */
    async listBoards(archived = false): Promise<{ boards: Board[] }> {
        return this.files.listBoards(archived);
    }

    listSchemaValues(): Promise<{ schemaValues: BoardSchemaValue[] }> {
        return this.files.listSchemaValues();
    }

    /** Create a board. Answers it whole — its handle among it, which the card tools take. */
    async createBoard(name: string): Promise<BoardWhole> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Board name must not be empty.');
        return this.files.createBoard(trimmed);
    }

    /** Read one board whole — its cards and workflows — and the cursor it was read at. */
    async getBoard(handle: string): Promise<BoardWhole> {
        return this.files.getBoard(HybridflowApi.handle(handle));
    }

    /** Rename a board, archive or unarchive it. */
    async patchBoard(handle: string, patch: BoardPatch, ifMatch?: number): Promise<Board> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('board_patch names the fields it changes — send at least one.');
        }
        return this.files.patchBoard(HybridflowApi.handle(handle), patch, ifMatch);
    }

    /** Delete a board and everything on it. There is no undo. */
    async deleteBoard(handle: string): Promise<{ deleted: string }> {
        const trimmed = HybridflowApi.handle(handle);
        await this.files.deleteBoard(trimmed);
        return { deleted: trimmed };
    }

    /**
     * Add one or more cards to a board, in the order given — which is what a paste is. Returns
     * the cards with the ids they were given.
     */
    async createFlowNodes(handle: string, flowNodes: NewBoardFlowNode[]): Promise<{ flowNodes: BoardFlowNode[] }> {
        const trimmed = HybridflowApi.handle(handle);
        if (!Array.isArray(flowNodes) || flowNodes.length === 0) {
            throw new Error('board_add_cards needs at least one card.');
        }
        return this.files.createFlowNodes(trimmed, flowNodes);
    }

    /** Read one card. */
    async getFlowNode(handle: string, id: string): Promise<BoardFlowNode> {
        return this.files.getFlowNode(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Card'));
    }

    /**
     * Change the named fields of one card and nothing else. `ifMatch` is the revision board_get
     * reported — the write lands on it or comes back 409.
     */
    async patchFlowNode(
        handle: string,
        id: string,
        patch: BoardFlowNodePatch,
        ifMatch?: number,
    ): Promise<BoardFlowNode> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('board_patch_card names the fields it changes — send at least one.');
        }
        return this.files.patchFlowNode(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Card'), patch, ifMatch,
        );
    }

    /** Remove cards and their incoming links. Task output schema references retain missing ids. */
    async deleteFlowNodes(handle: string, flowNodes: string[]): Promise<{ deleted: string[] }> {
        const ids = HybridflowApi.ids(flowNodes, 'board_delete_cards needs at least one card id.');
        await this.files.deleteFlowNodes(HybridflowApi.handle(handle), ids);
        return { deleted: ids };
    }

    /** Link a card to the one played after it; an empty target takes the link off. */
    async chainFlowNode(handle: string, id: string, flowNode: string): Promise<BoardFlowNode> {
        return this.files.chainFlowNode(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Card'), flowNode.trim(),
        );
    }

    /** What one card spent, whole: the sums of its reports. */
    async getFlowNodeUsage(handle: string, id: string): Promise<BoardUsageTotals> {
        return this.files.getFlowNodeUsage(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Card'));
    }

    /** File a workflow on a board and group its cards in it. */
    async createWorkflow(handle: string, workflow: NewBoardWorkflow): Promise<BoardWorkflow> {
        return this.files.createWorkflow(HybridflowApi.handle(handle), workflow);
    }

    /** Read one workflow. */
    async getWorkflow(handle: string, id: string): Promise<BoardWorkflow> {
        return this.files.getWorkflow(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow'));
    }

    async copyWorkflow(handle: string, id: string): Promise<BoardWorkflowClipboard> {
        return this.files.copyWorkflow(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow'));
    }

    async pasteWorkflow(handle: string, clipboard: BoardWorkflowClipboard, spot?: BoardSpot): Promise<BoardWorkflowWithFlowNodes> {
        return this.files.pasteWorkflow(HybridflowApi.handle(handle), clipboard, spot);
    }

    /** Rename a workflow. Its members are untouched. */
    async patchWorkflow(
        handle: string, id: string, patch: BoardWorkflowPatch, ifMatch?: number,
    ): Promise<BoardWorkflow> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('workflow_patch names the fields it changes — send at least one.');
        }
        return this.files.patchWorkflow(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow'), patch, ifMatch,
        );
    }

    /** Remove workflows. Their cards are ungrouped and left where they are. */
    async deleteWorkflows(handle: string, workflows: string[]): Promise<{ deleted: string[] }> {
        const ids = HybridflowApi.ids(workflows, 'workflow_delete needs at least one workflow id.');
        await this.files.deleteWorkflows(HybridflowApi.handle(handle), ids);
        return { deleted: ids };
    }

    /** Every managed agent, by name. Read before naming one on a card. */
    async listAgents(): Promise<{ agents: BoardAgent[] }> {
        return this.files.listAgents();
    }

    /** File a managed agent. The name must be free. */
    async createAgent(agent: NewBoardAgent): Promise<BoardAgent> {
        if (agent.repository?.trim()) return this.files.createAgent({ repository: agent.repository.trim() });
        const name = agent.name?.trim();
        if (!name) throw new Error('An agent needs a name.');
        const harness = agent.harness?.trim();
        if (!harness) throw new Error('An agent needs a harness: claude, codex, muse or pi.');
        return this.files.createAgent({ ...agent, name, harness });
    }

    /** Read one managed agent. */
    async getAgent(id: string): Promise<BoardAgent> {
        return this.files.getAgent(HybridflowApi.id(id, 'Agent'));
    }

    async publishAgent(id: string, ifMatch?: number, confirmation?: string, bump?: AgentReleaseBump) {
        return this.files.publishAgent(HybridflowApi.id(id, 'Agent'), ifMatch, confirmation, bump);
    }

    async agentVersions(id: string) {
        return this.files.agentVersions(HybridflowApi.id(id, 'Agent'));
    }

    /** Change the fields the patch names, and no others. */
    async patchAgent(id: string, patch: BoardAgentPatch, ifMatch?: number): Promise<BoardAgent> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('agent_patch names the fields it changes — send at least one.');
        }
        return this.files.patchAgent(HybridflowApi.id(id, 'Agent'), patch, ifMatch);
    }

    /** Delete a managed agent. The flow nodes naming it keep naming it until they name another. */
    async deleteAgent(id: string, confirmation?: string) {
        const trimmed = HybridflowApi.id(id, 'Agent');
        if (!confirmation) return { id: trimmed, deletion: await this.files.agentDeletionStatus(trimmed) };
        await this.files.deleteAgent(trimmed, confirmation);
        return { deleted: trimmed };
    }

    /** Every runner. */
    async listRunners(): Promise<{ runners: BoardRunner[] }> {
        return this.files.listRunners();
    }

    /** File a runner. */
    async createRunner(runner: NewBoardRunner): Promise<BoardRunner> {
        const name = runner.name?.trim();
        if (!name) throw new Error('A runner needs a name.');
        return this.files.createRunner({ name });
    }

    /** Read one runner. */
    async getRunner(id: string): Promise<BoardRunner> {
        return this.files.getRunner(HybridflowApi.id(id, 'Runner'));
    }

    /** Change the fields the patch names, and no others. */
    async patchRunner(id: string, patch: BoardRunnerPatch, ifMatch?: number): Promise<BoardRunner> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('runner_patch names the fields it changes — send at least one.');
        }
        return this.files.patchRunner(HybridflowApi.id(id, 'Runner'), patch, ifMatch);
    }

    /** Delete a runner. */
    async deleteRunner(id: string): Promise<{ deleted: string }> {
        const trimmed = HybridflowApi.id(id, 'Runner');
        await this.files.deleteRunner(trimmed);
        return { deleted: trimmed };
    }

    /** What happened after a cursor — the board's changes since `board_get`'s cursor. */
    async getChanges(since?: number, board?: string, limit?: number): Promise<BoardChanges> {
        return this.files.getChanges(since, board?.trim() || undefined, limit);
    }

    /** The migration ledger: which version the store is on. */
    async getSchema(): Promise<{ version: number; migrations: unknown[] }> {
        return this.files.getHybridflowSchema();
    }

    private static handle(handle: string): string {
        const trimmed = handle.trim();
        if (!trimmed) throw new Error('Board handle must not be empty.');
        return trimmed;
    }

    private static id(id: string, what: string): string {
        const trimmed = id.trim();
        if (!trimmed) throw new Error(`${what} id must not be empty.`);
        return trimmed;
    }

    private static ids(ids: string[], empty: string): string[] {
        if (!Array.isArray(ids) || ids.length === 0) throw new Error(empty);
        const trimmed = ids.map((id) => id.trim()).filter((id) => id !== '');
        if (trimmed.length === 0) throw new Error(empty);
        return trimmed;
    }
}
