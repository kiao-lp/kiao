// Usage is account- and engine-specific: never substitute one harness's figures for another's.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HarnessUsage } from 'kiao-worker';
import { useWorkerClient } from '@kiao-dashboard-core';

export interface ChatUsageState {
    usage: HarnessUsage | null;
    loading: boolean;
    error: boolean;
}

const EMPTY: ChatUsageState = { usage: null, loading: false, error: false };

interface ChatUsageValue {
    stateFor: (harness: string) => ChatUsageState;
    /** Keeps cached figures while loading and on failure; failures set `error` without rejecting. */
    refresh: (harness: string) => Promise<void>;
}

const ChatUsageContext = createContext<ChatUsageValue | null>(null);

/** Last manually refreshed usage. */
export const useChatUsage = (harness: string): ChatUsageState & { refresh: () => Promise<void> } => {
    const ctx = useContext(ChatUsageContext);
    if (!ctx) throw new Error('useChatUsage must be used within an ChatUsageProvider');
    const { stateFor, refresh } = ctx;
    const refreshOwn = useCallback(
        () => (harness ? refresh(harness) : Promise.resolve()),
        [harness, refresh],
    );
    return { ...(harness ? stateFor(harness) : EMPTY), refresh: refreshOwn };
};

export const ChatUsageProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    const workerClient = useWorkerClient();
    const client = useRef(workerClient);
    client.current = workerClient;
    const [states, setStates] = useState<Record<string, ChatUsageState>>({});

    const refresh = useCallback((harness: string) => {
        if (!harness) return Promise.resolve();
        setStates(all => ({
            ...all, [harness]: { usage: all[harness]?.usage ?? null, loading: true, error: false },
        }));
        return client.current.getHarnessUsage(harness)
            .then(usage => setStates(all => ({ ...all, [harness]: { usage, loading: false, error: false } })))
            .catch(() => setStates(all => ({
                ...all, [harness]: { usage: all[harness]?.usage ?? null, loading: false, error: true },
            })));
    }, []);

    const stateFor = useCallback(
        (harness: string): ChatUsageState => states[harness] ?? EMPTY,
        [states],
    );

    const value = useMemo<ChatUsageValue>(() => ({ stateFor, refresh }), [stateFor, refresh]);
    return <ChatUsageContext.Provider value={value}>{children}</ChatUsageContext.Provider>;
};
