import { describe, expect, it, beforeEach } from 'vitest';
import { HybridflowApi } from './api.js';
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

// Records the calls HybridflowApi makes on the files client and answers canned boards — the analogue
// of the CvApi fake. The proxy's own contract (auth, actor, refusal without a store) is pinned on
// the Go side; what is pinned here is what this layer adds: trimming, and refusing what is not
// worth a round trip.
class FakeFiles {
    calls: { method: string; args: unknown[] }[] = [];

    private record(method: string, args: unknown[]): void {
        this.calls.push({ method, args });
    }

    private whole(handle: string, name = 'Major'): BoardWhole {
        return {
            board: { id: 'b1', name, slug: handle, createdAt: '', updatedAt: '', revision: 1, archived: false },
            flowNodes: [],
            flowNodeClasses: [],
            workflows: [],
            workflowClasses: [],
            cursor: 1,
        };
    }

    async listBoards(archived: boolean): Promise<{ boards: Board[] }> {
        this.record('listBoards', [archived]);
        return { boards: [] };
    }

    async createBoard(name: string): Promise<BoardWhole> {
        this.record('createBoard', [name]);
        return this.whole('major', name);
    }

    async getBoard(handle: string): Promise<BoardWhole> {
        this.record('getBoard', [handle]);
        return this.whole(handle);
    }

    async patchBoard(handle: string, patch: BoardPatch, ifMatch?: number): Promise<Board> {
        this.record('patchBoard', [handle, patch, ifMatch]);
        return { id: 'b1', name: 'Major', slug: handle, createdAt: '', updatedAt: '', revision: 2, archived: false };
    }

    async deleteBoard(handle: string): Promise<void> {
        this.record('deleteBoard', [handle]);
    }

    async createFlowNodes(handle: string, flowNodes: NewBoardFlowNode[]): Promise<{ flowNodes: BoardFlowNode[] }> {
        this.record('createFlowNodes', [handle, flowNodes]);
        return {
            flowNodes: flowNodes.map((card, i) => ({
                id: `card-${i}`, title: card.title ?? '', type: card.type ?? 'human',
                status: 'ready', createdAt: '', updatedAt: '', revision: 1,
            })),
        };
    }

