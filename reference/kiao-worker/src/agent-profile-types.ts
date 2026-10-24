import type { AgentOption } from './agent-types';

export interface AgentCapabilities {
    steer?: boolean;
    followUp?: boolean;
    compact?: boolean;
    branch?: boolean;
    forkAtMessage?: boolean;
    imageInput?: boolean;
}

export interface AgentInstallation {
    id: string;
    engine: string;
    version: string;
    path: string;
    protocol: string;
    external?: boolean;
}

export interface AgentProfileModel {
    id: string;
    name?: string;
    reasoning: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: Record<string, number>;
    compat?: Record<string, unknown>;
}

export interface AgentProfileConnection {
    /** Unique provider name inside the profile, including aliases. */
    provider: string;
    api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
    baseUrl: string;
    /** env:NAME or private:id. Empty means an unauthenticated local API. */
    secretRef?: string;
    models: AgentProfileModel[];
}

export interface AgentProfileResource {
    path: string;
    version: string;
    sha256: string;
}

export interface AgentProfile {
    id: string;
    name: string;
    revision: number;
    installationId: string;
    connections: AgentProfileConnection[];
    /** provider/model; model IDs may themselves contain a slash. */
    defaultModel?: string;
    defaultEffort?: string;
    tools?: string[];
    /** null uses toolbox selection; [] supplies no servers. */
    mcpServers?: string[] | null;
    extensions?: AgentProfileResource[];
    promptTemplates?: AgentProfileResource[];
}

export interface AgentProfileModelOption extends AgentOption {
    provider: string;
    modelId: string;
    efforts: AgentOption[];
    capabilities: AgentCapabilities;
}

export interface AgentProfileOffer extends AgentProfile {
    status: 'ready' | 'installation_missing' | 'incomplete' | 'auth_required' | 'model_unavailable';
    message?: string;
    models: AgentProfileModelOption[];
    secretStates: Record<string, boolean>;
}

export interface AgentProfilesDocument {
    version: 1;
    defaultPiProfileId?: string;
    installations: AgentInstallation[];
    profiles: AgentProfile[];
}

export interface AgentProfilesState extends Omit<AgentProfilesDocument, 'profiles'> {
    profiles: AgentProfileOffer[];
    availableInstallations: AgentInstallation[];
}

export interface AgentProfileSecret {
    id: string;
    reference: string;
    preview: string;
    usedBy: { profileId: string; profileName: string; provider: string }[];
}

export interface AgentProfileConnectionDiagnostic {
    status: 'ready' | 'configuration_error' | 'api_error' | 'runtime_error' | 'timeout';
    message?: string;
    details?: string;
}

export interface AgentTurnExecution {
    profileId: string;
    profileRevision: number;
    version: string;
    provider: string;
    model: string;
    effort: string;
}

export interface AgentQueuedMessage {
    id: string;
    text: string;
    state: 'pending' | 'delivered' | 'cancelled';
}
