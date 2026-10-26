import type { TokenProvider } from './auth.js';
import type {
    Board,
    BoardAgent,
    BoardAgentPatch,
    BoardAgentVersion,
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
} from './hybridflow/model.js';
import type { Config } from './config.js';
import type {
    ActionResult,
    Document,
    FileDto,
    GitResult,
    GitStatus,
    SearchResponse,
} from './types.js';

export class WorkerError extends Error {
    constructor(message: string, readonly status: number, readonly statusText: string) {
        super(message);
        this.name = 'WorkerError';
    }
}

/**
 * What a failed boards call reports: the status plus what the other end said about it. A bare
 * status is unactionable — a 503 because no hybridflow-store is configured and a 409 because a
 * revision moved on want different answers — so the body travels. It is plain text from
 * worker's own refusals and `{"error": "…"}` from the store's; the wrapper is unwrapped so
 * the turn reads the sentence, not the envelope.
 */
async function boardsFailure(path: string, res: Response): Promise<string> {
    const base = `${path} failed: ${res.status} ${res.statusText}`;
    let detail = '';
    try {
        detail = (await res.text()).trim().slice(0, 500);
    } catch {
        return base;
    }
    if (!detail) return base;
    try {
        const parsed = JSON.parse(detail) as { error?: unknown };
        if (typeof parsed?.error === 'string' && parsed.error.trim()) detail = parsed.error.trim().slice(0, 500);
    } catch {
        // Not JSON — the plain-text refusal, carried as it stands.
    }
    return `${base} — ${detail}`;
}

/**
 * Apply an exact-string replacement to a text document — the core of `files_edit`, exported for
 * tests. `oldString` must occur exactly once unless `replaceAll`; errors are phrased for the model
 * so it can self-correct (extend the string to disambiguate, or pass `replaceAll`).
 */
export function applyTextEdit(text: string, oldString: string, newString: string, replaceAll: boolean): { text: string; replacements: number } {
    if (oldString === '') throw new Error('oldString must not be empty.');
    if (oldString === newString) throw new Error('oldString and newString are identical — nothing to change.');
    const occurrences = text.split(oldString).length - 1;
    if (occurrences === 0) {
        throw new Error('oldString not found in the file. It must match exactly, including whitespace and indentation.');
    }
    if (occurrences > 1 && !replaceAll) {
        throw new Error(`oldString occurs ${occurrences} times. Extend it with surrounding context to make it unique, or pass replaceAll: true.`);
    }
    return { text: text.split(oldString).join(newString), replacements: occurrences };
}

/**
 * Node-native client for the worker HTTP API. Mirrors the endpoint surface of
 * reference/kiao-worker `WorkerClient`, but uses global `fetch`/`FormData` (no XHR) and
 * injects the bearer token from a TokenProvider — so it runs in a plain Node process.
 */
export class WorkerClient {
    private readonly baseUrl: string;

    constructor(
        config: Config,
        private readonly tokens: TokenProvider,
    ) {
        this.baseUrl = config.workerUrl.replace(/\/$/, '');
    }

