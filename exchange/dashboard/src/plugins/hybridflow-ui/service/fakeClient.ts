import { readBoardContent, writeBoardContent, BoardContent } from '../boardContent';
import * as ops from '../boardOps';
import { HybridflowClient, HybridflowError } from './HybridflowClient';
import {
    AgentDto, AgentPatchDto, BoardSummary, ClassVersionDto, ClassVersionPatchDto,
    InstantiateBodies, InstantiateWorkflowResult,
    NewAgentDto, NewClassVersionDto, NewFlowNodeClassDto, NewFlowNodeDto, NewRunnerDto,
    NewWorkflowClassDto, NewWorkflowDto,
    FlowNodeClassDto, FlowNodeClassPatchDto, FlowNodeDto, FlowNodePatchDto,
    FlowNodeUsageTotalsDto,
    ListedClassDto, ListedWorkflowClassDto, RunnerDto, RunnerPatchDto, SpotDto, BoardDetailDto,
    WorkflowClassDto, WorkflowClassPatchDto, WorkflowDto, WorkflowPatchDto,
} from './types';

/**
 * A hybridflow store held in memory, for the tests above this client.
 *
 * **It is not a second implementation of the board's rules.** What it does is keep a `BoardContent`, let
 * a test read and change it, and count the calls — so a test can say "this gesture sent this call"
 * and "the board came back saying this". The rules themselves are tested where they live: the pure
 * operations in `boardOps`, and the service's own behaviour in
 * `operation/hybridflow-store/core/services`.
 *
 * It applies each call with the plugin's own pure operations, so that a test which asserts on the
 * board afterwards reads something coherent rather than a stub's guess. Where the real service
 * differs — a revision, an ordering under concurrency — this says nothing, on purpose: those
 * are the things only a database can promise, and they are checked against one.
 */
export class FakeHybridflowClient {
    /** Every call made, in order, as `method handle` — what a test asserts a gesture sent. */
    readonly calls: string[] = [];
    /** What the next read will answer. A test changes it to play "somebody else wrote the board". */
    content: BoardContent;
    /** Bumped by every change, so a client watching sees the board move. */
    cursor = 1;
    /** The board's own row, as a read answers with it. Named `summary` because `board` is a call. */
    summary: BoardSummary;
    /** Every board, as a listing answers with them. A test files them to play "the store". */
    boardsList: BoardSummary[];
    /** The managed agents, as a listing answers with them. A test files them to play "the store". */
    agentsList: AgentDto[] = [];
    /** The runners, as a listing answers with them. A test files them to play "the store". */
    runnersList: RunnerDto[] = [];

    constructor(content: BoardContent, slug = 'board') {
        this.content = content;
        this.summary = {
            id: '00000000-0000-4000-8000-000000000000', name: slug, slug,
            createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
            revision: 1, archived: false,
        };
        this.boardsList = [this.summary];
    }

    /** The fake as the code under test sees it: a HybridflowClient, and nothing more. */
    asClient(): HybridflowClient { return this as unknown as HybridflowClient; }

    /**
     * Plays a change made by somebody else — a run marking a card, a second tab moving a card.
     *
     * It wakes whatever is watching, so a test that calls this drives the board down **the real
     * path**: the held request comes back, the board is read again, and what came back is merged
     * with what is on screen. Nothing has to reach for the reload.
     */
    elsewhere(change: (held: BoardContent) => BoardContent | null): void {
        const next = change(this.content);
        if (!next) return;
        this.content = next;
        this.cursor += 1;
        const waiting = this.watchers;
        this.watchers = [];
        waiting.forEach(wake => wake());
    }

    private watchers: (() => void)[] = [];

    private answer(): BoardDetailDto {
        const content = writeBoardContent(this.content) as {
            flowNodes: unknown[]; flowNodeClasses: unknown[];
            workflows?: unknown[]; workflowClasses?: unknown[];
        };
        return {
            board: this.summary,
            // Through the writer and the reader, so what a test gets back has been round-tripped
            // exactly as the wire would round-trip it — including the fields the format leaves out.
            flowNodes: content.flowNodes as unknown as FlowNodeDto[],
            flowNodeClasses: content.flowNodeClasses as unknown as FlowNodeClassDto[],
            workflows: (content.workflows ?? []) as unknown as WorkflowDto[],
            workflowClasses: (content.workflowClasses ?? []) as unknown as WorkflowClassDto[],
            cursor: this.cursor,
        };
    }

