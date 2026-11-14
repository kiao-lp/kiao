import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AgentDto, AgentPatchDto, NewAgentDto, useHybridflowClient } from './service';

interface AgentsValue {
    agents: AgentDto[];
    loading: boolean;
    error: string | null;
    ensureLoaded: () => void;

    loaded: () => Promise<AgentDto[]>;
    reload: () => Promise<void>;
    create: (agent: NewAgentDto) => Promise<AgentDto>;
    patch: (id: string, patch: AgentPatchDto) => Promise<AgentDto>;
    publish: (id: string) => Promise<AgentDto>;
    remove: (id: string) => Promise<void>;
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
const noService = () => Promise.reject(new Error('no hybridflow store'));

const NO_AGENTS: AgentsValue = {
    agents: [],
    loading: false,
    error: null,
    ensureLoaded: noop,
    loaded: () => Promise.resolve([]),
    reload: () => Promise.resolve(),
    create: noService,
    patch: noService,
    publish: noService,
    remove: () => noService() as Promise<void>,
};

/** Holds the agent list for the app lifetime. */
export const AgentsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const [agents, setAgents] = useState<AgentDto[] | null>(null);
    const last = useRef<AgentDto[] | null>(null);
    const [loading, setLoading] = useState(false);
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
        setLoading(true);
        const read = (async () => {
            try {
                keep(await client.agents(true));
                setError(null);
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
                setLoading(false);
                reading.current = null;
            }
        })();
        reading.current = read;
        await read;
    }, [client, keep]);

    const ensureLoaded = useCallback(() => {
        if (agents === null && !reading.current) void reload();
    }, [agents, reload]);

    const loaded = useCallback(async (): Promise<AgentDto[]> => {
        if (last.current === null) await reload();
        return last.current ?? [];
    }, [reload]);

    const write = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
        if (!client) throw new Error('This instance is not configured to reach a hybridflow store.');
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

    const remove = useCallback((id: string) => write(() => client!.deleteAgent(id)),
        [client, write]);

    const publish = useCallback((id: string) => write(() => client!.publishAgent(id,
        last.current?.find(agent => agent.id === id)?.revision)), [client, write]);

    const value = useMemo(() => ({
        agents: agents ?? [], loading, error, ensureLoaded, loaded, reload, create, patch, publish, remove,
    }), [agents, loading, error, ensureLoaded, loaded, reload, create, patch, publish, remove]);

    return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
};