    async getFlowNode(handle: string, id: string): Promise<BoardFlowNode> {
        this.record('getFlowNode', [handle, id]);
        return { id, title: 'Card', type: 'human', status: 'ready', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchFlowNode(handle: string, id: string, patch: BoardFlowNodePatch, ifMatch?: number): Promise<BoardFlowNode> {
        this.record('patchFlowNode', [handle, id, patch, ifMatch]);
        return { id, title: patch.title ?? '', type: 'human', status: 'ready', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteFlowNodes(handle: string, flowNodes: string[]): Promise<void> {
        this.record('deleteFlowNodes', [handle, flowNodes]);
    }

    async chainFlowNode(handle: string, id: string, flowNode: string): Promise<BoardFlowNode> {
        this.record('chainFlowNode', [handle, id, flowNode]);
        return { id, title: 'Card', type: 'human', status: 'ready', createdAt: '', updatedAt: '', revision: 2 };
    }

    async getFlowNodeUsage(handle: string, id: string): Promise<BoardUsageTotals> {
        this.record('getFlowNodeUsage', [handle, id]);
        return { reports: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    }

    async convertFlowNodeToClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        this.record('convertFlowNodeToClass', [handle, id]);
        return {
            id: 'class-1', title: 'Class', type: 'ai', versions: [],
            createdAt: '', updatedAt: '', revision: 1,
        };
    }

    async listFlowNodeClasses(): Promise<{ flowNodeClasses: BoardListedClass[] }> {
        this.record('listFlowNodeClasses', []);
        return { flowNodeClasses: [] };
    }

    async createFlowNodeClass(handle: string, flowNodeClass: NewBoardFlowNodeClass): Promise<BoardFlowNodeClass> {
        this.record('createFlowNodeClass', [handle, flowNodeClass]);
        return {
            id: 'class-1', title: flowNodeClass.title, type: flowNodeClass.type ?? 'human', versions: [],
            createdAt: '', updatedAt: '', revision: 1,
        };
    }

    async getFlowNodeClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        this.record('getFlowNodeClass', [handle, id]);
        return { id, title: 'Class', type: 'human', versions: [], createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchFlowNodeClass(
        handle: string, id: string, patch: BoardFlowNodeClassPatch, ifMatch?: number,
    ): Promise<BoardFlowNodeClass> {
        this.record('patchFlowNodeClass', [handle, id, patch, ifMatch]);
        return { id, title: 'Class', type: 'human', versions: [], createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<void> {
        this.record('deleteFlowNodeClasses', [handle, flowNodeClasses]);
    }

    async chainFlowNodeClass(handle: string, id: string, flowNode: string): Promise<BoardFlowNodeClass> {
        this.record('chainFlowNodeClass', [handle, id, flowNode]);
        return { id, title: 'Class', type: 'human', versions: [], createdAt: '', updatedAt: '', revision: 2 };
    }

    async createClassVersion(
        handle: string, classId: string, version: NewBoardClassVersion,
    ): Promise<BoardClassVersion> {
        this.record('createClassVersion', [handle, classId, version]);
        return { id: 'ver-1', number: 1, status: 'draft', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchClassVersion(
        handle: string, classId: string, versionId: string, patch: BoardClassVersionPatch, ifMatch?: number,
    ): Promise<BoardClassVersion> {
        this.record('patchClassVersion', [handle, classId, versionId, patch, ifMatch]);
        return { id: versionId, number: 1, status: 'draft', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteClassVersion(handle: string, classId: string, versionId: string): Promise<void> {
        this.record('deleteClassVersion', [handle, classId, versionId]);
    }

    async instantiateFlowNodeClass(
        handle: string, classId: string, request: BoardInstantiateRequest,
    ): Promise<{ flowNodes: BoardFlowNode[] }> {
        this.record('instantiateFlowNodeClass', [handle, classId, request]);
        return { flowNodes: [] };
    }

    async createWorkflow(handle: string, workflow: NewBoardWorkflow): Promise<BoardWorkflow> {
        this.record('createWorkflow', [handle, workflow]);
        return { id: 'wf-1', name: workflow.name ?? '', createdAt: '', updatedAt: '', revision: 1 };
    }

    async getWorkflow(handle: string, id: string): Promise<BoardWorkflow> {
        this.record('getWorkflow', [handle, id]);
        return { id, name: 'Sprint', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchWorkflow(
        handle: string, id: string, patch: BoardWorkflowPatch, ifMatch?: number,
    ): Promise<BoardWorkflow> {
        this.record('patchWorkflow', [handle, id, patch, ifMatch]);
        return { id, name: 'Sprint', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteWorkflows(handle: string, workflows: string[]): Promise<void> {
        this.record('deleteWorkflows', [handle, workflows]);
    }

    async listWorkflowClasses(): Promise<{ workflowClasses: BoardListedWorkflowClass[] }> {
        this.record('listWorkflowClasses', []);
        return { workflowClasses: [] };
    }

    async createWorkflowClass(handle: string, workflowClass: NewBoardWorkflowClass): Promise<BoardWorkflowClass> {
        this.record('createWorkflowClass', [handle, workflowClass]);
        return { id: 'wc-1', name: workflowClass.name ?? '', createdAt: '', updatedAt: '', revision: 1 };
    }

    async getWorkflowClass(handle: string, id: string): Promise<BoardWorkflowClass> {
        this.record('getWorkflowClass', [handle, id]);
        return { id, name: 'Sprint', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchWorkflowClass(
        handle: string, id: string, patch: BoardWorkflowClassPatch, ifMatch?: number,
    ): Promise<BoardWorkflowClass> {
        this.record('patchWorkflowClass', [handle, id, patch, ifMatch]);
        return { id, name: 'Sprint', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<void> {
        this.record('deleteWorkflowClasses', [handle, workflowClasses]);
    }

    async instantiateWorkflowClass(
        handle: string, id: string, request: BoardInstantiateRequest,
    ): Promise<{ workflow: BoardWorkflow; flowNodes: BoardFlowNode[] }> {
        this.record('instantiateWorkflowClass', [handle, id, request]);
        return {
            workflow: { id: 'wf-1', name: 'Sprint', createdAt: '', updatedAt: '', revision: 1 },
            flowNodes: [],
        };
    }

    async listAgents(): Promise<{ agents: BoardAgent[] }> {
        this.record('listAgents', []);
        return { agents: [] };
    }

    async createAgent(agent: NewBoardAgent): Promise<BoardAgent> {
        this.record('createAgent', [agent]);
        return {
            id: 'agent-1', name: agent.name, platform: agent.platform,
            createdAt: '', updatedAt: '', revision: 1,
        };
    }

    async getAgent(id: string): Promise<BoardAgent> {
        this.record('getAgent', [id]);
        return { id, name: 'Reviewer', platform: 'claude', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchAgent(id: string, patch: BoardAgentPatch, ifMatch?: number): Promise<BoardAgent> {
        this.record('patchAgent', [id, patch, ifMatch]);
        return { id, name: 'Reviewer', platform: 'claude', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteAgent(id: string): Promise<void> {
        this.record('deleteAgent', [id]);
    }

    async listRunners(): Promise<{ runners: BoardRunner[] }> {
        this.record('listRunners', []);
        return { runners: [] };
    }

    async createRunner(runner: NewBoardRunner): Promise<BoardRunner> {
        this.record('createRunner', [runner]);
        return { id: 'runner-1', name: runner.name, createdAt: '', updatedAt: '', revision: 1 };
    }

    async getRunner(id: string): Promise<BoardRunner> {
        this.record('getRunner', [id]);
        return { id, name: 'local', createdAt: '', updatedAt: '', revision: 1 };
    }

    async patchRunner(id: string, patch: BoardRunnerPatch, ifMatch?: number): Promise<BoardRunner> {
        this.record('patchRunner', [id, patch, ifMatch]);
        return { id, name: 'local', createdAt: '', updatedAt: '', revision: 2 };
    }

    async deleteRunner(id: string): Promise<void> {
        this.record('deleteRunner', [id]);
    }

    async getChanges(since?: number, board?: string, limit?: number): Promise<BoardChanges> {
        this.record('getChanges', [since, board, limit]);
        return { changes: [], cursor: since ?? 0, more: false };
    }

    async getHybridflowSchema(): Promise<{ version: number; migrations: unknown[] }> {
        this.record('getHybridflowSchema', []);
        return { version: 1, migrations: [] };
    }
}

describe('HybridflowApi', () => {
    let fake: FakeFiles;
    let api: HybridflowApi;

    beforeEach(() => {
        fake = new FakeFiles();
        api = new HybridflowApi(fake as unknown as WorkerClient);
    });

    it('creates a board under its trimmed name', async () => {
        const whole = await api.createBoard('  Major  ');
        expect(whole.board.slug).toBe('major');
        expect(fake.calls).toEqual([{ method: 'createBoard', args: ['Major'] }]);
    });

    it('refuses an empty board name without calling', async () => {
        await expect(api.createBoard('   ')).rejects.toThrow(/must not be empty/);
        expect(fake.calls).toHaveLength(0);
    });

    it('reads a board by its trimmed handle', async () => {
        await api.getBoard('  major  ');
        expect(fake.calls).toEqual([{ method: 'getBoard', args: ['major'] }]);
    });

    it('refuses an empty handle without calling', async () => {
        await expect(api.getBoard('')).rejects.toThrow(/must not be empty/);
        await expect(api.createFlowNodes('', [{ title: 'Card' }])).rejects.toThrow(/must not be empty/);
        await expect(api.patchFlowNode('', 'card-1', { title: 'x' })).rejects.toThrow(/must not be empty/);
        expect(fake.calls).toHaveLength(0);
    });

    it('adds cards in order and answers the ids they were given', async () => {
        const cards = [{ title: 'First', body: 'Do it.' }, { title: 'Second', type: 'human' }];
        const res = await api.createFlowNodes('major', cards);
        expect(res.flowNodes.map((c) => c.id)).toEqual(['card-0', 'card-1']);
        expect(fake.calls).toEqual([{ method: 'createFlowNodes', args: ['major', cards] }]);
    });

    it('refuses an empty card list without calling', async () => {
        await expect(api.createFlowNodes('major', [])).rejects.toThrow(/at least one card/);
        expect(fake.calls).toHaveLength(0);
    });

    it('patches a card, carrying If-Match where one was read', async () => {
        await api.patchFlowNode('major', 'card-1', { title: 'Renamed' }, 7);
        expect(fake.calls).toEqual([{ method: 'patchFlowNode', args: ['major', 'card-1', { title: 'Renamed' }, 7] }]);
    });

    it('patches without If-Match where no revision was read', async () => {
        await api.patchFlowNode('major', 'card-1', { status: 'ready' });
        expect(fake.calls).toEqual([{ method: 'patchFlowNode', args: ['major', 'card-1', { status: 'ready' }, undefined] }]);
    });

    it('refuses an empty card id and a patch naming nothing, without calling', async () => {
        await expect(api.patchFlowNode('major', '  ', { title: 'x' })).rejects.toThrow(/must not be empty/);
        await expect(api.patchFlowNode('major', 'card-1', {})).rejects.toThrow(/at least one/);
        expect(fake.calls).toHaveLength(0);
    });

    it('carries the service refusal out rather than wrapping it away', async () => {
        const refusing = new FakeFiles();
        refusing.getBoard = async () => {
            throw new Error('/hybridflow-runner/boards/major failed: 503 Service Unavailable — this worker names no hybridflow-store');
        };
        const refusingApi = new HybridflowApi(refusing as unknown as WorkerClient);
        await expect(refusingApi.getBoard('major')).rejects.toThrow(/names no hybridflow-store/);
    });

    it('lists boards, archived only when asked', async () => {
        await api.listBoards();
        await api.listBoards(true);
        expect(fake.calls).toEqual([
            { method: 'listBoards', args: [false] },
            { method: 'listBoards', args: [true] },
        ]);
    });

    it('patches a board and refuses a patch naming nothing', async () => {
        await api.patchBoard('major', { name: 'Majeur' }, 3);
        expect(fake.calls).toEqual([{ method: 'patchBoard', args: ['major', { name: 'Majeur' }, 3] }]);
        await expect(api.patchBoard('major', {})).rejects.toThrow(/at least one/);
    });

    it('deletes a board and answers what it deleted', async () => {
        await expect(api.deleteBoard('  major  ')).resolves.toEqual({ deleted: 'major' });
        expect(fake.calls).toEqual([{ method: 'deleteBoard', args: ['major'] }]);
        await expect(api.deleteBoard('')).rejects.toThrow(/must not be empty/);
    });

    it('reads one card, chains it, reads its usage and converts it to a class', async () => {
        await api.getFlowNode('major', 'card-1');
        await api.chainFlowNode('major', 'card-1', 'card-2');
        await api.chainFlowNode('major', 'card-1', '  ');
        await api.getFlowNodeUsage('major', 'card-1');
        await api.convertFlowNodeToClass('major', 'card-1');
        expect(fake.calls).toEqual([
            { method: 'getFlowNode', args: ['major', 'card-1'] },
            { method: 'chainFlowNode', args: ['major', 'card-1', 'card-2'] },
            { method: 'chainFlowNode', args: ['major', 'card-1', ''] },
            { method: 'getFlowNodeUsage', args: ['major', 'card-1'] },
            { method: 'convertFlowNodeToClass', args: ['major', 'card-1'] },
        ]);
        await expect(api.getFlowNode('major', '  ')).rejects.toThrow(/must not be empty/);
    });

    it('deletes cards and refuses an empty id list', async () => {
        await expect(api.deleteFlowNodes('major', ['card-1', ' card-2 '])).resolves.toEqual({
            deleted: ['card-1', 'card-2'],
        });
        expect(fake.calls).toEqual([{ method: 'deleteFlowNodes', args: ['major', ['card-1', 'card-2']] }]);
        await expect(api.deleteFlowNodes('major', [])).rejects.toThrow(/at least one card id/);
        await expect(api.deleteFlowNodes('major', ['  '])).rejects.toThrow(/at least one card id/);
    });

    it('creates, reads, patches, chains, deletes and instantiates node classes', async () => {
        await api.listFlowNodeClasses();
        await api.createFlowNodeClass('major', { title: '  Review  ', type: 'ai' });
        await api.getFlowNodeClass('major', 'class-1');
        await api.patchFlowNodeClass('major', 'class-1', { note: 'When to use it.' }, 2);
        await api.chainFlowNodeClass('major', 'class-1', 'class-2');
        await api.instantiateFlowNodeClass('major', 'class-1', { spot: { x: 0, y: 0 } });
        await api.deleteFlowNodeClasses('major', ['class-1']);
        expect(fake.calls.map((c) => c.method)).toEqual([
            'listFlowNodeClasses', 'createFlowNodeClass', 'getFlowNodeClass', 'patchFlowNodeClass',
            'chainFlowNodeClass', 'instantiateFlowNodeClass', 'deleteFlowNodeClasses',
        ]);
        expect(fake.calls[1].args[1]).toEqual({ title: 'Review', type: 'ai' });
        await expect(api.createFlowNodeClass('major', { title: '  ' })).rejects.toThrow(/needs a title/);
        await expect(api.patchFlowNodeClass('major', 'class-1', {})).rejects.toThrow(/at least one/);
        await expect(api.deleteFlowNodeClasses('major', [])).rejects.toThrow(/at least one class id/);
    });

    it('creates, patches and deletes class versions, refusing an empty version patch', async () => {
        await api.createClassVersion('major', 'class-1', { from: 'ver-1' });
        await api.patchClassVersion('major', 'class-1', 'ver-2', { status: 'published' }, 1);
        await expect(api.deleteClassVersion('major', 'class-1', 'ver-2')).resolves.toEqual({ deleted: 'ver-2' });
        expect(fake.calls.map((c) => c.method)).toEqual([
            'createClassVersion', 'patchClassVersion', 'deleteClassVersion',
        ]);
        await expect(api.patchClassVersion('major', 'class-1', 'ver-2', {})).rejects.toThrow(/at least one/);
        await expect(api.patchClassVersion('major', 'class-1', '  ', { status: 'published' })).rejects.toThrow(/must not be empty/);
    });

    it('creates, reads, patches and deletes workflows, refusing an empty patch and id list', async () => {
        await api.createWorkflow('major', { name: 'Sprint', flowNodes: ['card-1'] });
        await api.getWorkflow('major', 'wf-1');
        await api.patchWorkflow('major', 'wf-1', { name: 'Release' });
        await expect(api.deleteWorkflows('major', ['wf-1'])).resolves.toEqual({ deleted: ['wf-1'] });
        expect(fake.calls.map((c) => c.method)).toEqual([
            'createWorkflow', 'getWorkflow', 'patchWorkflow', 'deleteWorkflows',
        ]);
        await expect(api.patchWorkflow('major', 'wf-1', {})).rejects.toThrow(/at least one/);
        await expect(api.deleteWorkflows('major', [])).rejects.toThrow(/at least one workflow id/);
    });

    it('creates, reads, patches, deletes and instantiates workflow classes', async () => {
        await api.listWorkflowClasses();
        await api.createWorkflowClass('major', { name: 'Sprint', classes: ['class-1'] });
        await api.getWorkflowClass('major', 'wc-1');
        await api.patchWorkflowClass('major', 'wc-1', { name: 'Release' });
        await api.instantiateWorkflowClass('major', 'wc-1', {});
        await api.deleteWorkflowClasses('major', ['wc-1']);
        expect(fake.calls.map((c) => c.method)).toEqual([
            'listWorkflowClasses', 'createWorkflowClass', 'getWorkflowClass',
            'patchWorkflowClass', 'instantiateWorkflowClass', 'deleteWorkflowClasses',
        ]);
        await expect(api.patchWorkflowClass('major', 'wc-1', {})).rejects.toThrow(/at least one/);
        await expect(api.deleteWorkflowClasses('major', [])).rejects.toThrow(/at least one workflow class id/);
    });

    it('creates, reads, patches and deletes agents, refusing an empty name, platform and patch', async () => {
        await api.listAgents();
        await api.createAgent({ name: '  Reviewer  ', platform: '  claude  ', model: 'opus' });
        await api.getAgent('agent-1');
        await api.patchAgent('agent-1', { model: 'sonnet' }, 2);
        await expect(api.deleteAgent('agent-1')).resolves.toEqual({ deleted: 'agent-1' });
        expect(fake.calls.map((c) => c.method)).toEqual([
            'listAgents', 'createAgent', 'getAgent', 'patchAgent', 'deleteAgent',
        ]);
        expect(fake.calls[1].args[0]).toEqual({ name: 'Reviewer', platform: 'claude', model: 'opus' });
        await expect(api.createAgent({ name: '', platform: 'claude' })).rejects.toThrow(/needs a name/);
        await expect(api.createAgent({ name: 'Reviewer', platform: '  ' })).rejects.toThrow(/needs a platform/);
        await expect(api.patchAgent('agent-1', {})).rejects.toThrow(/at least one/);
        await expect(api.getAgent('  ')).rejects.toThrow(/must not be empty/);
    });

    it('creates, reads, patches and deletes runners, refusing an empty name and patch', async () => {
        await api.listRunners();
        await api.createRunner({ name: '  local  ' });
        await api.getRunner('runner-1');
        await api.patchRunner('runner-1', { name: 'remote' });
        await expect(api.deleteRunner('runner-1')).resolves.toEqual({ deleted: 'runner-1' });
        expect(fake.calls.map((c) => c.method)).toEqual([
            'listRunners', 'createRunner', 'getRunner', 'patchRunner', 'deleteRunner',
        ]);
        expect(fake.calls[1].args[0]).toEqual({ name: 'local' });
        await expect(api.createRunner({ name: '  ' })).rejects.toThrow(/needs a name/);
        await expect(api.patchRunner('runner-1', {})).rejects.toThrow(/at least one/);
    });

    it('reads changes and the schema', async () => {
        await api.getChanges(12, 'b1', 50);
        await api.getSchema();
        expect(fake.calls).toEqual([
            { method: 'getChanges', args: [12, 'b1', 50] },
            { method: 'getHybridflowSchema', args: [] },
        ]);
    });
});
