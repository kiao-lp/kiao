import type { AgentDto, AgentPatchDto, AgentDependencyDto, AgentDependencyKind, AgentVersionDto, NewAgentDto, AgenticResourceDto, ResourceFileDto, DeletionStatus, PushConfirmation } from './types';
import type { ReleaseBump } from './release';

export class PushConfirmationRequired extends Error {
    constructor(message: string, readonly confirmation: PushConfirmation) { super(message); }
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
        const response = await fetch(`${this.base}${path}`, { method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await response.text();
        let result: any;
        try { result = text ? JSON.parse(text) : undefined; } catch { throw new Error(`Resource service answered ${response.status}`); }
        if (!response.ok) {
            if (response.status === 409 && result?.pushConfirmation) {
                throw new PushConfirmationRequired(result.error, result.pushConfirmation);
            }
            throw new Error(result?.error ?? `Resource service answered ${response.status}`);
        }
        return result as T;
    }
}
