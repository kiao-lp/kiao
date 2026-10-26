import type { WorkerClient } from '../files.js';
import type {
    Board,
    BoardAgent,
    BoardAgentPatch,
    BoardChanges,
    BoardClassVersion,
    BoardClassVersionPatch,
    BoardFlowNode,
    BoardFlowNodeClass,
    BoardFlowNodeClassPatch,
    BoardFlowNodePatch,
    BoardInstantiateRequest,
    BoardListedClass,
    BoardListedWorkflowClass,
    BoardPatch,
    BoardRunner,
    BoardRunnerPatch,
    BoardUsageTotals,
    BoardWhole,
    BoardWorkflow,
    BoardWorkflowClass,
    BoardWorkflowClassPatch,
    BoardWorkflowPatch,
    NewBoardAgent,
    NewBoardClassVersion,
    NewBoardFlowNode,
    NewBoardFlowNodeClass,
    NewBoardRunner,
    NewBoardWorkflow,
    NewBoardWorkflowClass,
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

    /** Create a board. Answers it whole — its handle among it, which the card tools take. */
    async createBoard(name: string): Promise<BoardWhole> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Board name must not be empty.');
        return this.files.createBoard(trimmed);
    }

    /** Read one board whole — its cards, its classes, its workflows — and the cursor it was read at. */
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

    /** Remove cards. A chain naming a deleted card is left pointing at nothing. */
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

    /** File a class from a task: the card's title, kind and answers become the class's. */
    async convertFlowNodeToClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        return this.files.convertFlowNodeToClass(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Card'));
    }

    /** Every node class of every board: what the instantiate menu lists. */
    async listFlowNodeClasses(): Promise<{ flowNodeClasses: BoardListedClass[] }> {
        return this.files.listFlowNodeClasses();
    }

    /** File a node class on a board, with its first version's words beside it. */
    async createFlowNodeClass(handle: string, flowNodeClass: NewBoardFlowNodeClass): Promise<BoardFlowNodeClass> {
        const title = flowNodeClass.title?.trim();
        if (!title) throw new Error('A class needs a title.');
        return this.files.createFlowNodeClass(
            HybridflowApi.handle(handle), { ...flowNodeClass, title },
        );
    }

    /** Read one node class, with its succession beneath it. */
    async getFlowNodeClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        return this.files.getFlowNodeClass(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Class'));
    }

    /** Change a class's own fields — never its versions': a new description is a new version. */
    async patchFlowNodeClass(
        handle: string, id: string, patch: BoardFlowNodeClassPatch, ifMatch?: number,
    ): Promise<BoardFlowNodeClass> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('class_patch names the fields it changes — send at least one.');
        }
        return this.files.patchFlowNodeClass(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Class'), patch, ifMatch,
        );
    }

    /** Remove classes and their versions. */
    async deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<{ deleted: string[] }> {
        const ids = HybridflowApi.ids(flowNodeClasses, 'class_delete needs at least one class id.');
        await this.files.deleteFlowNodeClasses(HybridflowApi.handle(handle), ids);
        return { deleted: ids };
    }

    /** Link a class to the class after it; an empty target takes the link off. */
    async chainFlowNodeClass(handle: string, id: string, flowNode: string): Promise<BoardFlowNodeClass> {
        return this.files.chainFlowNodeClass(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Class'), flowNode.trim(),
        );
    }

    /** File one version under its class — blank, or copied from the version `from` names. */
    async createClassVersion(
        handle: string, classId: string, version: NewBoardClassVersion,
    ): Promise<BoardClassVersion> {
        return this.files.createClassVersion(
            HybridflowApi.handle(handle), HybridflowApi.id(classId, 'Class'), version,
        );
    }

    /** Change what a draft says, or publish it. A published version is refused whatever is sent. */
    async patchClassVersion(
        handle: string, classId: string, versionId: string, patch: BoardClassVersionPatch, ifMatch?: number,
    ): Promise<BoardClassVersion> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('class_patch_version names the fields it changes — send at least one.');
        }
        return this.files.patchClassVersion(
            HybridflowApi.handle(handle),
            HybridflowApi.id(classId, 'Class'),
            HybridflowApi.id(versionId, 'Version'),
            patch, ifMatch,
        );
    }

    /** Delete one class version. */
    async deleteClassVersion(handle: string, classId: string, versionId: string): Promise<{ deleted: string }> {
        const trimmed = HybridflowApi.id(versionId, 'Version');
        await this.files.deleteClassVersion(
            HybridflowApi.handle(handle), HybridflowApi.id(classId, 'Class'), trimmed,
        );
        return { deleted: trimmed };
    }

    /** Make flow nodes from a class and all its successors, on the board the handle names. */
    async instantiateFlowNodeClass(
        handle: string, classId: string, request: BoardInstantiateRequest,
    ): Promise<{ flowNodes: BoardFlowNode[] }> {
        return this.files.instantiateFlowNodeClass(
            HybridflowApi.handle(handle), HybridflowApi.id(classId, 'Class'), request,
        );
    }

    /** File a workflow on a board and group its cards in it. */
    async createWorkflow(handle: string, workflow: NewBoardWorkflow): Promise<BoardWorkflow> {
        return this.files.createWorkflow(HybridflowApi.handle(handle), workflow);
    }

    /** Read one workflow. */
    async getWorkflow(handle: string, id: string): Promise<BoardWorkflow> {
        return this.files.getWorkflow(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow'));
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

    /** Every workflow class of every board. */
    async listWorkflowClasses(): Promise<{ workflowClasses: BoardListedWorkflowClass[] }> {
        return this.files.listWorkflowClasses();
    }

    /** File a workflow class on a board and group its classes in it. */
    async createWorkflowClass(handle: string, workflowClass: NewBoardWorkflowClass): Promise<BoardWorkflowClass> {
        return this.files.createWorkflowClass(HybridflowApi.handle(handle), workflowClass);
    }

    /** Read one workflow class. */
    async getWorkflowClass(handle: string, id: string): Promise<BoardWorkflowClass> {
        return this.files.getWorkflowClass(HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow class'));
    }

    /** Rename a workflow class. Its members are untouched. */
    async patchWorkflowClass(
        handle: string, id: string, patch: BoardWorkflowClassPatch, ifMatch?: number,
    ): Promise<BoardWorkflowClass> {
        if (!patch || Object.keys(patch).length === 0) {
            throw new Error('workflow_class_patch names the fields it changes — send at least one.');
        }
        return this.files.patchWorkflowClass(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow class'), patch, ifMatch,
        );
    }

    /** Remove workflow classes. Their classes are ungrouped and left where they are. */
    async deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<{ deleted: string[] }> {
        const ids = HybridflowApi.ids(workflowClasses, 'workflow_class_delete needs at least one workflow class id.');
        await this.files.deleteWorkflowClasses(HybridflowApi.handle(handle), ids);
        return { deleted: ids };
    }

    /** Make a workflow from a workflow class, on the board the handle names. */
    async instantiateWorkflowClass(
        handle: string, id: string, request: BoardInstantiateRequest,
    ): Promise<{ workflow: BoardWorkflow; flowNodes: BoardFlowNode[] }> {
        return this.files.instantiateWorkflowClass(
            HybridflowApi.handle(handle), HybridflowApi.id(id, 'Workflow class'), request,
        );
    }

    /** Every managed agent, by name. Read before naming one on a card. */
    async listAgents(includeArchived = false): Promise<{ agents: BoardAgent[] }> {
        return this.files.listAgents(includeArchived);
    }

    /** File a managed agent. The name must be free. */
    async createAgent(agent: NewBoardAgent): Promise<BoardAgent> {
        const name = agent.name?.trim();
        if (!name) throw new Error('An agent needs a name.');
        const platform = agent.platform?.trim();
        if (!platform) throw new Error('An agent needs a platform: claude, codex, muse or opencode.');
        return this.files.createAgent({ ...agent, name, platform });
    }

    /** Read one managed agent. */
    async getAgent(id: string): Promise<BoardAgent> {
        return this.files.getAgent(HybridflowApi.id(id, 'Agent'));
    }

    async publishAgent(id: string, ifMatch?: number): Promise<BoardAgent> {
        return this.files.publishAgent(HybridflowApi.id(id, 'Agent'), ifMatch);
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
    async deleteAgent(id: string): Promise<{ deleted: string }> {
        const trimmed = HybridflowApi.id(id, 'Agent');
        await this.files.deleteAgent(trimmed);
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
