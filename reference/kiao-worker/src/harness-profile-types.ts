import type { HarnessOption } from './harness-types';

export interface HarnessCapabilities {
    steer?: boolean;
    followUp?: boolean;
    compact?: boolean;
    branch?: boolean;
    forkAtMessage?: boolean;
    imageInput?: boolean;
}

export interface HarnessInstallation {
    id: string;
    engine: string;
    version: string;
    path: string;
    protocol: string;
    external?: boolean;
}

export interface HarnessProfileModel {
    id: string;
    name?: string;
    reasoning: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: Record<string, number>;
    compat?: Record<string, unknown>;
}

export interface HarnessProfileConnection {
    /** Unique provider name inside the profile, including aliases. */
    provider: string;
    api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
    baseUrl: string;
    /** env:NAME or private:id. Empty means an unauthenticated local API. */
    secretRef?: string;
    models: HarnessProfileModel[];
}

export interface HarnessProfileResource {
    path: string;
    version: string;
    sha256: string;
}

export interface HarnessProfile {
    id: string;
    name: string;
    revision: number;
    installationId: string;
    connections: HarnessProfileConnection[];
    /** provider/model; model IDs may themselves contain a slash. */
    defaultModel?: string;
    defaultEffort?: string;
    tools?: string[];
    /** null uses toolbox selection; [] supplies no servers. */
    mcpServers?: string[] | null;
    extensions?: HarnessProfileResource[];
    promptTemplates?: HarnessProfileResource[];
}

export interface HarnessProfileModelOption extends HarnessOption {
    provider: string;
    modelId: string;
    efforts: HarnessOption[];
    capabilities: HarnessCapabilities;
}

export interface HarnessProfileOffer extends HarnessProfile {
    status: 'ready' | 'installation_missing' | 'incomplete' | 'auth_required' | 'model_unavailable';
    message?: string;
    models: HarnessProfileModelOption[];
    secretStates: Record<string, boolean>;
}

export interface HarnessProfilesDocument {
    version: 1;
    defaultPiProfileId?: string;
    installations: HarnessInstallation[];
    profiles: HarnessProfile[];
}

export interface HarnessProfilesState extends Omit<HarnessProfilesDocument, 'profiles'> {
    profiles: HarnessProfileOffer[];
    availableInstallations: HarnessInstallation[];
}

export interface HarnessProfileSecret {
    id: string;
    reference: string;
    preview: string;
    usedBy: { profileId: string; profileName: string; provider: string }[];
}

export interface HarnessProfileConnectionDiagnostic {
    status: 'ready' | 'configuration_error' | 'api_error' | 'runtime_error' | 'timeout';
    message?: string;
    details?: string;
}

export interface HarnessTurnExecution {
    profileId: string;
    profileRevision: number;
    version: string;
    provider: string;
    model: string;
    effort: string;
}

export interface HarnessQueuedMessage {
    id: string;
    text: string;
    state: 'pending' | 'delivered' | 'cancelled';
}
