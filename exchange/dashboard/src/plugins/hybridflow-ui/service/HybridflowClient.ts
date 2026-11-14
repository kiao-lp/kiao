import {
    SchemaValueDto, AgentDto, AgentPatchDto, AgentVersionDto, BoardSummary, ChangesDto, ClassVersionDto, ClassVersionPatchDto,
    InstantiateBodies, InstantiateWorkflowResult,
    NewAgentDto, NewClassVersionDto, NewFlowNodeClassDto, NewRunnerDto, NewWorkflowClassDto,
    NewWorkflowDto,
    NewFlowNodeDto, FlowNodeClassDto, FlowNodeClassPatchDto, FlowNodeDto, FlowNodePatchDto,
    FlowNodeUsageTotalsDto,
    ListedClassDto, ListedWorkflowClassDto, RunnerDto, RunnerPatchDto, SpotDto, BoardDetailDto,
    WorkflowClassDto, WorkflowClassPatchDto, WorkflowDto, WorkflowPatchDto,
} from './types';

/** The boards, over HTTP. */
export class HybridflowClient {
    constructor(
        private readonly baseUrl: string,
        /** Read per call, because a token is renewed under an open board. */
        private readonly token: () => string | undefined,
    ) {}

    async schemaValues(): Promise<SchemaValueDto[]> {
        const out = await this.send<{ schemaValues: SchemaValueDto[] }>('GET', '/schema-values');
        return out.schemaValues ?? [];
    }


    async boards(includeArchived = false): Promise<BoardSummary[]> {
        const query = includeArchived ? '?archived=1' : '';
        const { boards } = await this.send<{ boards: BoardSummary[] }>('GET', `/boards${query}`);
        return boards ?? [];
    }


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


    async createFlowNodes(handle: string, flowNodes: NewFlowNodeDto[]): Promise<FlowNodeDto[]> {
        const out = await this.send<{ flowNodes: FlowNodeDto[] }>(
            'POST', `${this.boardPath(handle)}/flow-nodes`, { flowNodes });
        return out.flowNodes ?? [];
    }

    patchFlowNode(handle: string, flowNodeId: string, patch: FlowNodePatchDto, revision?: number): Promise<FlowNodeDto> {
        return this.send<FlowNodeDto>('PATCH', this.flowNodePath(handle, flowNodeId), patch, revision);
    }


    chainFlowNode(handle: string, fromId: string, toId: string): Promise<FlowNodeDto> {
        return this.send<FlowNodeDto>('POST', `${this.flowNodePath(handle, fromId)}/chain`, { flowNode: toId });
    }

    deleteFlowNodes(handle: string, flowNodes: string[]): Promise<void> {
        return this.sendVoid('DELETE', `${this.boardPath(handle)}/flow-nodes`, { flowNodes });
    }


