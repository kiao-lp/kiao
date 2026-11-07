import { useMemo, useSyncExternalStore } from 'react';
import type { AgentOption, AgentOptions, AgentOptionsEntry, WorkerClient } from 'kiao-worker';
import { useWorkerClient, TOOLBOX_CHANGED_EVENT } from '@cms-core';

/**
 * The agent this service binds a conversation to when the client names none, and the name every store.
 * It is only ever a *fallback*: what a deployment actually offers comes from `GET.
 */
export const DEFAULT_AGENT = 'claude';

const CLAUDE_MODELS: AgentOption[] = [
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'fable', label: 'Fable' },
];

const CLAUDE_EFFORTS: AgentOption[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'X-High' },
    { value: 'max', label: 'Max' },
];

const CLAUDE_PERMISSION_MODES: AgentOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'manualLive', label: 'Manual Live' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
];

/**
 * Display defaults for legacy conversation records and services predating agent lists.
 * These lists never establish that a CLI is enabled: only the service can answer.
 */
export const FALLBACK_AGENT_OPTIONS: AgentOptions = {
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    permissionModes: CLAUDE_PERMISSION_MODES,
    agents: [{
        value: DEFAULT_AGENT,
        label: 'Claude',
        models: CLAUDE_MODELS,
        efforts: CLAUDE_EFFORTS,
        permissionModes: CLAUDE_PERMISSION_MODES,
        defaultModel: 'opus',
        defaultEffort: 'max',
    }],
    defaultAgent: DEFAULT_AGENT,
    defaultModel: 'opus',
    defaultEffort: 'max',
};

const NO_AGENT_OPTIONS: AgentOptions = {
    agents: [], models: [], efforts: [], permissionModes: [],
};

export interface ChatOptionsState {

    agents: AgentOptionsEntry[];
    /** The default agent's name — what a conversation created without naming one is bound to. */
    defaultAgent: string;

    models: AgentOption[];
    efforts: AgentOption[];
    permissionModes: AgentOption[];
    loading: boolean;

    optionsFor: (agent: string) => AgentOptionsEntry;
}

interface OptionsSnapshot {
    options: AgentOptions;
    loading: boolean;
}

interface OptionsStore {
    getSnapshot: () => OptionsSnapshot;
    subscribe: (listener: () => void) => () => void;
}

const stores = new WeakMap<WorkerClient, OptionsStore>();

/** Capability consumers may sit above the chat's providers. */
const optionsStore = (client: WorkerClient): OptionsStore => {
    const existing = stores.get(client);
    if (existing) return existing;

    let snapshot: OptionsSnapshot = { options: NO_AGENT_OPTIONS, loading: true };
    let generation = 0;
    let pending: Promise<void> | null = null;
    const listeners = new Set<() => void>();
    const publish = (next: OptionsSnapshot) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };
    const refresh = (event?: Event) => {
        if (!event && pending) return;
        const current = ++generation;
        publish({ ...snapshot, loading: true });
        const read = client.getAgentOptions()
            .then(data => {
                if (current === generation) publish({ options: withAgents(data), loading: false });
            })
            .catch(() => {
                if (current === generation) publish({ options: NO_AGENT_OPTIONS, loading: false });
            })
            .finally(() => { if (pending === read) pending = null; });
        pending = read;
    };
    const store: OptionsStore = {
        getSnapshot: () => snapshot,
        subscribe: listener => {
            listeners.add(listener);
            if (listeners.size === 1) {
                stores.set(client, store);
                window.addEventListener(TOOLBOX_CHANGED_EVENT, refresh);
                refresh();
            }
            return () => {
                listeners.delete(listener);
                if (listeners.size > 0) return;
                window.removeEventListener(TOOLBOX_CHANGED_EVENT, refresh);
                if (stores.get(client) === store) stores.delete(client);
            };
        },
    };
    stores.set(client, store);
    return store;
};

/** The agents this deployment offers, refreshed after toolbox changes. **The lists are per agent**. */
export const useChatOptionLists = (): ChatOptionsState => {
    const client = useWorkerClient();
    const store = useMemo(() => optionsStore(client), [client]);
    const { options, loading } = useSyncExternalStore(store.subscribe, store.getSnapshot);

    return useMemo(() => {
        const agents = options.agents ?? FALLBACK_AGENT_OPTIONS.agents!;
        const fallback = agents[0] ?? FALLBACK_AGENT_OPTIONS.agents![0];
        const optionsFor = (agent: string) => agents.find(entry => entry.value === agent) ?? fallback;
        return {
            agents,
            defaultAgent: options.defaultAgent || fallback.value,
            models: fallback.models,
            efforts: fallback.efforts,
            permissionModes: fallback.permissionModes,
            optionsFor,
            loading,
        };
    }, [options, loading]);
};

/** The payload read as a list of agents, whatever shape it came in. */
const withAgents = (data: AgentOptions): AgentOptions => {
    const fallback = FALLBACK_AGENT_OPTIONS.agents![0];
    if (Array.isArray(data.agents)) {
        const listed = data.agents.map(entry => ({
            ...entry,
            label: entry.label || entry.value,
            models: entry.models ?? [],
            efforts: entry.efforts ?? [],
            permissionModes: entry.permissionModes ?? [],
        }));
        return { ...data, agents: listed, defaultAgent: data.defaultAgent || listed[0]?.value || '' };
    }
    return {
        ...data,
        agents: [{
            value: data.defaultAgent || fallback.value,
            label: fallback.label,
            models: data.models?.length ? data.models : fallback.models,
            efforts: data.efforts?.length ? data.efforts : fallback.efforts,
            permissionModes: data.permissionModes?.length ? data.permissionModes : fallback.permissionModes,
        }],
        defaultAgent: data.defaultAgent || fallback.value,
    };
};
