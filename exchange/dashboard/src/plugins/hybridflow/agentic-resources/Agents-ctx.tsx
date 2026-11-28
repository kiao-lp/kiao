import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentDependencyKind, AgentDto, AgentPatchDto, NewAgentDto } from './types';
import type { ReleaseBump } from './release';
import { useResourceClient } from './Client-ctx';

interface AgentsValue {
    agents: AgentDto[];
    loading: boolean;
    error: string | null;
    ensureLoaded: () => void;

    loaded: () => Promise<AgentDto[]>;
    reload: () => Promise<void>;
    create: (agent: NewAgentDto) => Promise<AgentDto>;
    patch: (id: string, patch: AgentPatchDto) => Promise<AgentDto>;
    setDependency: (id: string, kind: AgentDependencyKind, name: string, linked: boolean, local: boolean) => Promise<void>;
    publish: (id: string, bump: ReleaseBump, confirmation?: string) => Promise<AgentDto>;
    pull: (id: string) => Promise<AgentDto>;
    remove: (id: string, confirmation: string) => Promise<void>;
}

const AgentsContext = createContext<AgentsValue | null>(null);

/** Returns an empty list when no provider is mounted. */
export const useAgents = (): AgentsValue => {
    const value = useContext(AgentsContext) ?? NO_AGENTS;
    const { ensureLoaded } = value;
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);
    return value;
};

const noop = () => { };
const noService = () => Promise.reject(new Error('no agentic resource manager'));

const NO_AGENTS: AgentsValue = {
    agents: [],
    loading: false,
    error: null,
    ensureLoaded: noop,
    loaded: () => Promise.resolve([]),
    reload: () => Promise.resolve(),
    create: noService,
    patch: noService,
    setDependency: noService,
    publish: noService,
    pull: noService,
    remove: () => noService() as Promise<void>,
};

/** Holds the agent list for the app lifetime. */
export const AgentsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useResourceClient();
    const [agents, setAgents] = useState<AgentDto[] | null>(null);
    const last = useRef<AgentDto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reading = useRef<Promise<void> | null>(null);

    const keep = useCallback((list: AgentDto[]) => {
        last.current = list;
        setAgents(list);
    }, []);

    const reload = useCallback(async () => {
        if (!client) {
            keep([]);
            return;
        }
        if (reading.current) {
            await reading.current;
            return;
        }
        if (last.current === null) setError(null);
        const read = (async () => {
            try {
                keep(await client.agents());
                setError(null);
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
                reading.current = null;
            }
        })();
        reading.current = read;
        await read;
    }, [client, keep]);

    useEffect(() => {
        if (agents === null) return;
        const timer = setInterval(() => { void reload(); }, 20000);
        return () => clearInterval(timer);
    }, [agents === null, reload]);

    const ensureLoaded = useCallback(() => {
        if (agents === null && !reading.current) void reload();
    }, [agents, reload]);

    const loaded = useCallback(async (): Promise<AgentDto[]> => {
        if (last.current === null) await reload();
        return last.current ?? [];
    }, [reload]);

    const write = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
        if (!client) throw new Error('This instance is not configured to reach an agentic resource manager.');
        try {
            const out = await call();
            if (reading.current) await reading.current;
            await reload();
            return out;
        } catch (cause) {
            await reload().catch(() => { });
            throw cause;
        }
    }, [client, reload]);

    const create = useCallback((agent: NewAgentDto) => write(() => client!.createAgent(agent)),
        [client, write]);

    const patch = useCallback((id: string, patch: AgentPatchDto) => write(() => {
        const held = last.current?.find(agent => agent.id === id);
        return client!.patchAgent(id, patch, held?.revision);
    }), [client, write]);

    const remove = useCallback((id: string, confirmation: string) => write(() => client!.deleteAgent(id, confirmation)),
        [client, write]);

    const setDependency = useCallback((id: string, kind: AgentDependencyKind, name: string, linked: boolean, local: boolean) =>
        write(() => client!.setAgentDependency(id, kind, name, linked, local)), [client, write]);

    const publish = useCallback((id: string, bump: ReleaseBump, confirmation?: string) => write(() => client!.publishAgent(id, bump,
        last.current?.find(agent => agent.id === id)?.revision, confirmation)), [client, write]);

    const pull = useCallback((id: string) => write(() => client!.pullAgent(id)), [client, write]);

    const loading = client !== null && agents === null && error === null;
    const value = useMemo(() => ({
        agents: agents ?? [], loading, error, ensureLoaded, loaded, reload, create, patch, setDependency, publish, pull, remove,
    }), [agents, loading, error, ensureLoaded, loaded, reload, create, patch, setDependency, publish, pull, remove]);

    return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
};