    async boards(includeArchived = false): Promise<BoardSummary[]> {
        this.calls.push('boards');
        return this.boardsList.filter(board => includeArchived || !board.archived);
    }

    async board(handle: string): Promise<BoardDetailDto> {
        this.calls.push(`board ${handle}`);
        return this.answer();
    }

    async createBoard(name: string): Promise<BoardDetailDto> {
        this.calls.push(`createBoard ${name}`);
        const trimmed = name.trim();
        if (!trimmed) throw new Error('a board is created with a name');
        this.assertNameFree(trimmed);
        const now = new Date().toISOString();
        const made: BoardSummary = {
            id: crypto.randomUUID(), name: trimmed, slug: this.freeSlug(trimmed),
            createdAt: now, updatedAt: now, revision: 1, archived: false,
        };
        this.boardsList = [...this.boardsList, made];
        return {
            board: made, flowNodes: [], flowNodeClasses: [],
            workflows: [], workflowClasses: [], cursor: this.cursor,
        };
    }

    async renameBoard(handle: string, name: string): Promise<BoardSummary> {
        this.calls.push(`renameBoard ${handle} ${name}`);
        const board = this.findBoard(handle);
        if (!board) throw new HybridflowError(404, `no such board: ${handle}`);
        const trimmed = name.trim();
        if (!trimmed) throw new Error('a board keeps a name');
        if (this.boardsList.some(candidate => candidate !== board
            && candidate.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new HybridflowError(409, 'board name is taken');
        }
        // In place, so `summary` — the same object where this is the board under test — stays
        // current. The slug is untouched, as the service leaves it: a rename moves nothing.
        board.name = trimmed;
        board.updatedAt = new Date().toISOString();
        board.revision += 1;
        return board;
    }

    async deleteBoard(handle: string): Promise<void> {
        this.calls.push(`deleteBoard ${handle}`);
        if (!this.findBoard(handle)) throw new HybridflowError(404, `no such board: ${handle}`);
        this.boardsList = this.boardsList
            .filter(board => board.slug !== handle && board.id !== handle);
    }

    /** One board, by id or by slug — both, through one call, as the service finds it. */
    private findBoard(handle: string): BoardSummary | undefined {
        return this.boardsList.find(board => board.slug === handle || board.id === handle);
    }

    /** Refuses a name another board already has, however it is cased — the service's 409. */
    private assertNameFree(name: string): void {
        if (this.boardsList.some(board => board.name.toLowerCase() === name.toLowerCase())) {
            throw new HybridflowError(409, 'board name is taken');
        }
    }

    /** The handle a name is reached by, suffixed until it is free — the service's rule. */
    private freeSlug(name: string): string {
        const base = slugOf(name);
        let slug = base;
        for (let attempt = 2; this.boardsList.some(board => board.slug === slug); attempt += 1) {
            slug = `${base}-${attempt}`;
        }
        return slug;
    }

    /**
     * The held request, held for real: it comes back the moment the board moves, and not before.
     *
     * The change it reports says only that something happened — the scope and the card, as the
     * service's own feed does — because that is all the board acts on: it reads the board again.
     */
    async changes(
        _boardId: string, since: number, opts: { signal?: AbortSignal } = {},
    ): Promise<{ changes: { seq: number; scope: string; kind: string }[]; cursor: number; more: boolean }> {
        if (this.cursor <= since) {
            await new Promise<void>((resolve, reject) => {
                this.watchers.push(resolve);
                opts.signal?.addEventListener('abort',
                    () => reject(new DOMException('aborted', 'AbortError')), { once: true });
            });
        }
        return {
            changes: [{ seq: this.cursor, scope: 'flowNode', kind: 'updated' }],
            cursor: this.cursor,
            more: false,
        };
    }

    async createFlowNodes(handle: string, flowNodes: NewFlowNodeDto[]): Promise<FlowNodeDto[]> {
        this.calls.push(`createFlowNodes ${handle} ${flowNodes.map(flowNode => flowNode.id ?? flowNode.title).join(',')}`);
        return [];
    }

    async patchFlowNode(handle: string, flowNodeId: string, patch: FlowNodePatchDto): Promise<FlowNodeDto | undefined> {
        this.calls.push(`patchFlowNode ${handle} ${flowNodeId} ${Object.keys(patch).sort().join('+')}`);
        return undefined;
    }

    async chainFlowNode(handle: string, fromId: string, toId: string): Promise<FlowNodeDto | undefined> {
        this.calls.push(`chainFlowNode ${handle} ${fromId} -> ${toId || 'none'}`);
        return undefined;
    }

    async deleteFlowNodes(handle: string, flowNodes: string[]): Promise<void> {
        this.calls.push(`deleteFlowNodes ${handle} ${flowNodes.join(',')}`);
    }

    async convertFlowNodeToClass(handle: string, flowNodeId: string): Promise<FlowNodeClassDto> {
        this.calls.push(`convertFlowNodeToClass ${handle} ${flowNodeId}`);
        return undefined as unknown as FlowNodeClassDto;
    }

    /** What each card spent, as the totals read answers with it. Filed by the test. */
    usageTotalsByFlowNode: Record<string, FlowNodeUsageTotalsDto> = {};

    async flowNodeUsageTotals(handle: string, flowNodeId: string): Promise<FlowNodeUsageTotalsDto> {
        this.calls.push(`flowNodeUsageTotals ${handle} ${flowNodeId}`);
        return this.usageTotalsByFlowNode[flowNodeId] ?? {
            reports: 0, inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
        };
    }

    /** The classes of all boards, as the instantiate menu lists them. Filed by the test. */
    classesList: ListedClassDto[] = [];

    async flowNodeClasses(): Promise<ListedClassDto[]> {
        this.calls.push('flowNodeClasses');
        return [...this.classesList];
    }

    async createFlowNodeClass(handle: string, flowNodeClass: NewFlowNodeClassDto): Promise<FlowNodeClassDto> {
        this.calls.push(`createFlowNodeClass ${handle} ${flowNodeClass.id ?? flowNodeClass.title}`);
        return undefined as unknown as FlowNodeClassDto;
    }

    async patchFlowNodeClass(
        handle: string, classId: string, patch: FlowNodeClassPatchDto,
    ): Promise<FlowNodeClassDto | undefined> {
        this.calls.push(`patchFlowNodeClass ${handle} ${classId} ${Object.keys(patch).sort().join('+')}`);
        return undefined;
    }

    async chainFlowNodeClass(handle: string, fromId: string, toId: string): Promise<FlowNodeClassDto | undefined> {
        this.calls.push(`chainFlowNodeClass ${handle} ${fromId} -> ${toId || 'none'}`);
        return undefined;
    }

    async deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<void> {
        this.calls.push(`deleteFlowNodeClasses ${handle} ${flowNodeClasses.join(',')}`);
    }

    async createClassVersion(
        handle: string, classId: string, _version: NewClassVersionDto,
    ): Promise<ClassVersionDto> {
        this.calls.push(`createClassVersion ${handle} ${classId}`);
        return undefined as unknown as ClassVersionDto;
    }

    async patchClassVersion(
        handle: string, classId: string, versionId: string, patch: ClassVersionPatchDto,
    ): Promise<ClassVersionDto | undefined> {
        this.calls.push(`patchClassVersion ${handle} ${classId} ${versionId} ${Object.keys(patch).sort().join('+')}`);
        return undefined;
    }

    async deleteClassVersion(handle: string, classId: string, versionId: string): Promise<void> {
        this.calls.push(`deleteClassVersion ${handle} ${classId} ${versionId}`);
    }

    async instantiateFlowNodeClass(
        handle: string, classId: string, _spot?: SpotDto, bodies?: InstantiateBodies,
    ): Promise<FlowNodeDto[]> {
        this.calls.push(`instantiateFlowNodeClass ${handle} ${classId}`
            + (bodies && Object.keys(bodies).length ? ` bodies:${Object.keys(bodies).sort().join(',')}` : ''));
        return [];
    }

    async createWorkflow(handle: string, workflow: NewWorkflowDto): Promise<WorkflowDto> {
        this.calls.push(`createWorkflow ${handle} ${workflow.id ?? workflow.name}`);
        return undefined as unknown as WorkflowDto;
    }

    async patchWorkflow(
        handle: string, workflowId: string, patch: WorkflowPatchDto,
    ): Promise<WorkflowDto | undefined> {
        this.calls.push(`patchWorkflow ${handle} ${workflowId} ${Object.keys(patch).sort().join('+')}`);
        return undefined;
    }

    async deleteWorkflows(handle: string, workflows: string[]): Promise<void> {
        this.calls.push(`deleteWorkflows ${handle} ${workflows.join(',')}`);
    }

    async createWorkflowClass(handle: string, workflow: NewWorkflowClassDto): Promise<WorkflowClassDto> {
        this.calls.push(`createWorkflowClass ${handle} ${workflow.id ?? workflow.name}`);
        return undefined as unknown as WorkflowClassDto;
    }

    async patchWorkflowClass(
        handle: string, workflowId: string, patch: WorkflowClassPatchDto,
    ): Promise<WorkflowClassDto | undefined> {
        this.calls.push(`patchWorkflowClass ${handle} ${workflowId} ${Object.keys(patch).sort().join('+')}`);
        return undefined;
    }

    async deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<void> {
        this.calls.push(`deleteWorkflowClasses ${handle} ${workflowClasses.join(',')}`);
    }

    /** The workflow classes of all boards, as the instantiate menu lists them. Filed by the test. */
    workflowClassesList: ListedWorkflowClassDto[] = [];

    async workflowClasses(): Promise<ListedWorkflowClassDto[]> {
        this.calls.push('workflowClasses');
        return [...this.workflowClassesList];
    }

    async instantiateWorkflowClass(
        handle: string, workflowClassId: string, _spot?: SpotDto, bodies?: InstantiateBodies,
    ): Promise<InstantiateWorkflowResult> {
        this.calls.push(`instantiateWorkflowClass ${handle} ${workflowClassId}`
            + (bodies && Object.keys(bodies).length ? ` bodies:${Object.keys(bodies).sort().join(',')}` : ''));
        return undefined as unknown as InstantiateWorkflowResult;
    }

    async agents(): Promise<AgentDto[]> {
        this.calls.push('agents');
        return [...this.agentsList];
    }

    async createAgent(agent: NewAgentDto): Promise<AgentDto> {
        this.calls.push(`createAgent ${agent.name}`);
        const made: AgentDto = {
            ...agent, id: `agent-${this.agentsList.length + 1}`,
            createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), revision: 1,
        };
        this.agentsList = [...this.agentsList, made];
        return made;
    }

