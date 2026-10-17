// Usage is account- and engine-specific: never substitute one agent's figures for another's.
// Refresh only on request (some engines spend a turn to read usage). The app-level
// provider shares cached results across readers and survives panel unmounts.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentUsage } from 'kiao-worker';
import { useWorkerClient } from '@cms-core';

export interface ChatUsageState {
    usage: AgentUsage | null;
    loading: boolean;
    error: boolean;
}

const EMPTY: ChatUsageState = { usage: null, loading: false, error: false };

interface ChatUsageValue {
    stateFor: (agent: string) => ChatUsageState;
    /**
     * Keeps cached figures while loading and on failure; failures set `error` without rejecting.
     * Concurrent refreshes are independent reads; the last response wins.
     */
    refresh: (agent: string) => Promise<void>;
}

const ChatUsageContext = createContext<ChatUsageValue | null>(null);

/** Last manually refreshed usage. Failures, including unsupported quotas (404), keep cached figures. */
export const useChatUsage = (agent: string): ChatUsageState & { refresh: () => Promise<void> } => {
    const ctx = useContext(ChatUsageContext);
    if (!ctx) throw new Error('useChatUsage must be used within an ChatUsageProvider');
    const { stateFor, refresh } = ctx;
    const refreshOwn = useCallback(
        () => (agent ? refresh(agent) : Promise.resolve()),
        [agent, refresh],
    );
    return { ...(agent ? stateFor(agent) : EMPTY), refresh: refreshOwn };
};

export const ChatUsageProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    // Keep `refresh` stable even when a parent render replaces the worker client.
    const workerClient = useWorkerClient();
    const client = useRef(workerClient);
    client.current = workerClient;
    const [states, setStates] = useState<Record<string, ChatUsageState>>({});

    const refresh = useCallback((agent: string) => {
        if (!agent) return Promise.resolve();
        setStates(all => ({
            ...all, [agent]: { usage: all[agent]?.usage ?? null, loading: true, error: false },
        }));
        return client.current.getAgentUsage(agent)
            .then(usage => setStates(all => ({ ...all, [agent]: { usage, loading: false, error: false } })))
            .catch(() => setStates(all => ({
                ...all, [agent]: { usage: all[agent]?.usage ?? null, loading: false, error: true },
            })));
    }, []);

    const stateFor = useCallback(
        (agent: string): ChatUsageState => states[agent] ?? EMPTY,
        [states],
    );

    const value = useMemo<ChatUsageValue>(() => ({ stateFor, refresh }), [stateFor, refresh]);
    return <ChatUsageContext.Provider value={value}>{children}</ChatUsageContext.Provider>;
};