    private async authHeaders(): Promise<Record<string, string>> {
        const token = await this.tokens.getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    private url(path: string, params: Record<string, string | undefined> = {}): string {
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) url.searchParams.append(key, value);
        }
        return url.toString();
    }

    private async req(path: string, init: RequestInit = {}, params: Record<string, string | undefined> = {}): Promise<Response> {
        const headers = { ...(await this.authHeaders()), ...(init.headers as Record<string, string> | undefined) };
        return fetch(this.url(path, params), { ...init, headers });
    }

    private async json<T>(path: string, init?: RequestInit, params?: Record<string, string | undefined>): Promise<T> {
        const res = await this.req(path, init, params);
        if (!res.ok) throw new WorkerError(`${path} failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
        return res.json() as Promise<T>;
    }

    // ── Files ─────────────────────────────────────────────────────────────────

    listFiles(path: string): Promise<FileDto[]> {
        return this.json<FileDto[]>('/list', undefined, { path });
    }

    getFileInfo(path: string): Promise<FileDto> {
        return this.json<FileDto>('/info', undefined, { path });
    }

    async getFileText(path: string): Promise<string> {
        const res = await this.req('/getFile', undefined, { path });
        if (!res.ok) throw new WorkerError(`getFile failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
        return res.text();
    }

    async getFileJson<T>(path: string): Promise<T> {
        const res = await this.req('/getFile', undefined, { path });
        if (!res.ok) throw new WorkerError(`getFile failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
        return res.json() as Promise<T>;
    }

    /** True if the file exists (a successful GET), false on 404. */
    async exists(path: string): Promise<boolean> {
        const res = await this.req('/getFile', undefined, { path });
        if (res.ok) {
            await res.arrayBuffer();
            return true;
        }
        if (res.status === 404) return false;
        throw new WorkerError(`exists check failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
    }

    /**
     * Create or overwrite a text file. PUT /update (replaces an existing file); if the file
     * does not exist yet (404), fall back to POST /upload into the parent directory.
     */
    async writeFile(path: string, content: string, contentType = 'application/octet-stream'): Promise<void> {
        const blob = new Blob([content], { type: contentType });
        const filename = path.split('/').pop() || 'file';

        const updateForm = new FormData();
        updateForm.append('file', blob, filename);
        const updateRes = await this.req('/update', { method: 'PUT', body: updateForm }, { path });
        if (updateRes.ok) return;

        if (updateRes.status === 404 || updateRes.status === 500) {
            const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
            const uploadForm = new FormData();
            uploadForm.append('path', parentPath);
            uploadForm.append('file', blob, filename);
            const uploadRes = await this.req('/upload', { method: 'POST', body: uploadForm });
            if (!uploadRes.ok) {
                throw new WorkerError(`upload failed: ${uploadRes.status} ${uploadRes.statusText}`, uploadRes.status, uploadRes.statusText);
            }
            return;
        }
        throw new WorkerError(`update failed: ${updateRes.status} ${updateRes.statusText}`, updateRes.status, updateRes.statusText);
    }

    /**
     * Surgical text edit: replace an exact string in an existing file (server-side
     * read–modify–write), so a small change to a large file never requires re-sending the whole
     * content. Returns the replacement count and the new size for a cheap integrity check.
     */
    async editFile(path: string, oldString: string, newString: string, replaceAll = false): Promise<{ path: string; replacements: number; bytes: number }> {
        const original = await this.getFileText(path);
        const { text, replacements } = applyTextEdit(original, oldString, newString, replaceAll);
        await this.writeFile(path, text);
        return { path, replacements, bytes: text.length };
    }

    saveJson<T>(path: string, content: T): Promise<void> {
        return this.writeFile(path, JSON.stringify(content, null, 2), 'application/json');
    }

    async createFolder(path: string): Promise<void> {
        const res = await this.req('/createFolder', { method: 'POST' }, { path });
        if (!res.ok) throw new WorkerError(`createFolder failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
    }

    /** Delete a file, or a directory with everything under it. Missing is not an error. */
    async delete(path: string): Promise<void> {
        const res = await this.req('/delete', { method: 'DELETE' }, { path });
        if (!res.ok) throw new WorkerError(`delete failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
    }

    /**
     * Delete many paths in one request. The server applies them in order and stops at the first
     * failure, so a partial delete is possible — the caller is told how many landed.
     */
    async deleteBatch(paths: string[]): Promise<void> {
        const res = await this.req('/deleteBatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!res.ok) throw new WorkerError(`deleteBatch failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
    }

    async rename(path: string, newPath: string): Promise<void> {
        const res = await this.req('/rename', { method: 'POST' }, { path, newPath });
        if (!res.ok) throw new WorkerError(`rename failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
    }

    /** Searches under a directory. See `files_search` in tools-files.ts for the query language. */
    search(directoryPath: string, query: string): Promise<SearchResponse> {
        return this.json<SearchResponse>('/search', undefined, { path: directoryPath, query });
    }

    // ── Documents ───────────────────────────────────────────────────────────────

    getDocument<T>(path: string): Promise<Document<T>> {
        return this.getFileJson<Document<T>>(path);
    }

    // ── Boards (hybridflow, through the agents surface) ─────────────────────────
    //
    // worker proxies these to the hybridflow-store with its service token, attributing the
    // change to this turn's owner. The store's answers — including its refusals — cross untouched.
    // play, played, settle, the usage report and the runner heartbeat are the runner's alone and
    // are not proxied, so there is no method here that reaches them.

    private async boardsJson<T>(
        method: string,
        path: string,
        body?: unknown,
        extraHeaders?: Record<string, string>,
        params?: Record<string, string | undefined>,
    ): Promise<T> {
        const res = await this.req(path, {
            method,
            headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }, params);
        if (!res.ok) throw new WorkerError(await boardsFailure(path, res), res.status, res.statusText);
        return res.json() as Promise<T>;
    }

    /** A boards call answered 204: there is nothing to read, only the refusal to report. */
    private async boardsVoid(method: string, path: string, body?: unknown): Promise<void> {
        const res = await this.req(path, {
            method,
            headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new WorkerError(await boardsFailure(path, res), res.status, res.statusText);
    }

    private static ifMatch(ifMatch?: number): Record<string, string> | undefined {
        return ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : undefined;
    }

    private static boardPath(handle: string): string {
        return `/hybridflow-runner/boards/${encodeURIComponent(handle)}`;
    }

    listBoards(archived = false): Promise<{ boards: Board[] }> {
        return this.boardsJson<{ boards: Board[] }>(
            'GET', '/hybridflow-runner/boards', undefined, undefined,
            archived ? { archived: '1' } : {},
        );
    }

    createBoard(name: string): Promise<BoardWhole> {
        return this.boardsJson<BoardWhole>('POST', '/hybridflow-runner/boards', { name });
    }

    getBoard(handle: string): Promise<BoardWhole> {
        return this.boardsJson<BoardWhole>('GET', WorkerClient.boardPath(handle));
    }

    patchBoard(handle: string, patch: BoardPatch, ifMatch?: number): Promise<Board> {
        return this.boardsJson<Board>(
            'PATCH', WorkerClient.boardPath(handle), patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteBoard(handle: string): Promise<void> {
        return this.boardsVoid('DELETE', WorkerClient.boardPath(handle));
    }

    createFlowNodes(handle: string, flowNodes: NewBoardFlowNode[]): Promise<{ flowNodes: BoardFlowNode[] }> {
        return this.boardsJson<{ flowNodes: BoardFlowNode[] }>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-nodes`, { flowNodes },
        );
    }

    getFlowNode(handle: string, id: string): Promise<BoardFlowNode> {
        return this.boardsJson<BoardFlowNode>(
            'GET', `${WorkerClient.boardPath(handle)}/flow-nodes/${encodeURIComponent(id)}`,
        );
    }

    patchFlowNode(handle: string, id: string, patch: BoardFlowNodePatch, ifMatch?: number): Promise<BoardFlowNode> {
        return this.boardsJson<BoardFlowNode>(
            'PATCH', `${WorkerClient.boardPath(handle)}/flow-nodes/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteFlowNodes(handle: string, flowNodes: string[]): Promise<void> {
        return this.boardsVoid('DELETE', `${WorkerClient.boardPath(handle)}/flow-nodes`, { flowNodes });
    }

    chainFlowNode(handle: string, id: string, flowNode: string): Promise<BoardFlowNode> {
        return this.boardsJson<BoardFlowNode>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-nodes/${encodeURIComponent(id)}/chain`, { flowNode },
        );
    }

    getFlowNodeUsage(handle: string, id: string): Promise<BoardUsageTotals> {
        return this.boardsJson<BoardUsageTotals>(
            'GET', `${WorkerClient.boardPath(handle)}/flow-nodes/${encodeURIComponent(id)}/usage`,
        );
    }

    convertFlowNodeToClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        return this.boardsJson<BoardFlowNodeClass>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-nodes/${encodeURIComponent(id)}/to-class`, {},
        );
    }

    listFlowNodeClasses(): Promise<{ flowNodeClasses: BoardListedClass[] }> {
        return this.boardsJson<{ flowNodeClasses: BoardListedClass[] }>('GET', '/hybridflow-runner/flow-node-classes');
    }

    createFlowNodeClass(handle: string, flowNodeClass: NewBoardFlowNodeClass): Promise<BoardFlowNodeClass> {
        return this.boardsJson<BoardFlowNodeClass>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-node-classes`, flowNodeClass,
        );
    }

    getFlowNodeClass(handle: string, id: string): Promise<BoardFlowNodeClass> {
        return this.boardsJson<BoardFlowNodeClass>(
            'GET', `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(id)}`,
        );
    }

    patchFlowNodeClass(
        handle: string, id: string, patch: BoardFlowNodeClassPatch, ifMatch?: number,
    ): Promise<BoardFlowNodeClass> {
        return this.boardsJson<BoardFlowNodeClass>(
            'PATCH', `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteFlowNodeClasses(handle: string, flowNodeClasses: string[]): Promise<void> {
        return this.boardsVoid(
            'DELETE', `${WorkerClient.boardPath(handle)}/flow-node-classes`, { flowNodeClasses },
        );
    }

    chainFlowNodeClass(handle: string, id: string, flowNode: string): Promise<BoardFlowNodeClass> {
        return this.boardsJson<BoardFlowNodeClass>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(id)}/chain`,
            { flowNode },
        );
    }

    createClassVersion(
        handle: string, classId: string, version: NewBoardClassVersion,
    ): Promise<BoardClassVersion> {
        return this.boardsJson<BoardClassVersion>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(classId)}/versions`,
            version,
        );
    }

    patchClassVersion(
        handle: string, classId: string, versionId: string, patch: BoardClassVersionPatch, ifMatch?: number,
    ): Promise<BoardClassVersion> {
        return this.boardsJson<BoardClassVersion>(
            'PATCH',
            `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(classId)}/versions/${encodeURIComponent(versionId)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteClassVersion(handle: string, classId: string, versionId: string): Promise<void> {
        return this.boardsVoid(
            'DELETE',
            `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(classId)}/versions/${encodeURIComponent(versionId)}`,
        );
    }

    instantiateFlowNodeClass(
        handle: string, classId: string, request: BoardInstantiateRequest,
    ): Promise<{ flowNodes: BoardFlowNode[] }> {
        return this.boardsJson<{ flowNodes: BoardFlowNode[] }>(
            'POST', `${WorkerClient.boardPath(handle)}/flow-node-classes/${encodeURIComponent(classId)}/instantiate`,
            request,
        );
    }

    createWorkflow(handle: string, workflow: NewBoardWorkflow): Promise<BoardWorkflow> {
        return this.boardsJson<BoardWorkflow>(
            'POST', `${WorkerClient.boardPath(handle)}/workflows`, workflow,
        );
    }

    getWorkflow(handle: string, id: string): Promise<BoardWorkflow> {
        return this.boardsJson<BoardWorkflow>(
            'GET', `${WorkerClient.boardPath(handle)}/workflows/${encodeURIComponent(id)}`,
        );
    }

    patchWorkflow(handle: string, id: string, patch: BoardWorkflowPatch, ifMatch?: number): Promise<BoardWorkflow> {
        return this.boardsJson<BoardWorkflow>(
            'PATCH', `${WorkerClient.boardPath(handle)}/workflows/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteWorkflows(handle: string, workflows: string[]): Promise<void> {
        return this.boardsVoid('DELETE', `${WorkerClient.boardPath(handle)}/workflows`, { workflows });
    }

    listWorkflowClasses(): Promise<{ workflowClasses: BoardListedWorkflowClass[] }> {
        return this.boardsJson<{ workflowClasses: BoardListedWorkflowClass[] }>(
            'GET', '/hybridflow-runner/workflow-classes',
        );
    }

    createWorkflowClass(handle: string, workflowClass: NewBoardWorkflowClass): Promise<BoardWorkflowClass> {
        return this.boardsJson<BoardWorkflowClass>(
            'POST', `${WorkerClient.boardPath(handle)}/workflow-classes`, workflowClass,
        );
    }

    getWorkflowClass(handle: string, id: string): Promise<BoardWorkflowClass> {
        return this.boardsJson<BoardWorkflowClass>(
            'GET', `${WorkerClient.boardPath(handle)}/workflow-classes/${encodeURIComponent(id)}`,
        );
    }

    patchWorkflowClass(
        handle: string, id: string, patch: BoardWorkflowClassPatch, ifMatch?: number,
    ): Promise<BoardWorkflowClass> {
        return this.boardsJson<BoardWorkflowClass>(
            'PATCH', `${WorkerClient.boardPath(handle)}/workflow-classes/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteWorkflowClasses(handle: string, workflowClasses: string[]): Promise<void> {
        return this.boardsVoid(
            'DELETE', `${WorkerClient.boardPath(handle)}/workflow-classes`, { workflowClasses },
        );
    }

    instantiateWorkflowClass(
        handle: string, id: string, request: BoardInstantiateRequest,
    ): Promise<{ workflow: BoardWorkflow; flowNodes: BoardFlowNode[] }> {
        return this.boardsJson<{ workflow: BoardWorkflow; flowNodes: BoardFlowNode[] }>(
            'POST', `${WorkerClient.boardPath(handle)}/workflow-classes/${encodeURIComponent(id)}/instantiate`,
            request,
        );
    }

    listAgents(includeArchived = false): Promise<{ agents: BoardAgent[] }> {
        return this.boardsJson<{ agents: BoardAgent[] }>('GET', `/hybridflow-runner/agents${includeArchived ? '?archived=true' : ''}`);
    }

    createAgent(agent: NewBoardAgent): Promise<BoardAgent> {
        return this.boardsJson<BoardAgent>('POST', '/hybridflow-runner/agents', agent);
    }

    getAgent(id: string): Promise<BoardAgent> {
        return this.boardsJson<BoardAgent>('GET', `/hybridflow-runner/agents/${encodeURIComponent(id)}`);
    }

    patchAgent(id: string, patch: BoardAgentPatch, ifMatch?: number): Promise<BoardAgent> {
        return this.boardsJson<BoardAgent>(
            'PATCH', `/hybridflow-runner/agents/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteAgent(id: string): Promise<void> {
        return this.boardsVoid('DELETE', `/hybridflow-runner/agents/${encodeURIComponent(id)}`);
    }

    publishAgent(id: string, ifMatch?: number): Promise<BoardAgent> {
        return this.boardsJson<BoardAgent>('POST', `/hybridflow-runner/agents/${encodeURIComponent(id)}/publish`, {}, WorkerClient.ifMatch(ifMatch));
    }

    agentVersions(id: string): Promise<{ versions: BoardAgentVersion[] }> {
        return this.boardsJson<{ versions: BoardAgentVersion[] }>('GET', `/hybridflow-runner/agents/${encodeURIComponent(id)}/versions`);
    }

    listRunners(): Promise<{ runners: BoardRunner[] }> {
        return this.boardsJson<{ runners: BoardRunner[] }>('GET', '/hybridflow-runner/runners');
    }

    createRunner(runner: NewBoardRunner): Promise<BoardRunner> {
        return this.boardsJson<BoardRunner>('POST', '/hybridflow-runner/runners', runner);
    }

    getRunner(id: string): Promise<BoardRunner> {
        return this.boardsJson<BoardRunner>('GET', `/hybridflow-runner/runners/${encodeURIComponent(id)}`);
    }

    patchRunner(id: string, patch: BoardRunnerPatch, ifMatch?: number): Promise<BoardRunner> {
        return this.boardsJson<BoardRunner>(
            'PATCH', `/hybridflow-runner/runners/${encodeURIComponent(id)}`,
            patch, WorkerClient.ifMatch(ifMatch),
        );
    }

    deleteRunner(id: string): Promise<void> {
        return this.boardsVoid('DELETE', `/hybridflow-runner/runners/${encodeURIComponent(id)}`);
    }

    /** What happened after a cursor. Never held: an MCP call answers, it does not wait. */
    getChanges(since?: number, board?: string, limit?: number): Promise<BoardChanges> {
        return this.boardsJson<BoardChanges>(
            'GET', '/hybridflow-runner/changes', undefined, undefined,
            {
                since: since !== undefined ? String(since) : undefined,
                board: board ? board : undefined,
                limit: limit !== undefined ? String(limit) : undefined,
            },
        );
    }

    getHybridflowSchema(): Promise<{ version: number; migrations: unknown[] }> {
        return this.boardsJson<{ version: number; migrations: unknown[] }>('GET', '/hybridflow-runner/schema');
    }

    // ── File actions ──────────────────────────────────────────────────────────

    /**
     * Run a registered file action on a path.
     *
     * worker owns the registry — which actions exist, where they apply, and which service
     * implements each — so a caller names one by id and never learns the provider's URL; the
     * service forwards the run with the caller's own bearer token. A refused operation comes back
     * as `ok: false` with a reason, not as an error status.
     */
    async runAction(id: string, path: string, params: Record<string, unknown> = {}): Promise<ActionResult> {
        const res = await this.req('/actions/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, path, params }),
        });
        // The only thing missing from this endpoint is the action itself, and saying so beats
        // "404": a worker with no manifest (KIAO_WORKER_ACTIONS_PATH unset, which is
        // the default outside production) registers none at all.
        if (res.status === 404) {
            throw new WorkerError(
                `No action '${id}' is registered on this worker — it serves whatever its action manifest declares, and an instance started without one registers nothing.`,
                res.status,
                res.statusText,
            );
        }
        if (!res.ok) throw new WorkerError(`/actions/run failed: ${res.status} ${res.statusText}`, res.status, res.statusText);
        return res.json() as Promise<ActionResult>;
    }

    // ── Git ───────────────────────────────────────────────────────────────────

    gitStatus(): Promise<GitStatus> {
        return this.json<GitStatus>('/git/status');
    }

    private gitAction(endpoint: string, path: string): Promise<GitResult> {
        return this.json<GitResult>(endpoint, { method: 'POST' }, { path });
    }

    gitStage(path: string): Promise<GitResult> {
        return this.gitAction('/git/stage', path);
    }

    gitUnstage(path: string): Promise<GitResult> {
        return this.gitAction('/git/unstage', path);
    }

    gitRevert(path: string): Promise<GitResult> {
        return this.gitAction('/git/revert', path);
    }

    gitCommit(message: string, amend = false): Promise<GitResult> {
        return this.json<GitResult>('/git/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, amend }),
        });
    }

    gitPush(): Promise<GitResult> {
        return this.json<GitResult>('/git/push', { method: 'POST' });
    }

    gitPull(): Promise<GitResult> {
        return this.json<GitResult>('/git/pull', { method: 'POST' });
    }
}
