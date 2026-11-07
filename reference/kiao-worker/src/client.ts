import type { AgentProfilesState, AgentProfilesDocument, AgentProfileModelOption, AgentProfileSecret, AgentProfileConnectionDiagnostic } from './agent-profile-types';
import { FileDto, DiskUsage, StoreInfo, SearchResponse, ScopeResponse, Document, GitStatus, GitBranches, GitResult, LinkFixReport, MoveBatchRequest, CopyBatchRequest, CopyResult, ActionDescriptor, ActionResult, ReindexResult, StagingArea, UnzipResult, FileOptimizations, DeduplicateResult } from './types';
import { AgentUsage, AgentOptions, AgentAttachment, AgentAuthStatus, AgentLoginResult, AgentDeviceLoginStatus, AgentConversation, AgentConversationCreate, AgentConversationDetail, AgentConversationFork, AgentConversationPatch, AgentChainRun, RunnerIdentity } from './agent-types';
import { Toolbox, ToolboxJob } from './toolbox-types';
import { MediaJob, MediaSegment } from './media-types';

export class WorkerError extends Error {
    response: { status: number; statusText: string };

    constructor(message: string, status: number, statusText: string) {
        super(message);
        this.response = { status, statusText };
    }
}

/**
 * The `folder` query parameter every Git endpoint takes, left out entirely when the caller means
 * the store as a whole — an empty parameter and an absent one mean the same thing to the service,
 * and leaving it out keeps the request URL of a store-wide call unchanged.
 */
const gitFolder = (folder?: string): Record<string, string> => (folder ? { folder } : {});

export class WorkerClient {
    private baseUrl: string;
    private fetch: typeof fetch;
    private getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;

