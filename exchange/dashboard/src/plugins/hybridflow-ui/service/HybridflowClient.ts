import {
    AgentDto, AgentPatchDto, BoardSummary, ChangesDto, ClassVersionDto, ClassVersionPatchDto,
    InstantiateBodies, InstantiateWorkflowResult,
    NewAgentDto, NewClassVersionDto, NewFlowNodeClassDto, NewRunnerDto, NewWorkflowClassDto,
    NewWorkflowDto,
    NewFlowNodeDto, FlowNodeClassDto, FlowNodeClassPatchDto, FlowNodeDto, FlowNodePatchDto,
    FlowNodeUsageTotalsDto,
    ListedClassDto, ListedWorkflowClassDto, RunnerDto, RunnerPatchDto, SpotDto, BoardDetailDto,
    WorkflowClassDto, WorkflowClassPatchDto, WorkflowDto, WorkflowPatchDto,
} from './types';

/**
 * The boards, over HTTP.
 *
 * One class, no framework, no React: what it knows is a base URL and how to get a token. That is
 * what makes it testable against a stub `fetch` and what keeps the board's own logic — which is all
 * in pure functions — from growing a dependency on a transport.
 *
 * ── the convention that carries the concurrency story ─────────────────────────
 *
 * **`If-Match` is what makes a write conditional.** A patch sent with the revision the editor was
 * working from either lands on that revision or comes back `409`; a patch sent without one does not
 * care, which is what a status a run wrote means and what a rename somebody typed does not. The
 * editor sends the revision for what a person changed and omits it for what it is merely repeating.
 */
export class HybridflowClient {
    constructor(
        private readonly baseUrl: string,
        /** Read per call, because a token is renewed under an open board. */
        private readonly token: () => string | undefined,
    ) {}

    // ── boards ────────────────────────────────────────────────────────────────

    /** Every board, for the page that lists them. */
    async boards(includeArchived = false): Promise<BoardSummary[]> {
        const query = includeArchived ? '?archived=1' : '';
        const { boards } = await this.send<{ boards: BoardSummary[] }>('GET', `/boards${query}`);
        return boards ?? [];
    }

    /** One board, whole: its cards, and the cursor to watch from. */
    board(handle: string): Promise<BoardDetailDto> {
        return this.send<BoardDetailDto>('GET', `/boards/${encodeURIComponent(handle)}`);
    }

    createBoard(name: string): Promise<BoardDetailDto> {
        return this.send<BoardDetailDto>('POST', '/boards', { name });
    }

    renameBoard(handle: string, name: string, revision?: number): Promise<BoardSummary> {
        return this.send<BoardSummary>('PATCH', `/boards/${encodeURIComponent(handle)}`, { name }, revision);
    }

    archiveBoard(handle: string, archive: boolean, revision?: number): Promise<BoardSummary> {
        return this.send<BoardSummary>('PATCH', `/boards/${encodeURIComponent(handle)}`, { archive }, revision);
    }

    deleteBoard(handle: string): Promise<void> {
        return this.sendVoid('DELETE', `/boards/${encodeURIComponent(handle)}`);
    }

    // ── cards ─────────────────────────────────────────────────────────────────

    /** Creates cards. Several at once, because a paste of six is one gesture and one change. */
    async createFlowNodes(handle: string, flowNodes: NewFlowNodeDto[]): Promise<FlowNodeDto[]> {
        const out = await this.send<{ flowNodes: FlowNodeDto[] }>(
            'POST', `${this.boardPath(handle)}/flow-nodes`, { flowNodes });
        return out.flowNodes ?? [];
    }

    patchFlowNode(handle: string, flowNodeId: string, patch: FlowNodePatchDto, revision?: number): Promise<FlowNodeDto> {
        return this.send<FlowNodeDto>('PATCH', this.flowNodePath(handle, flowNodeId), patch, revision);
    }