    async patchAgent(id: string, patch: AgentPatchDto): Promise<AgentDto> {
        this.calls.push(`patchAgent ${id} ${Object.keys(patch).sort().join('+')}`);
        const at = this.agentsList.findIndex(agent => agent.id === id);
        if (at < 0) throw new Error(`no such agent: ${id}`);
        const next = { ...this.agentsList[at], ...patch, revision: this.agentsList[at].revision + 1 };
        this.agentsList = [...this.agentsList.slice(0, at), next, ...this.agentsList.slice(at + 1)];
        return next;
    }

    async deleteAgent(id: string): Promise<void> {
        this.calls.push(`deleteAgent ${id}`);
        this.agentsList = this.agentsList.filter(agent => agent.id !== id);
    }

    async runners(): Promise<RunnerDto[]> {
        this.calls.push('runners');
        return [...this.runnersList];
    }

    async createRunner(runner: NewRunnerDto): Promise<RunnerDto> {
        this.calls.push(`createRunner ${runner.name}`);
        const made: RunnerDto = {
            ...runner, id: `runner-${this.runnersList.length + 1}`,
            createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), revision: 1,
        };
        this.runnersList = [...this.runnersList, made];
        return made;
    }

    async patchRunner(id: string, patch: RunnerPatchDto): Promise<RunnerDto> {
        this.calls.push(`patchRunner ${id} ${Object.keys(patch).sort().join('+')}`);
        const at = this.runnersList.findIndex(runner => runner.id === id);
        if (at < 0) throw new Error(`no such runner: ${id}`);
        const next = { ...this.runnersList[at], ...patch, revision: this.runnersList[at].revision + 1 };
        this.runnersList = [...this.runnersList.slice(0, at), next, ...this.runnersList.slice(at + 1)];
        return next;
    }

    async deleteRunner(id: string): Promise<void> {
        this.calls.push(`deleteRunner ${id}`);
        this.runnersList = this.runnersList.filter(runner => runner.id !== id);
    }
}

/** The handle a name is reached by: lowercased, everything unsafe a dash, trimmed. */
const slugOf = (name: string): string => {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (slug || 'board').slice(0, 60).replace(/-+$/, '') || 'board';
};

/** A fake serving the board a document's content describes. */
export const fakeClientOf = (content: unknown, slug = 'board'): FakeHybridflowClient =>
    new FakeHybridflowClient(readBoardContent(content), slug);

/** A fake serving a board built with the plugin's own operations. */
export const fakeClientFor = (content: BoardContent, slug = 'board'): FakeHybridflowClient =>
    new FakeHybridflowClient(content, slug);

/** Re-exported so a test that builds a board does not have to reach past this module. */
export { ops };
