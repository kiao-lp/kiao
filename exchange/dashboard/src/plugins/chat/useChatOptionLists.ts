import { useMemo, useSyncExternalStore } from 'react';
import type { HarnessOption, HarnessOptions, HarnessOptionsEntry, WorkerClient } from 'kiao-worker';
import { useWorkerClient, TOOLBOX_CHANGED_EVENT } from '@kiao-dashboard-core';

/**
 * The harness this service binds a conversation to when the client names none, and the name every store.
 * It is only ever a *fallback*: what a deployment actually offers comes from `GET.
 */
export const DEFAULT_HARNESS = 'claude';

const CLAUDE_MODELS: HarnessOption[] = [
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'fable', label: 'Fable' },
];

const CLAUDE_EFFORTS: HarnessOption[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'X-High' },
    { value: 'max', label: 'Max' },
];

const CLAUDE_PERMISSION_MODES: HarnessOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'manualLive', label: 'Manual Live' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
];

/**
 * Display defaults for legacy conversation records and services predating harness lists.
 * These lists never establish that a CLI is enabled: only the service can answer.
 */
export const FALLBACK_HARNESS_OPTIONS: HarnessOptions = {
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    permissionModes: CLAUDE_PERMISSION_MODES,
    harnesses: [{
        value: DEFAULT_HARNESS,
        label: 'Claude',
        models: CLAUDE_MODELS,
        efforts: CLAUDE_EFFORTS,
        permissionModes: CLAUDE_PERMISSION_MODES,
        defaultModel: 'opus',
        defaultEffort: 'max',
    }],
    defaultHarness: DEFAULT_HARNESS,
    defaultModel: 'opus',
    defaultEffort: 'max',
};

const NO_HARNESS_OPTIONS: HarnessOptions = {
    harnesses: [], models: [], efforts: [], permissionModes: [],
};

export interface ChatOptionsState {

    harnesses: HarnessOptionsEntry[];
    /** The default harness's name — what a conversation created without naming one is bound to. */
    defaultHarness: string;

    models: HarnessOption[];
    efforts: HarnessOption[];
    permissionModes: HarnessOption[];
    loading: boolean;

    optionsFor: (harness: string) => HarnessOptionsEntry;
}

interface OptionsSnapshot {
    options: HarnessOptions;
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

    let snapshot: OptionsSnapshot = { options: NO_HARNESS_OPTIONS, loading: true };
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
        const read = client.getHarnessOptions()
            .then(data => {
                if (current === generation) publish({ options: withHarnesses(data), loading: false });
            })
            .catch(() => {
                if (current === generation) publish({ options: NO_HARNESS_OPTIONS, loading: false });
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

/** The harnesses this deployment offers, refreshed after toolbox changes. **The lists are per harness**. */
export const useChatOptionLists = (): ChatOptionsState => {
    const client = useWorkerClient();
    const store = useMemo(() => optionsStore(client), [client]);
    const { options, loading } = useSyncExternalStore(store.subscribe, store.getSnapshot);

    return useMemo(() => {
        const harnesses = options.harnesses ?? FALLBACK_HARNESS_OPTIONS.harnesses!;
        const fallback = harnesses[0] ?? FALLBACK_HARNESS_OPTIONS.harnesses![0];
        const optionsFor = (harness: string) => harnesses.find(entry => entry.value === harness) ?? fallback;
        return {
            harnesses,
            defaultHarness: options.defaultHarness || fallback.value,
            models: fallback.models,
            efforts: fallback.efforts,
            permissionModes: fallback.permissionModes,
            optionsFor,
            loading,
        };
    }, [options, loading]);
};

/** The payload read as a list of harnesses, whatever shape it came in. */
const withHarnesses = (data: HarnessOptions): HarnessOptions => {
    const fallback = FALLBACK_HARNESS_OPTIONS.harnesses![0];
    if (Array.isArray(data.harnesses)) {
        const listed = data.harnesses.map(entry => ({
            ...entry,
            label: entry.label || entry.value,
            models: entry.models ?? [],
            efforts: entry.efforts ?? [],
            permissionModes: entry.permissionModes ?? [],
        }));
        return { ...data, harnesses: listed, defaultHarness: data.defaultHarness || listed[0]?.value || '' };
    }
    return {
        ...data,
        harnesses: [{
            value: data.defaultHarness || fallback.value,
            label: fallback.label,
            models: data.models?.length ? data.models : fallback.models,
            efforts: data.efforts?.length ? data.efforts : fallback.efforts,
            permissionModes: data.permissionModes?.length ? data.permissionModes : fallback.permissionModes,
        }],
        defaultHarness: data.defaultHarness || fallback.value,
    };
};