    /** Links a card to the one played after it; an empty target takes the link off. */
    chainFlowNode(handle: string, fromId: string, toId: string): Promise<FlowNodeDto> {
        return this.send<FlowNodeDto>('POST', `${this.flowNodePath(handle, fromId)}/chain`, { flowNode: toId });
    }

    deleteFlowNodes(handle: string, flowNodes: string[]): Promise<void> {
        return this.sendVoid('DELETE', `${this.boardPath(handle)}/flow-nodes`, { flowNodes });
    }

    /** Files a class from a task: the card's title, kind and answers become the class's. */
    convertFlowNodeToClass(handle: string, flowNodeId: string): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'POST', `${this.flowNodePath(handle, flowNodeId)}/to-class`, {});
    }

    /** What one AI card spent, whole: the sums of the usage reports its turns filed. */
    flowNodeUsageTotals(handle: string, flowNodeId: string): Promise<FlowNodeUsageTotalsDto> {
        return this.send<FlowNodeUsageTotalsDto>(
            'GET', `${this.flowNodePath(handle, flowNodeId)}/usage`);
    }

    // ── node classes ──────────────────────────────────────────────────────────

    /** Every class of every board: what the instantiate menu lists. */
    async flowNodeClasses(): Promise<ListedClassDto[]> {
        const { flowNodeClasses } = await this.send<{ flowNodeClasses: ListedClassDto[] }>(
            'GET', '/flow-node-classes');
        return flowNodeClasses ?? [];
    }

    /** Files a class on a board, with its first version beneath it. */
    createFlowNodeClass(handle: string, flowNodeClass: NewFlowNodeClassDto): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'POST', `${this.boardPath(handle)}/flow-node-classes`, flowNodeClass);
    }

    patchFlowNodeClass(
        handle: string, classId: string, patch: FlowNodeClassPatchDto, revision?: number,
    ): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'PATCH', this.flowNodeClassPath(handle, classId), patch, revision);
    }

    /** Links a class to the one after it; an empty target takes the link off. */
    chainFlowNodeClass(handle: string, fromId: string, toId: string): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'POST', `${this.flowNodeClassPath(handle, fromId)}/chain`, { flowNode: toId });
    }

    deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.boardPath(handle)}/flow-node-classes`, { flowNodeClasses });
    }

    /** Files the next version under its class: one more than the succession holds, a draft. */
    createClassVersion(
        handle: string, classId: string, version: NewClassVersionDto,
    ): Promise<ClassVersionDto> {
        return this.send<ClassVersionDto>(
            'POST', `${this.flowNodeClassPath(handle, classId)}/versions`, version);
    }

    patchClassVersion(
        handle: string, classId: string, versionId: string, patch: ClassVersionPatchDto,
        revision?: number,
    ): Promise<ClassVersionDto> {
        return this.send<ClassVersionDto>(
            'PATCH', `${this.flowNodeClassPath(handle, classId)}/versions/${encodeURIComponent(versionId)}`,
            patch, revision);
    }

    /** Removes a draft: a new version somebody changed their mind about. */
    deleteClassVersion(handle: string, classId: string, versionId: string): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.flowNodeClassPath(handle, classId)}/versions/${encodeURIComponent(versionId)}`);
    }

    /**
     * Makes flow nodes from a class and all its successors, on the board the handle names —
     * which may be another board than the class's own. Where `bodies` names a class, its flow
     * node is asked the instantiated text rather than its version's body.
     */
    async instantiateFlowNodeClass(
        handle: string, classId: string, spot?: SpotDto, bodies?: InstantiateBodies,
    ): Promise<FlowNodeDto[]> {
        const out = await this.send<{ flowNodes: FlowNodeDto[] }>(
            'POST', `${this.flowNodeClassPath(handle, classId)}/instantiate`, {
                ...(spot ? { spot } : {}),
                ...(bodies && Object.keys(bodies).length ? { bodies } : {}),
            });
        return out.flowNodes ?? [];
    }

    // ── workflows ─────────────────────────────────────────────────────────────

    /** Files a workflow on a board and groups its cards in it. */
    createWorkflow(handle: string, workflow: NewWorkflowDto): Promise<WorkflowDto> {
        return this.send<WorkflowDto>(
            'POST', `${this.boardPath(handle)}/workflows`, workflow);
    }

    /** Renames a workflow. Its members are untouched. */
    patchWorkflow(
        handle: string, workflowId: string, patch: WorkflowPatchDto, revision?: number,
    ): Promise<WorkflowDto> {
        return this.send<WorkflowDto>(
            'PATCH', `${this.boardPath(handle)}/workflows/${encodeURIComponent(workflowId)}`,
            patch, revision);
    }

    /** Removes workflows. Their cards are ungrouped and left where they are. */
    deleteWorkflows(handle: string, workflows: string[]): Promise<void> {
        return this.sendVoid('DELETE', `${this.boardPath(handle)}/workflows`, { workflows });
    }

    /** Files a workflow class on a board and groups its classes in it. */
    createWorkflowClass(handle: string, workflow: NewWorkflowClassDto): Promise<WorkflowClassDto> {
        return this.send<WorkflowClassDto>(
            'POST', `${this.boardPath(handle)}/workflow-classes`, workflow);
    }

    /** Renames a workflow class. Its members are untouched. */
    patchWorkflowClass(
        handle: string, workflowId: string, patch: WorkflowClassPatchDto, revision?: number,
    ): Promise<WorkflowClassDto> {
        return this.send<WorkflowClassDto>(
            'PATCH', `${this.boardPath(handle)}/workflow-classes/${encodeURIComponent(workflowId)}`,
            patch, revision);
    }

    /** Removes workflow classes. Their classes are ungrouped and left where they are. */
    deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.boardPath(handle)}/workflow-classes`, { workflowClasses });
    }

    /** Every workflow class of every board: what the instantiate menu lists beside the node classes. */
    async workflowClasses(): Promise<ListedWorkflowClassDto[]> {
        const { workflowClasses } = await this.send<{ workflowClasses: ListedWorkflowClassDto[] }>(
            'GET', '/workflow-classes');
        return workflowClasses ?? [];
    }

    /**
     * Makes a workflow from a workflow class — one flow node per member — on the board the
     * handle names, which may be another board than the workflow class's own. Where `bodies`
     * names a class, its flow node is asked the instantiated text rather than its version's
     * body.
     */
    instantiateWorkflowClass(
        handle: string, workflowClassId: string, spot?: SpotDto, bodies?: InstantiateBodies,
    ): Promise<InstantiateWorkflowResult> {
        return this.send<InstantiateWorkflowResult>(
            'POST', `${this.boardPath(handle)}/workflow-classes/${encodeURIComponent(workflowClassId)}/instantiate`, {
                ...(spot ? { spot } : {}),
                ...(bodies && Object.keys(bodies).length ? { bodies } : {}),
            });
    }

    // ── agents ────────────────────────────────────────────────────────────────

    /** Every managed agent, by name: what the panel lists and the flow node editor picks from. */
    async agents(): Promise<AgentDto[]> {
        const { agents } = await this.send<{ agents: AgentDto[] }>('GET', '/agents');
        return agents ?? [];
    }

    /** One managed agent, by id. */
    agent(id: string): Promise<AgentDto> {
        return this.send<AgentDto>('GET', `/agents/${encodeURIComponent(id)}`);
    }

    createAgent(agent: NewAgentDto): Promise<AgentDto> {
        return this.send<AgentDto>('POST', '/agents', agent);
    }

    patchAgent(id: string, patch: AgentPatchDto, revision?: number): Promise<AgentDto> {
        return this.send<AgentDto>('PATCH', `/agents/${encodeURIComponent(id)}`, patch, revision);
    }

    deleteAgent(id: string): Promise<void> {
        return this.sendVoid('DELETE', `/agents/${encodeURIComponent(id)}`);
    }

    // ── runners ───────────────────────────────────────────────────────────────

    /** Every runner, by name: what the panel lists and the task editor picks from. */
    async runners(): Promise<RunnerDto[]> {
        const { runners } = await this.send<{ runners: RunnerDto[] }>('GET', '/runners');
        return runners ?? [];
    }

    /** One runner, by id. */
    runner(id: string): Promise<RunnerDto> {
        return this.send<RunnerDto>('GET', `/runners/${encodeURIComponent(id)}`);
    }

    createRunner(runner: NewRunnerDto): Promise<RunnerDto> {
        return this.send<RunnerDto>('POST', '/runners', runner);
    }

    patchRunner(id: string, patch: RunnerPatchDto, revision?: number): Promise<RunnerDto> {
        return this.send<RunnerDto>('PATCH', `/runners/${encodeURIComponent(id)}`, patch, revision);
    }

    deleteRunner(id: string): Promise<void> {
        return this.sendVoid('DELETE', `/runners/${encodeURIComponent(id)}`);
    }

    // ── what changed ──────────────────────────────────────────────────────────

    /**
     * What happened after `since` on this board. With `wait`, the request is **held** until
     * something does or the service's own timeout runs out — so a board a run is rewriting redraws
     * in the time a notification takes rather than in the time a poll interval takes.
     *
     * `signal` is how the caller lets go: a board being closed, or a cursor that has moved on.
     */
    changes(
        boardId: string, since: number, opts: { wait?: boolean; signal?: AbortSignal } = {},
    ): Promise<ChangesDto> {
        const query = new URLSearchParams({ board: boardId, since: String(since) });
        if (opts.wait) query.set('wait', '1');
        return this.send<ChangesDto>('GET', `/changes?${query.toString()}`, undefined, undefined, opts.signal);
    }

    private boardPath(handle: string): string {
        return `/boards/${encodeURIComponent(handle)}`;
    }

    private flowNodePath(handle: string, flowNodeId: string): string {
        return `${this.boardPath(handle)}/flow-nodes/${encodeURIComponent(flowNodeId)}`;
    }

    private flowNodeClassPath(handle: string, classId: string): string {
        return `${this.boardPath(handle)}/flow-node-classes/${encodeURIComponent(classId)}`;
    }

    private async send<T>(
        method: string, path: string, body?: unknown, revision?: number, signal?: AbortSignal,
    ): Promise<T> {
        const response = await this.fetch(method, path, body, revision, signal);
        const text = await response.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
    }

    private async sendVoid(method: string, path: string, body?: unknown): Promise<void> {
        await this.fetch(method, path, body);
    }

    private async fetch(
        method: string, path: string, body?: unknown, revision?: number, signal?: AbortSignal,
    ): Promise<Response> {
        const headers: Record<string, string> = {};
        const token = this.token();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (revision !== undefined) headers['If-Match'] = String(revision);
        const response = await fetch(`${this.baseUrl}${path}`, {
            method, headers, signal,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw await HybridflowError.of(response);
        return response;
    }
}

/**
 * A refused request, with the status kept.
 *
 * The status is the whole of what a caller acts on, and two of them are ordinary rather than
 * exceptional: a **409** is somebody else having changed the thing first — the answer is to read it
 * again, not to show an error — and a **404** is a board or a card that has gone, which on a live
 * board is a thing that happens. The message is the service's own sentence, because it was written
 * for the person who will read it.
 */
export class HybridflowError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'HybridflowError';
    }

    /** Whether the thing moved under us: read it again and decide against what it now says. */
    get conflict(): boolean { return this.status === 409; }

    /** Whether it is no longer there. */
    get gone(): boolean { return this.status === 404; }

    static async of(response: Response): Promise<HybridflowError> {
        let message = `the hybridflow store answered ${response.status}`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string' && body.error) message = body.error;
        } catch {
            // A body that is not JSON says nothing useful; the status line already did.
        }
        return new HybridflowError(response.status, message);
    }
}