    convertFlowNodeToClass(handle: string, flowNodeId: string): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'POST', `${this.flowNodePath(handle, flowNodeId)}/to-class`, {});
    }


    flowNodeUsageTotals(handle: string, flowNodeId: string): Promise<FlowNodeUsageTotalsDto> {
        return this.send<FlowNodeUsageTotalsDto>(
            'GET', `${this.flowNodePath(handle, flowNodeId)}/usage`);
    }


    async flowNodeClasses(): Promise<ListedClassDto[]> {
        const { flowNodeClasses } = await this.send<{ flowNodeClasses: ListedClassDto[] }>(
            'GET', '/flow-node-classes');
        return flowNodeClasses ?? [];
    }


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


    chainFlowNodeClass(handle: string, fromId: string, toId: string): Promise<FlowNodeClassDto> {
        return this.send<FlowNodeClassDto>(
            'POST', `${this.flowNodeClassPath(handle, fromId)}/chain`, { flowNode: toId });
    }

    deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.boardPath(handle)}/flow-node-classes`, { flowNodeClasses });
    }


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


    deleteClassVersion(handle: string, classId: string, versionId: string): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.flowNodeClassPath(handle, classId)}/versions/${encodeURIComponent(versionId)}`);
    }


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


    createWorkflow(handle: string, workflow: NewWorkflowDto): Promise<WorkflowDto> {
        return this.send<WorkflowDto>(
            'POST', `${this.boardPath(handle)}/workflows`, workflow);
    }


    patchWorkflow(
        handle: string, workflowId: string, patch: WorkflowPatchDto, revision?: number,
    ): Promise<WorkflowDto> {
        return this.send<WorkflowDto>(
            'PATCH', `${this.boardPath(handle)}/workflows/${encodeURIComponent(workflowId)}`,
            patch, revision);
    }


    deleteWorkflows(handle: string, workflows: string[]): Promise<void> {
        return this.sendVoid('DELETE', `${this.boardPath(handle)}/workflows`, { workflows });
    }


    createWorkflowClass(handle: string, workflow: NewWorkflowClassDto): Promise<WorkflowClassDto> {
        return this.send<WorkflowClassDto>(
            'POST', `${this.boardPath(handle)}/workflow-classes`, workflow);
    }


    patchWorkflowClass(
        handle: string, workflowId: string, patch: WorkflowClassPatchDto, revision?: number,
    ): Promise<WorkflowClassDto> {
        return this.send<WorkflowClassDto>(
            'PATCH', `${this.boardPath(handle)}/workflow-classes/${encodeURIComponent(workflowId)}`,
            patch, revision);
    }


    deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<void> {
        return this.sendVoid(
            'DELETE', `${this.boardPath(handle)}/workflow-classes`, { workflowClasses });
    }


    async workflowClasses(): Promise<ListedWorkflowClassDto[]> {
        const { workflowClasses } = await this.send<{ workflowClasses: ListedWorkflowClassDto[] }>(
            'GET', '/workflow-classes');
        return workflowClasses ?? [];
    }


    instantiateWorkflowClass(
        handle: string, workflowClassId: string, spot?: SpotDto, bodies?: InstantiateBodies,
    ): Promise<InstantiateWorkflowResult> {
        return this.send<InstantiateWorkflowResult>(
            'POST', `${this.boardPath(handle)}/workflow-classes/${encodeURIComponent(workflowClassId)}/instantiate`, {
                ...(spot ? { spot } : {}),
                ...(bodies && Object.keys(bodies).length ? { bodies } : {}),
            });
    }


    async agents(includeArchived = false): Promise<AgentDto[]> {
        const { agents } = await this.send<{ agents: AgentDto[] }>('GET', `/agents${includeArchived ? '?archived=true' : ''}`);
        return agents ?? [];
    }


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

    publishAgent(id: string, revision?: number): Promise<AgentDto> {
        return this.send<AgentDto>('POST', `/agents/${encodeURIComponent(id)}/publish`, {}, revision);
    }

    async agentVersions(id: string): Promise<AgentVersionDto[]> {
        const { versions } = await this.send<{ versions: AgentVersionDto[] }>('GET', `/agents/${encodeURIComponent(id)}/versions`);
        return versions;
    }


    async runners(): Promise<RunnerDto[]> {
        const { runners } = await this.send<{ runners: RunnerDto[] }>('GET', '/runners');
        return runners ?? [];
    }


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
        // The store holds the current boards; a cached answer can be an old refusal.
        const response = await fetch(`${this.baseUrl}${path}`, {
            method, headers, signal, cache: 'no-store',
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw await HybridflowError.of(response);
        return response;
    }
}

/** A refused request, with the status kept. */
export class HybridflowError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'HybridflowError';
    }


    get conflict(): boolean { return this.status === 409; }

    get gone(): boolean { return this.status === 404; }

    static async of(response: Response): Promise<HybridflowError> {
        let message = `the hybridflow store answered ${response.status}`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string' && body.error) message = body.error;
        } catch {

        }
        return new HybridflowError(response.status, message);
    }
}