    constructor(baseUrl: string, customFetch?: typeof fetch, getHeaders?: () => Promise<Record<string, string>> | Record<string, string>) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.fetch = customFetch || window.fetch.bind(window);
        this.getHeaders = getHeaders;
    }

    private getUrl(path: string, params: Record<string, string> = {}): string {
        const url = new URL(`${this.baseUrl}${path}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });
        return url.toString();
    }

    async listFiles(path: string): Promise<FileDto[]> {
        const response = await this.fetch(this.getUrl('/list', { path }), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`List files failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async getFileText(path: string): Promise<string> {
        const response = await this.fetch(this.getUrl('/getFile', { path }));
        if (!response.ok) throw new WorkerError(`Get file failed: ${response.statusText}`, response.status, response.statusText);
        return response.text();
    }

    async getFileJson<T>(path: string, options?: Pick<RequestInit, 'cache'>): Promise<T> {
        const response = await this.fetch(this.getUrl('/getFile', { path }), options);
        if (!response.ok) throw new WorkerError(`Get file json failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async getFileBlob(path: string): Promise<Blob> {
        const response = await this.fetch(this.getUrl('/getFile', { path }));
        if (!response.ok) throw new WorkerError(`Get file blob failed: ${response.statusText}`, response.status, response.statusText);
        return response.blob();
    }

    async getFileResponse(path: string): Promise<Response> {
        const response = await this.fetch(this.getUrl('/getFile', { path }));
        if (!response.ok) throw new WorkerError(`Get file response failed: ${response.statusText}`, response.status, response.statusText);
        return response;
    }

    async getFileMetadata(path: string): Promise<FileDto> {
        const response = await this.fetch(this.getUrl('/info', { path }));
        if (!response.ok) throw new WorkerError(`Get file metadata failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async createFolder(path: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/createFolder', { path }), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Create folder failed: ${response.statusText}`, response.status, response.statusText);
    }

    /**
     * Everything under each of `paths`, in one round trip — what removing them would take with it.
     *
     * A client must never walk the store itself to answer that: one request per directory is
     * thousands of round trips on a folder holding a `node_modules`, paid before the user has even
     * confirmed. The server walks once and stops at its cap, so a huge scope comes back as a prefix
     * plus `truncated` rather than as an enumeration neither end can use.
     *
     * A path that is not there contributes nothing, exactly as deleting it succeeds.
     */
    async listRecursive(paths: string[]): Promise<ScopeResponse> {
        const url = new URL(`${this.baseUrl}/listRecursive`);
        paths.forEach(p => url.searchParams.append('path', p)); // repeated, so a selection is one request
        const response = await this.fetch(url.toString(), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Recursive list failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async delete(path: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/delete', { path }), { method: 'DELETE' });
        if (!response.ok) throw new WorkerError(`Delete failed: ${response.statusText}`, response.status, response.statusText);
    }

    async deleteBatch(paths: string[]): Promise<LinkFixReport[]> {
        const response = await this.fetch(this.getUrl('/deleteBatch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!response.ok) throw new WorkerError(`Delete batch failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async rename(path: string, newPath: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/rename', { path, newPath }), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Rename failed: ${response.statusText}`, response.status, response.statusText);
    }

    async moveBatch(pathsOrRequest: string[] | MoveBatchRequest, targetFolder?: string): Promise<LinkFixReport[]> {
        let payload: MoveBatchRequest;
        if (Array.isArray(pathsOrRequest)) {
            payload = { paths: pathsOrRequest, targetFolder };
        } else {
            payload = pathsOrRequest;
        }
        const response = await this.fetch(this.getUrl('/moveBatch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new WorkerError(`Move batch failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Copies whole entries server-side — a file with its subsidiaries, or a directory with
     * everything under it — in one round trip. The service resolves name clashes with a
     * " (copy)" suffix and never overwrites, so the returned `to` is where each entry landed.
     * Copying a folder into itself is refused with a 400 rather than recursing forever.
     */
    async copyBatch(pathsOrRequest: string[] | CopyBatchRequest, targetFolder?: string): Promise<CopyResult[]> {
        let payload: CopyBatchRequest;
        if (Array.isArray(pathsOrRequest)) {
            payload = { paths: pathsOrRequest, targetFolder };
        } else {
            payload = pathsOrRequest;
        }
        const response = await this.fetch(this.getUrl('/copyBatch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new WorkerError(`Copy batch failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async update(path: string, content: Blob | File | string, options: { filename?: string, headers?: Record<string, string> } = {}): Promise<void> {
        const formData = new FormData();
        // Determine file name, fallback to "file"
        const filename = path.split('/').pop() || 'file';

        if (content instanceof File) {
            formData.append('file', content);
        } else if (content instanceof Blob) {
            formData.append('file', content, filename);
        } else {
            formData.append('file', new Blob([content]), filename);
        }

        const requestInit: RequestInit = {
            method: 'PUT',
            body: formData,
            headers: options.headers || {}
        };

        const response = await this.fetch(this.getUrl('/update', { path }), requestInit);

        // Handling the fallback logic: if update fails (404/500), try upload
        if (response.status === 404 || response.status === 500) {
            // For upload, we need the PARENT path
            const parentPath = path.substring(0, path.lastIndexOf('/'));
            await this.upload(parentPath, content, { filename, headers: options.headers });
            return;
        }

        if (!response.ok) throw new WorkerError(`Update failed: ${response.statusText}`, response.status, response.statusText);
    }

    async upload(parentPath: string, content: Blob | File | string, options: { filename?: string, headers?: Record<string, string>, onProgress?: (e: ProgressEvent) => void } = {}): Promise<void> {
        const formData = new FormData();
        formData.append('path', parentPath);

        const finalFilename = options.filename || (content instanceof File ? (content as File).name : 'file');

        if (content instanceof File) {
            formData.append('file', content);
        } else if (content instanceof Blob) {
            formData.append('file', content, finalFilename);
        } else {
            formData.append('file', new Blob([content]), finalFilename);
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', this.getUrl('/upload'));

            const applyHeaders = async () => {
                const defaultHeaders = this.getHeaders ? await this.getHeaders() : {};
                const finalHeaders = { ...defaultHeaders, ...options.headers };

                Object.entries(finalHeaders).forEach(([key, value]) => {
                    xhr.setRequestHeader(key, value);
                });
            };

            applyHeaders().then(() => {
                if (options.onProgress) {
                    xhr.upload.addEventListener('progress', options.onProgress);
                }

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new WorkerError(`Upload failed: ${xhr.statusText}`, xhr.status, xhr.statusText));
                    }
                };

                xhr.onerror = () => reject(new WorkerError("Upload network error", 0, "Network Error"));

                xhr.send(formData);
            }).catch(reject);
        });
    }

    /**
     * Searches under a directory. `query` is a small language rather than a plain string — see
     * worker/PROTOCOL.md:
     *
     *   `mot1 mot2`   both words anywhere in the file, ignoring case
     *   `"Exact Text"` that text, exact case (`\"` escapes a quote)
     *   `/re[gG]ex/`  an RE2 regular expression, `/re/i` to ignore case
     *   `-terme`      the file must not contain it
     *
     * Conditions are ANDed at file level, so they may match on different lines, and each is tried
     * against the file's name as well as its content. Use {@link quoteSearchTerm} to pass a literal
     * string through safely.
     */
    async search(directoryPath: string, query: string): Promise<SearchResponse> {
        const response = await this.fetch(this.getUrl('/search', { path: directoryPath, query }));
        if (!response.ok) {
            // A 4xx body is user-facing copy explaining what is wrong with the query (see
            // worker/errors.go), so it is worth far more than the status reason.
            const detail = (await response.text().catch(() => '')).trim();
            throw new WorkerError(detail || `Search failed: ${response.statusText}`, response.status, response.statusText);
        }
        return response.json();
    }

    /**
     * Converts the documents at or under these paths into their sibling index (`.index.md`,
     * `.index.csv`), so search can read them and a person can open what they say.
     *
     * Search already does this on its own for anything missing or out of date. Asking here is for
     * the two things it will not do: convert a whole folder now rather than on the next search,
     * and rewrite an index that is current but in a format an older service wrote. Neither ever
     * touches an index somebody edited by hand — delete it to ask for that.
     *
     * A document that fails to convert is reported in `failed` and does not fail the request; only
     * a path outside the store does (400).
     */
    async reindex(paths: string[]): Promise<ReindexResult> {
        const response = await this.fetch(this.getUrl('/reindex'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).trim();
            throw new WorkerError(detail || `Reindex failed: ${response.statusText}`, response.status, response.statusText);
        }
        return response.json();
    }

    /**
     * Opens a staging area: the directory an upload lands in before anybody has said what to keep.
     *
     * Nothing about where the files will end up is said here, because that is precisely what has
     * not been decided yet. What comes back is a store path like any other — write into it with
     * {@link upload}, convert it with {@link reindex}, import out of it with {@link moveBatch} —
     * except that no listing shows it and git ignores it.
     *
     * Opening one also sweeps the areas an earlier upload never came back to answer for, so an
     * abandoned review costs a store nothing beyond the next upload.
     */
    async createStaging(): Promise<StagingArea> {
        const response = await this.fetch(this.getUrl('/staging'), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Create staging failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Throws a staging area away with everything still in it — which is how the review's "delete"
     * decision is carried out, and what answers Cancel: a file nobody imported is a file still
     * sitting there.
     *
     * The service refuses any path that is not one of the directories {@link createStaging} minted
     * (400), so this recursive delete can never be aimed at the store.
     */
    async discardStaging(path: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/staging', { path }), { method: 'DELETE' });
        if (!response.ok) throw new WorkerError(`Discard staging failed: ${response.statusText}`, response.status, response.statusText);
    }

    /**
     * Extracts the archive at `path` into its own folder. The structure inside is preserved and
     * files that already exist are overwritten. With `deleteArchive` the archive itself is removed
     * once its contents are out.
     */
    async unzip(path: string, deleteArchive = false): Promise<UnzipResult> {
        const params: Record<string, string> = deleteArchive ? { path, deleteArchive: 'true' } : { path };
        const response = await this.fetch(this.getUrl('/unzip', params), { method: 'POST' });
        if (!response.ok) {
            const said = (await response.text().catch(() => '')).trim();
            throw new WorkerError(said || `Unzip failed: ${response.statusText}`, response.status, response.statusText);
        }
        return response.json();
    }

    /**
     * What the store under `path` is carrying that it need not be: the files stored more than once,
     * and the biggest ones. `path` defaults to the store root.
     *
     * **Slow by design.** The server walks the store and reads the candidates it must read to be
     * sure two files are the same, so this is a call a person makes by opening a panel, never one a
     * client makes on its own. It honours the store's `.kiao-files` declaration, so a dependency
     * tree or a network mount is not walked and its copies are not reported.
     */
    async getFileOptimizations(path: string = ''): Promise<FileOptimizations> {
        const response = await this.fetch(this.getUrl('/fileOptimizations', { path }), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`File optimizations failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Reduce identical files to the one at `target`, repairing every reference to the ones that go.
     *
     * The server re-reads the files before it touches anything: a scan minutes old is not licence to
     * destroy. It answers `409` — with a sentence saying which — when they are no longer identical,
     * or when `target` has since been taken by a file that is not one of them. That sentence is the
     * error's message here, because it is the only thing the user can act on.
     */
    async deduplicate(paths: string[], target: string): Promise<DeduplicateResult> {
        const response = await this.fetch(this.getUrl('/deduplicate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths, target }),
        });
        if (!response.ok) {
            const said = (await response.text().catch(() => '')).trim();
            throw new WorkerError(said || `Deduplicate failed: ${response.statusText}`, response.status, response.statusText);
        }
        return response.json();
    }

    async getDiskUsage(): Promise<DiskUsage> {
        const response = await this.fetch(this.getUrl('/diskUsage'));
        if (!response.ok) throw new WorkerError(`Get disk usage failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async getStoreInfo(): Promise<StoreInfo> {
        const response = await this.fetch(this.getUrl('/storeInfo'));
        if (!response.ok) throw new WorkerError(`Get store info failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async getDocument<T>(path: string): Promise<Document<T>> {
        const doc = await this.getFileJson<Document<T>>(path);
        // Backfill timestamps if missing
        if (!doc.createdAt) {
            doc.createdAt = new Date().toISOString();
        }
        if (!doc.updatedAt) {
            doc.updatedAt = new Date().toISOString();
        }
        return doc;
    }

    async saveDocument<T>(path: string, doc: Document<T>): Promise<void> {
        // Ensure creation date is set
        if (!doc.createdAt) {
            doc.createdAt = new Date().toISOString();
        }
        // Always update modification date on save
        doc.updatedAt = new Date().toISOString();
        await this.saveJson(path, doc);
    }

    async saveJson<T>(path: string, content: T, options: { headers?: Record<string, string> } = {}): Promise<void> {
        const jsonContent = JSON.stringify(content, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        await this.update(path, blob, { headers: options.headers });
    }

    async download(path: string, options: { filename?: string } = {}): Promise<void> {
        const response = await this.getFileResponse(path);
        const blob = await response.blob();

        let filename = options.filename;
        if (!filename) {
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="?([^"]+)"?/);
                if (match && match[1]) {
                    filename = match[1];
                }
            }
        }
        if (!filename) {
            const parts = path.split('/');
            filename = parts[parts.length - 1];
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    async getDownloadUrl(path: string): Promise<string> {
        const url = this.getUrl('/getFile', { path });
        const headers = this.getHeaders ? await this.getHeaders() : {};
        const authHeader = headers['Authorization'];

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const urlObj = new URL(url);
            urlObj.searchParams.append('access_token', token);
            return urlObj.toString();
        }
        return url;
    }

    // ── Configuration documents ───────────────────────────────────────────────

    /**
     * A configuration document — Dashboard' feature flags, its remembered view state — read from the
     * worker state directory rather than from the managed file tree. These used to be two
     * files in the store, fetched through `getFileJson`, which put machine configuration in the file
     * tree, in `git status` and in anything the user published.
     *
     * A document that was never written throws a {@link WorkerError} with status 404, which is
     * how a caller recognises a first run and seeds its defaults. The name is one the service
     * allow-lists; anything else is a 404 too.
     */
    async getConfigJson<T>(name: string): Promise<T> {
        const response = await this.fetch(this.getUrl(`/config/${encodeURIComponent(name)}`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get config document failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** Replaces a configuration document wholesale. */
    async saveConfigJson<T>(name: string, content: T): Promise<void> {
        const response = await this.fetch(this.getUrl(`/config/${encodeURIComponent(name)}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(content, null, 2),
        });
        if (!response.ok) throw new WorkerError(`Save config document failed: ${response.statusText}`, response.status, response.statusText);
    }

    // ── Git (Source Control) ──────────────────────────────────────────────────
    //
    // Every call takes the folder of the store it is about, and answers for the repository that
    // folder belongs to — the store's own unless the folder sits inside a repository of its own.
    // The paths a call reports and the paths it accepts are relative to that repository's top
    // level, so a caller must pass the same folder to the whole sequence of calls it makes.
    // Omitting it is the store root, which is what a caller that means the store as a whole wants.

    async gitStatus(folder?: string): Promise<GitStatus> {
        const response = await this.fetch(this.getUrl('/git/status', gitFolder(folder)), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Git status failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async gitFetch(folder?: string): Promise<GitStatus> {
        const response = await this.fetch(this.getUrl('/git/fetch', gitFolder(folder)), { method: 'POST', cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Git fetch failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** The branches the repository offers to switch to: every local one, then the remote-only ones. */
    async gitBranches(folder?: string): Promise<GitBranches> {
        const response = await this.fetch(this.getUrl('/git/branches', gitFolder(folder)), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Git branches failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Switches the working tree to another branch. A remote-only name ("origin/x") creates the
     * local branch that tracks it. Git refuses a switch that would drop uncommitted work, and that
     * refusal comes back as an unsuccessful result rather than as an error.
     */
    gitCheckout(branch: string, folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/checkout', { branch }, folder);
    }

    /**
     * Starts a new branch at HEAD and switches to it. An invalid or already-taken name comes back
     * as an unsuccessful result rather than as an error.
     */
    gitCreateBranch(branch: string, folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/createBranch', { branch }, folder);
    }

    private async gitAction(endpoint: string, path: string, folder?: string): Promise<GitResult> {
        const response = await this.fetch(this.getUrl(endpoint, { path, ...gitFolder(folder) }), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Git ${endpoint} failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** The POST-a-JSON-body shape every git endpoint that carries more than a path shares. */
    private async gitJsonAction(endpoint: string, body: unknown, folder?: string): Promise<GitResult> {
        const response = await this.fetch(this.getUrl(endpoint, gitFolder(folder)), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new WorkerError(`Git ${endpoint} failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    gitStage(path: string, folder?: string): Promise<GitResult> {
        return this.gitAction('/git/stage', path, folder);
    }

    gitUnstage(path: string, folder?: string): Promise<GitResult> {
        return this.gitAction('/git/unstage', path, folder);
    }

    /** Stages every path in one request; the service runs a single `git add`. */
    gitStageBatch(paths: string[], folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/stageBatch', { paths }, folder);
    }

    /** Unstages every path in one request; the service runs a single command. */
    gitUnstageBatch(paths: string[], folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/unstageBatch', { paths }, folder);
    }

    /**
     * The tree-wide actions: no paths go over the wire, the service resolves the file set itself —
     * one request whatever the size of the tree. `revertAll` discards every unstaged change and
     * deletes untracked files, leaving the index alone.
     */
    gitStageAll(folder?: string): Promise<GitResult> {
        return this.gitTreeAction('/git/stageAll', folder);
    }

    gitUnstageAll(folder?: string): Promise<GitResult> {
        return this.gitTreeAction('/git/unstageAll', folder);
    }

    gitRevertAll(folder?: string): Promise<GitResult> {
        return this.gitTreeAction('/git/revertAll', folder);
    }

    private async gitTreeAction(endpoint: string, folder?: string): Promise<GitResult> {
        const response = await this.fetch(this.getUrl(endpoint, gitFolder(folder)), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Git ${endpoint} failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    gitRevert(path: string, folder?: string): Promise<GitResult> {
        return this.gitAction('/git/revert', path, folder);
    }

    gitCommit(message: string, amend: boolean = false, folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/commit', { message, amend }, folder);
    }

    async gitPush(folder?: string): Promise<GitResult> {
        const response = await this.fetch(this.getUrl('/git/push', gitFolder(folder)), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Git push failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async gitPull(folder?: string): Promise<GitResult> {
        const response = await this.fetch(this.getUrl('/git/pull', gitFolder(folder)), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Git pull failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Frees the space the repository's history holds: the branch is rewritten as a single root
     * commit and everything then unreachable is pruned. With `pushRemote` the rewrite is
     * force-pushed to the upstream first — without it the remote-tracking ref keeps the old
     * objects alive and little is freed. Minutes of work on a large store; the index and the
     * working tree are left untouched.
     */
    gitConsolidate(message: string, pushRemote: boolean, folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/consolidate', { message, pushRemote }, folder);
    }

    async gitOriginal(path: string, folder?: string): Promise<string> {
        const response = await this.fetch(this.getUrl('/git/original', { path, ...gitFolder(folder) }));
        if (!response.ok) throw new WorkerError(`Git original failed: ${response.statusText}`, response.status, response.statusText);
        return response.text();
    }

    async gitWorking(path: string, folder?: string): Promise<string> {
        const response = await this.fetch(this.getUrl('/git/working', { path, ...gitFolder(folder) }));
        if (!response.ok) throw new WorkerError(`Git working failed: ${response.statusText}`, response.status, response.statusText);
        return response.text();
    }

    gitSave(path: string, content: string, folder?: string): Promise<GitResult> {
        return this.gitJsonAction('/git/save', { path, content }, folder);
    }

    // ── Agents ────────────────────────────────────────────────────────────────

    /**
     * One agent's rolling rate-limit usage — the account *that* engine spends, which is why the agent
     * is named. Omitting it answers the default agent's, as this endpoint always has.
     *
     * The service answers 404 for an agent with no account to report, and 503 when it has one and
     * could not be asked.
     */
    async getAgentUsage(agent?: string): Promise<AgentUsage> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/usage', agent ? { agent } : {}), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get agent usage failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** The model and effort choices the prompt UI should offer, resolved from the installed CLI. */
    async getAgentOptions(): Promise<AgentOptions> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/options'), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get agent options failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    async getAgentProfiles(): Promise<AgentProfilesState> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/profiles'), { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }

    async putAgentProfiles(body: AgentProfilesDocument): Promise<AgentProfilesState> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/profiles'), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }

    async putAgentProfileSecret(id: string, value: string): Promise<void> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/profile-secrets/${encodeURIComponent(id)}`), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
        });
        if (!response.ok) throw new Error(await response.text());
    }

    async getAgentProfileSecrets(): Promise<AgentProfileSecret[]> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/profile-secrets'), { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).secrets;
    }

    async getAgentProfileSecret(id: string): Promise<string> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/profile-secrets/${encodeURIComponent(id)}`), { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).value;
    }

    async deleteAgentProfileSecret(id: string): Promise<void> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/profile-secrets/${encodeURIComponent(id)}`), { method: 'DELETE' });
        if (!response.ok) throw new Error(await response.text());
    }

    async checkAgentProfileConnection(id: string, model: string): Promise<AgentProfileConnectionDiagnostic> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/profiles/${encodeURIComponent(id)}/connection`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
        });
        if (!response.ok) {
            if (response.status === 400 && response.headers.get('Content-Type')?.includes('application/json')) return response.json();
            throw new Error(await response.text());
        }
        return response.json();
    }

    async diagnoseAgentProfile(id: string): Promise<{ status: string; models: AgentProfileModelOption[] }> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/profiles/${encodeURIComponent(id)}/diagnostic`), { method: 'POST' });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }

    /** Whether the CLI on the service host is signed in, and whether it can be signed in from here. */
    async getAgentAuthStatus(agent?: string): Promise<AgentAuthStatus> {
        const query = agent ? `?agent=${encodeURIComponent(agent)}` : '';
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/auth/status${query}`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get agent auth status failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Which runner this service is, and where that answer came from — the file the runners panel
     * writes, an environment export that wins over it, or none. A 404 is a service that predates
     * the endpoint, which also predates the `runner.json` document: the panel then offers no
     * "it's me" at all rather than a button whose write would land nowhere.
     */
    async getRunnerIdentity(): Promise<RunnerIdentity> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/runner'), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get runner identity failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Starts the sign-in and returns the URL for the user to open. They authorise there, copy the
     * code the page shows, and hand it back through `submitAgentLoginCode` — the CLI stays parked
     * on its stdin in between, so the two calls belong to one flow and must not be interleaved with
     * another one. Starting again abandons an unfinished attempt.
     *
     * A 404 means the deployment does not expose signing in (see `AgentAuthStatus.loginEnabled`).
     */
    async startAgentLogin(): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/auth/login/start'), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Start agent login failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Hands the code copied from the authorize page to the waiting CLI. A refused code comes back
     * `ok: false` with the CLI's own message; 409 means no sign-in is in progress any more.
     */
    async submitAgentLoginCode(code: string): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/auth/login/code'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        if (!response.ok) throw new WorkerError(`Submit agent login code failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** Abandons a sign-in in progress, killing the parked CLI process. */
    async cancelAgentLogin(): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/auth/login/cancel'), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Cancel agent login failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Stores an API key with the named agent's host CLI — the one-shot sign-in the usage panel
     * drives where the options entry advertises it. A refused key comes back `ok: false` with the
     * CLI's own message; a 404 means the deployment does not expose signing that agent in.
     */
    async submitAgentApiKey(agent: string, key: string): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/auth/${encodeURIComponent(agent)}/key`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
        });
        if (!response.ok) throw new WorkerError(`Submit agent API key failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Starts the agent's device flow and returns the page to open and the code to confirm. The CLI
     * stays parked on the approval in between, so the status below belongs to this start and must
     * not be interleaved with another one. Starting again abandons an unfinished attempt.
     *
     * A 404 means the deployment does not expose signing that agent in.
     */
    async startAgentDeviceLogin(agent: string): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/auth/${encodeURIComponent(agent)}/login/start`), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Start agent device login failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Asks whether the approval has landed. `pending` is still waiting; reading a finished wait
     * consumes it. A 409 means no sign-in is in flight any more — cancelled, expired, or already
     * read.
     */
    async getAgentDeviceLoginStatus(agent: string): Promise<AgentDeviceLoginStatus> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/auth/${encodeURIComponent(agent)}/login/status`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get agent device login status failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** Abandons a device flow in progress, killing the parked CLI process. */
    async cancelAgentDeviceLogin(agent: string): Promise<AgentLoginResult> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/auth/${encodeURIComponent(agent)}/login/cancel`), { method: 'POST' });
        if (!response.ok) throw new WorkerError(`Cancel agent device login failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * The conversations this service holds, most recently updated first. Archived ones are left out
     * unless asked for: archiving is how a conversation leaves the switcher without being lost.
     *
     * This is the registry a client lists from — never `sessionStorage`. The `conversation` and
     * `conversation_deleted` frames of `/ws/hybridflow-runner` are what keep the result fresh without polling.
     */
    async listAgentConversations(includeArchived?: boolean): Promise<AgentConversation[]> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/conversations', includeArchived ? { archived: 'true' } : {}), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`List agent conversations failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Creates a conversation. `folder` is fixed for its life — it is the CLI's working directory and
     * the one owning the CLI's own transcript — so a folder that is gone is a 404 and one outside
     * the store root is a 400.
     */
    async createAgentConversation(body: AgentConversationCreate): Promise<AgentConversation> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/conversations'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new WorkerError(`Create agent conversation failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * One conversation with its whole transcript. This is where history comes from: the socket
     * carries only the turn that is running, so a client renders these messages and appends the
     * live turn to them.
     */
    async getAgentConversation(id: string): Promise<AgentConversationDetail> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/conversations/${encodeURIComponent(id)}`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get agent conversation failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Stores one file for an agent's turn to read — a pasted screenshot, a dropped document.
     *
     * Uploads go here rather than through `/upload` because an attachment is not content: nobody
     * browsed to it and nobody named it, and a store that filled with pasted screenshots would put
     * every one of them in `git status`. It lands in the service's own state directory instead, and
     * the prompt that names its `id` is what tells a turn where to read it.
     *
     * `name` is a fallback for a blob that has none — which is every clipboard paste. What comes
     * back is the name as *stored*, reduced to path-safe characters, so a caller should render that
     * rather than the one it sent: it is what the model was told the file is called.
     */
    async uploadAgentAttachment(file: Blob, name?: string): Promise<AgentAttachment> {
        const formData = new FormData();
        const filename = name || (file instanceof File ? file.name : '') || 'attachment';
        formData.append('file', file, filename);
        formData.append('name', filename);
        const response = await this.fetch(this.getUrl('/hybridflow-runner/attachments'), { method: 'POST', body: formData });
        if (!response.ok) throw new WorkerError(`Upload agent attachment failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * The bytes of a stored attachment, for showing it back where it was attached.
     *
     * A Blob rather than a URL because the endpoint is behind the same bearer token as everything
     * else, and an `<img src>` carries no Authorization header — the caller turns this into an
     * object URL. A 404 is the ordinary end of an attachment's life: they are swept after a month
     * while the transcript that names them is kept.
     */
    async getAgentAttachmentBlob(id: string): Promise<Blob> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/attachments/${encodeURIComponent(id)}`));
        if (!response.ok) throw new WorkerError(`Get agent attachment failed: ${response.statusText}`, response.status, response.statusText);
        return response.blob();
    }

    /**
     * Renames, archives, or changes the per-turn defaults of a conversation. An omitted field is
     * left alone rather than reset. `folder` is absent from the payload on purpose: a conversation
     * that wants a different working directory is a different conversation.
     */
    async patchAgentConversation(id: string, body: AgentConversationPatch): Promise<AgentConversation> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/conversations/${encodeURIComponent(id)}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new WorkerError(`Patch agent conversation failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Forks a conversation: a copy that carries on from a point in it — the same folder and settings,
     * the transcript down to that point, and the agent's session picked up in the same place, so it
     * remembers. The original is not touched, and the two go their own way from the fork on.
     *
     * `fromMessageId` is that point, and the copy stops *short* of it: forking is asked of a prompt,
     * and what it means is that everything before the prompt is the copy's history and the prompt
     * itself is the caller's to send again. Omitting it forks the conversation whole. A message id
     * this conversation's transcript does not hold is a `404`.
     *
     * `agent` forks *onto* another agent, which is the only way there is to change the one a
     * conversation runs on — a session id belongs to one engine, so such a copy carries the
     * transcript and starts a session of its own. Omitted keeps the source's agent.
     *
     * A turn running in the source is a `409`: the reply still being written would land in one
     * conversation and not the other, so a fork waits for it rather than interrupting it. A registry
     * that is full is a `409` too, and a folder that has gone since the source was made is a `404`.
     */
    async forkAgentConversation(id: string, fork: AgentConversationFork = {}): Promise<AgentConversation> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/conversations/${encodeURIComponent(id)}/fork`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fork),
        });
        if (!response.ok) throw new WorkerError(`Fork agent conversation failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Deletes a conversation, stopping any turn running in it first. Only this service's record
     * goes — the CLI's own session file on the host is not ours to purge. The 204 carries no body.
     */
    async deleteAgentConversation(id: string): Promise<void> {
        const response = await this.fetch(this.getUrl(`/hybridflow-runner/conversations/${encodeURIComponent(id)}`), { method: 'DELETE' });
        if (!response.ok) throw new WorkerError(`Delete agent conversation failed: ${response.statusText}`, response.status, response.statusText);
    }

    // ── The board's runs ────────────────────────────────────────────────
    //
    // A run belongs to worker, not to a page: it plays a flow node, files what the agent said under
    // it, marks it and follows the chain whether or not a browser is connected. The six calls below
    // are how a client asks about them and acts on them; how it *learns* about them is the
    // `chainRun` frame, broadcast to every open socket, since they are service-wide and every tab has to agree.
    //
    // **There are several**, and each one is named by its id in the five that act on one. Two boards
    // play side by side, and so do two chains of one board started from two cards; a run stays in the
    // list once it has ended, saying so, which is what a restart is offered on.

    /** Every run the service knows, live and lately ended. Read once at start-up; the socket carries
     *  every change after it. */
    async getChainRuns(): Promise<AgentChainRun[]> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs'), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Get chain runs failed'), response.status, response.statusText);
        return (await response.json()).runs ?? [];
    }

    /**
     * Plays a flow node of a board, and then whatever that flow node names after it, under `name` — what the
     * person starting it called this run. Other runs are left alone.
     *
     * Refused (400) for a flow node whose settings do not name a model, an effort, a permission mode and a
     * folder: nothing writes any of them for it, so nothing plays it. Refused (409) for a card
     * another run is already playing.
     */
    async playChainRun(path: string, flowNodeId: string, name: string): Promise<AgentChainRun | null> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs/play'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, flowNodeId, name }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Play chain run failed'), response.status, response.statusText);
        return (await response.json()).run ?? null;
    }

    /**
     * Ends one run. The turn under way is left to finish and is filed like any other — it is the
     * user's to interrupt, from the chat — and nothing after it is started. A run waiting to try a
     * flow node again ends at once, and a suspended one ends where it stands. The run stays in the list
     * either way, saying it is over.
     */
    async stopChainRun(runId: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs/stop'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Stop chain run failed'), response.status, response.statusText);
    }

    /**
     * Picks a suspended run back up: the flow node it was on is answered by the turn about to run in its
     * chat, and the chain carries on from there. Refused (409) when that run is not suspended.
     */
    async resumeChainRun(runId: string): Promise<AgentChainRun | null> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs/resume'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Resume chain run failed'), response.status, response.statusText);
        return (await response.json()).run ?? null;
    }

    /**
     * Plays an ended run again from the card it was started on, keeping its name and its place in the
     * list. Refused (409) while it is still playing, and (400) where that card has no description
     * left to send — which is what a played card looks like until the next question is written in it.
     */
    async restartChainRun(runId: string): Promise<AgentChainRun | null> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs/restart'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Restart chain run failed'), response.status, response.statusText);
        return (await response.json()).run ?? null;
    }

    /** Takes an ended run out of the list. Refused (409) while it is still playing. */
    async forgetChainRun(runId: string): Promise<void> {
        const response = await this.fetch(this.getUrl('/hybridflow-runner/chain-runs/forget'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Forget chain run failed'), response.status, response.statusText);
    }

    // ── File actions ──────────────────────────────────────────────────────────

    /**
     * The registered actions: all of them, or only those applying to `path`.
     *
     * A client that builds menus wants the unfiltered list — the descriptors are deployment
     * configuration, so fetching them once and evaluating `appliesTo` locally keeps menu building
     * synchronous. Passing a `path` is for callers that would rather ask than evaluate; an unknown
     * path is a 404.
     */
    async listActions(path?: string): Promise<ActionDescriptor[]> {
        const response = await this.fetch(this.getUrl('/actions', path ? { path } : {}), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`List actions failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Runs an action on a path and waits for its outcome.
     *
     * A refused operation is a normal answer carrying its reason (`{ ok: false, message }`); only a
     * transport failure throws — an unknown action id (404), a path outside the store (400), or a
     * provider that could not be reached (502).
     */
    async runAction(id: string, path: string, params?: Record<string, unknown>): Promise<ActionResult> {
        const response = await this.fetch(this.getUrl('/actions/run'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, path, params: params ?? {} }),
        });
        if (!response.ok) throw new WorkerError(`Run action failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    // ── Toolbox ───────────────────────────────────────────────────────────────
    //
    // The configuration panel: what the service can put on the machine it runs on, and which MCP
    // servers a Claude turn is handed. Every call names catalogue ids — the catalogue is compiled
    // into the service binary, so an id it does not declare is a 400 and there is no way to ask for
    // anything else.

    /** The whole panel: the catalogue, the state of each row, and the install in flight if any. */
    async getToolbox(): Promise<Toolbox> {
        const response = await this.fetch(this.getUrl('/toolbox'), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get toolbox failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Starts installing `ids` and everything they require, and answers the job as soon as it is
     * running — the work takes minutes, so poll `getToolboxJob` while `state` is `running`.
     *
     * The service resolves the dependency closure itself; passing the closure is not required, and
     * a component already installed is skipped unless it is named explicitly (which is how a row
     * reported `missing` is repaired). A second call while a job runs is a 400: installs are serial.
     */
    async installToolboxComponents(ids: string[]): Promise<ToolboxJob> {
        const response = await this.fetch(this.getUrl('/toolbox/install'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!response.ok) throw new WorkerError(`Install failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Removes what this service installed, and only that: something already on the machine when the
     * panel first ran, or still required by another installed component, is a 400 with the reason.
     */
    async uninstallToolboxComponents(ids: string[]): Promise<ToolboxJob> {
        const response = await this.fetch(this.getUrl('/toolbox/uninstall'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!response.ok) throw new WorkerError(`Uninstall failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /**
     * Switches MCP servers on or off for turns without touching what is on disk. Nothing is
     * installed or removed, so the answer is the new state of the whole panel rather than a job.
     */
    async setToolboxRegistration(ids: string[], enabled: boolean): Promise<Toolbox> {
        const response = await this.fetch(this.getUrl('/toolbox/registration'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, enabled }),
        });
        if (!response.ok) throw new WorkerError(`Set registration failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    /** One job's state and the output so far. Only the job in hand is kept; an older id is a 400. */
    async getToolboxJob(id: string): Promise<ToolboxJob> {
        const response = await this.fetch(this.getUrl(`/toolbox/jobs/${encodeURIComponent(id)}`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(`Get job failed: ${response.statusText}`, response.status, response.statusText);
        return response.json();
    }

    // ── Media ─────────────────────────────────────────────────────────────────
    //
    // A video's segments saved as files of their own — AV1 and Opus in Matroska, beside the video —
    // by the ffmpeg the service finds, which is the toolbox's `ffmpeg` once it has been installed.

    /**
     * Starts saving each segment of `path` as a file of its own, and answers the job as soon as it
     * is running: poll `getMediaJob` while `state` is `running`. A 424 is a machine with no ffmpeg
     * able to do it — the error carries the service's own sentence, and installing the toolbox's
     * `ffmpeg` is the answer. One save at a time: a second while one runs is a 400.
     */
    async saveMediaSegments(path: string, segments: MediaSegment[]): Promise<MediaJob> {
        const response = await this.fetch(this.getUrl('/media/saveSegments'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, segments }),
        });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Saving the segments failed'), response.status, response.statusText);
        return response.json();
    }

    /** One save's state. Only the last save is kept; an older id is a 400. */
    async getMediaJob(id: string): Promise<MediaJob> {
        const response = await this.fetch(this.getUrl(`/media/jobs/${encodeURIComponent(id)}`), { cache: 'no-store' });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Reading the save failed'), response.status, response.statusText);
        return response.json();
    }

    /** Stops a save where it stands: the segments already saved stay, and the one being written goes. */
    async stopMediaJob(id: string): Promise<MediaJob> {
        const response = await this.fetch(this.getUrl(`/media/jobs/${encodeURIComponent(id)}`), { method: 'DELETE' });
        if (!response.ok) throw new WorkerError(await errorText(response, 'Stopping the save failed'), response.status, response.statusText);
        return response.json();
    }
}

/**
 * The service's own words for a refusal, when it has any. Every 4xx here is written as user-facing
 * copy — "ffmpeg is not installed", "this component is not installed by this service" — and showing
 * the status line instead would throw away the only sentence that says what to do about it.
 */
const errorText = async (response: Response, fallback: string): Promise<string> => {
    try {
        const body = (await response.text()).trim();
        if (body) return body;
    } catch {
        // A body that cannot be read is not worth a second failure.
    }
    return `${fallback}: ${response.statusText}`;
};
