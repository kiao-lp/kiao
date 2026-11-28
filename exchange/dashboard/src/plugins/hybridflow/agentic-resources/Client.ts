import type { AgentDto, AgentPatchDto, AgentDependencyDto, AgentDependencyKind, AgentVersionDto, NewAgentDto, AgenticResourceDto, ResourceFileDto, DeletionStatus, PushConfirmation, AgentRemoteDto } from './types';
import type { ReleaseBump } from './release';

export class PushConfirmationRequired extends Error {
    constructor(message: string, readonly confirmation: PushConfirmation) { super(message); }
}

const unreachable = 'The Dashboard cannot reach the resource manager. Check its service URL and that it is running.';

function serviceError(status: number): string {
    switch (status) {
        case 401: return 'The resource manager could not authenticate the request. Sign in again or check its service credentials.';
        case 403: return 'The resource manager denied access. Check that your account has the files_user role.';
        case 502:
        case 503:
        case 504: return unreachable;
        default: return `The resource manager returned HTTP ${status}. Check its service URL or try again.`;
    }
}

/** The resource service has no dependency on boards or conversations. */
export class ResourceClient {
    constructor(private readonly base: string, private readonly token: () => string | undefined) {}

    async agents(): Promise<AgentDto[]> {
        return (await this.send<{ agents: AgentDto[] }>('GET', '/agents')).agents;
    }
    createAgent(agent: NewAgentDto): Promise<AgentDto> { return this.send('POST', '/agents', agent); }
    patchAgent(id: string, patch: AgentPatchDto, revision?: number): Promise<AgentDto> {
        return this.send('PATCH', `/agents/${encodeURIComponent(id)}`, patch, revision);
    }
    publishAgent(id: string, bump: ReleaseBump, revision?: number, confirmation?: string): Promise<AgentDto> {
        return this.send('POST', `/agents/${encodeURIComponent(id)}/publish`, { bump, confirmation }, revision);
    }
    async agentVersions(id: string): Promise<AgentVersionDto[]> {
        return (await this.send<{ versions: AgentVersionDto[] }>('GET', `/agents/${encodeURIComponent(id)}/versions`)).versions;
    }
    agentRemote(id: string): Promise<AgentRemoteDto> { return this.send('GET', `/agents/${encodeURIComponent(id)}/remote`); }
    pullAgent(id: string): Promise<AgentDto> { return this.send('POST', `/agents/${encodeURIComponent(id)}/pull`); }
    agentDependencies(id: string, kind: AgentDependencyKind): Promise<AgentDependencyDto[]> {
        return this.send('GET', `/agents/${encodeURIComponent(id)}/${kind}`);
    }
    setAgentDependency(id: string, kind: AgentDependencyKind, name: string, linked: boolean, local: boolean): Promise<void> {
        return this.send(linked ? 'PUT' : 'DELETE', `/agents/${encodeURIComponent(id)}/${kind}/${encodeURIComponent(name)}`,
            linked ? { local } : undefined);
    }
    deletionStatus(id: string): Promise<DeletionStatus> { return this.send('GET', `/agents/${encodeURIComponent(id)}/deletion`); }
    deleteAgent(id: string, confirmation: string): Promise<void> {
        return this.send('DELETE', `/agents/${encodeURIComponent(id)}?confirmation=${encodeURIComponent(confirmation)}`);
    }
    agenticResources(): Promise<AgenticResourceDto[]> { return this.send('GET', '/agentic-resources'); }
    resourceFile(name: string, path: string): Promise<ResourceFileDto> {
        return this.send('GET', `/agentic-resources/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`);
    }
    writeResourceFile(name: string, file: ResourceFileDto): Promise<ResourceFileDto> {
        return this.send('PUT', `/agentic-resources/${encodeURIComponent(name)}/file`, file);
    }
    resourceOperation(name: string, operation: 'install' | 'publish' | 'pull' | 'push', options: { confirmation?: string; bump?: ReleaseBump }): Promise<void> {
        return this.send('POST', `/agentic-resources/${encodeURIComponent(name)}/${operation}`, options);
    }
    private async send<T>(method: string, path: string, body?: unknown, revision?: number): Promise<T> {
        const headers: Record<string, string> = {};
        const token = this.token();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (revision !== undefined) headers['If-Match'] = String(revision);
        const response = await fetch(`${this.base}${path}`, { method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) })
            .catch(cause => { throw new Error(unreachable, { cause }); });
        if (response.status === 204) return undefined as T;
        const result: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
            const failure = result as { error?: unknown; pushConfirmation?: PushConfirmation } | undefined;
            const detail = typeof failure?.error === 'string' && failure.error.trim() ? failure.error : serviceError(response.status);
            if (response.status === 409 && failure?.pushConfirmation) {
                throw new PushConfirmationRequired(detail, failure.pushConfirmation);
            }
            throw new Error(detail);
        }
        if (result === undefined) throw new Error('The resource manager returned an unreadable response. Check its service URL.');
        return result as T;
    }
}
