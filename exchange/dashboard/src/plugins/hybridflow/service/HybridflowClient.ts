import {
    TaskExecutionDto, AgenticResourceDto, ResourceFileDto, SchemaValueDto, AgentDto, AgentPatchDto, AgentVersionDto, BoardSummary, ChangesDto,
    WorkflowWithFlowNodesDto,
    NewAgentDto, NewRunnerDto,
    NewWorkflowDto,
    NewFlowNodeDto, FlowNodeDto, FlowNodePatchDto,
    FlowNodeUsageTotalsDto,
    FolderDto,
    RunnerDto, RunnerPatchDto, SpotDto, BoardDetailDto,
    WorkflowDto, WorkflowPatchDto,
} from './types';
import type { ReleaseBump } from '../agentic-resources/release';

/** The boards, over HTTP. */
export class HybridflowClient {
    constructor(
        private readonly baseUrl: string,
        /** Read per call, because a token is renewed under an open board. */
        private readonly token: () => string | undefined,
    ) {}

    agenticResources(): Promise<AgenticResourceDto[]> { return this.send('GET', '/agentic-resources'); }
    taskExecutions(handle: string, id: string): Promise<TaskExecutionDto[]> {
        return this.send('GET', `${this.flowNodePath(handle, id)}/executions`);
    }
    resourceFile(name: string, path: string): Promise<ResourceFileDto> {
        return this.send('GET', `/agentic-resources/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`);
    }
    writeResourceFile(name: string, file: ResourceFileDto): Promise<ResourceFileDto> {
        return this.send('PUT', `/agentic-resources/${encodeURIComponent(name)}/file`, file);
    }
    resourceOperation(name: string, operation: 'install' | 'publish' | 'pull' | 'push', bump?: ReleaseBump): Promise<void> {
        return this.sendVoid('POST', `/agentic-resources/${encodeURIComponent(name)}/${operation}`, { bump });
    }

    async schemaValues(): Promise<SchemaValueDto[]> {
        const out = await this.send<{ schemaValues: SchemaValueDto[] }>('GET', '/schema-values');
        return out.schemaValues ?? [];
    }

    async boards(includeArchived = false): Promise<BoardSummary[]> {
        const query = includeArchived ? '?archived=1' : '';
        const { boards } = await this.send<{ boards: BoardSummary[] }>('GET', `/boards${query}`);
        return boards ?? [];
    }

    board(handle: string, signal?: AbortSignal): Promise<BoardDetailDto> {
        return this.send('GET', this.boardPath(handle), undefined, undefined, signal);
    }

    flowNodeBoard(id: string, signal: AbortSignal): Promise<BoardSummary> {
        return this.send('GET', `/flow-nodes/${encodeURIComponent(id)}/board`, undefined, undefined, signal);
    }

    createBoard(name: string, folderId?: string): Promise<BoardDetailDto> {
        return this.send<BoardDetailDto>('POST', '/boards', { name, folderId });
    }

    renameBoard(handle: string, name: string, revision?: number): Promise<BoardSummary> {
        return this.send<BoardSummary>('PATCH', `/boards/${encodeURIComponent(handle)}`, { name }, revision);
    }

    moveBoard(handle: string, folderId: string, revision: number): Promise<BoardSummary> {
        return this.send('PATCH', this.boardPath(handle), { folderId }, revision);
    }

    archiveBoard(handle: string, archive: boolean, revision?: number): Promise<BoardSummary> {
        return this.send<BoardSummary>('PATCH', `/boards/${encodeURIComponent(handle)}`, { archive }, revision);
    }

    deleteBoard(handle: string): Promise<void> {
        return this.sendVoid('DELETE', `/boards/${encodeURIComponent(handle)}`);
    }

    async boardFolders(): Promise<FolderDto[]> {
        const { folders } = await this.send<{ folders: FolderDto[] }>('GET', '/folders/boards');
        return folders ?? [];
    }

    createBoardFolder(name: string): Promise<FolderDto> {
        return this.send('POST', '/folders/boards', { name });
    }

    renameBoardFolder(id: string, name: string): Promise<FolderDto> {
        return this.send('PATCH', `/folders/boards/${encodeURIComponent(id)}`, { name });
    }

    deleteBoardFolder(id: string): Promise<void> {
        return this.sendVoid('DELETE', `/folders/boards/${encodeURIComponent(id)}`);
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

    flowNodeUsageTotals(handle: string, flowNodeId: string): Promise<FlowNodeUsageTotalsDto> {
        return this.send<FlowNodeUsageTotalsDto>(
            'GET', `${this.flowNodePath(handle, flowNodeId)}/usage`);
    }

    createWorkflow(handle: string, workflow: NewWorkflowDto): Promise<WorkflowDto> {
        return this.send<WorkflowDto>(
            'POST', `${this.boardPath(handle)}/workflows`, workflow);
    }

    pasteWorkflow(handle: string, clipboard: Record<string, unknown>, spot?: SpotDto): Promise<WorkflowWithFlowNodesDto> {
        return this.send('POST', `${this.boardPath(handle)}/workflows/clipboard`, { clipboard, spot });
    }

    workflow(handle: string, id: string): Promise<WorkflowDto> {
        return this.send('GET', `${this.boardPath(handle)}/workflows/${encodeURIComponent(id)}`);
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

    publishAgent(id: string, revision?: number, bump?: ReleaseBump): Promise<AgentDto> {
        return this.send<AgentDto>('POST', `/agents/${encodeURIComponent(id)}/publish`, { bump }, revision);
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
