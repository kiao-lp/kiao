import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AgentDto, AgentPatchDto, NewAgentDto, useHybridflowClient } from './service';

interface AgentsValue {
    /** Every managed agent, by name: what the panel lists and the flow node editor picks from. */
    agents: AgentDto[];
    loading: boolean;
    error: string | null;
    /** Reads the list the first time it is asked for, and never again unasked. */
    ensureLoaded: () => void;
    /**
     * The list, having read it where it has not been read yet — what a reader that must be *right*
     * about it asks for, rather than the rendered {@link agents}. A paste is the one of them: it
     * decides whether the agent a pasted card names is one this store keeps, and a board opened a
     * moment ago may still be reading the list, in which case the rendered one is empty and every
     * agent would be read as a foreign instance's and dropped.
     */
    loaded: () => Promise<AgentDto[]>;
    /** Reads the list again. */
    reload: () => Promise<void>;
    /** Files an agent. A taken name is refused by the service, with its message. */
    create: (agent: NewAgentDto) => Promise<AgentDto>;
    /** Changes the fields the patch names, against the revision this list holds. */
    patch: (id: string, patch: AgentPatchDto) => Promise<AgentDto>;
    /** Removes an agent. The flow nodes naming it keep naming it, and say it is gone. */
    remove: (id: string) => Promise<void>;
}

const AgentsContext = createContext<AgentsValue | null>(null);

/**
 * The managed agents, wherever they are read: the panel that keeps them, the flow node editor that
 * picks one, and the chips a card wears naming it.
 *
 * It answers with an empty list where no provider is mounted — which is every test that is about
 * something else, and a tree the plugin never joined. A card is display: it resolves the name
 * where it can and shows the value where it cannot, rather than throwing for a list nobody there
 * reads. The panel is the one surface that writes, and it is mounted under the provider or not at
 * all — where there is no hybridflow store behind it, it says so instead of listing.
 */
export const useAgents = (): AgentsValue => {
    const value = useContext(AgentsContext) ?? NO_AGENTS;
    // Whatever reads the list is what loads it: the panel, the flow node editor, and the chips a
    // card wears all read through here, so the first of them on screen reads the list and the
    // rest share the read in flight. Nothing is read at app start — only where agents are shown.
    const { ensureLoaded } = value;
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);
    return value;
};

const noop = () => { /* no provider: nothing to load */ };
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
    remove: () => noService() as Promise<void>,
};

/**
 * The managed agents for the life of the app.
 *
 * It sits beside the board's own providers rather than in the panel because it has two readers
 * that never share a lifetime: the panel in a tool bar, which every navigation replaces, and the
 * cards of a board, which is a main view. Both read the same list, and a rename in the panel is
 * the name on every card that resolved it.
 *
 * Every write reads the list back. Agents are few and change rarely, and what a write answers is
 * the row it changed — re-listing is what keeps the order, the revisions and a second tab's agent
 * true without a line of merging.
 */
export const AgentsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const [agents, setAgents] = useState<AgentDto[] | null>(null);
    // The same list beside the state, for the reader that awaits the read: what a read brought back
    // cannot be had from the state it set — that value belongs to a render that has not happened yet.
    const last = useRef<AgentDto[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The read in flight, so two readers asking at once share one request rather than racing two
    // listings at each other.
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
                keep(await client.agents());
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

    // A read that has failed is a list that is not known, so the next asker reads again rather than
    // being told the store keeps nothing: the empty answer is only ever what a failure hands back,
    // and it is the one the caller can do the least harm with.
    const loaded = useCallback(async (): Promise<AgentDto[]> => {
        if (last.current === null) await reload();
        return last.current ?? [];
    }, [reload]);

    // A write, and the listing after it. A refused write re-reads too — a conflict means the list
    // moved under the panel, and what it shows next must be what the service holds rather than
    // what it held when the write was aimed.
    const write = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
        if (!client) throw new Error('This instance is not configured to reach a hybridflow store.');
        try {
            const out = await call();
            await reload();
            return out;
        } catch (cause) {
            await reload().catch(() => { /* the write's own error is the one that matters */ });
            throw cause;
        }
    }, [client, reload]);

    const create = useCallback((agent: NewAgentDto) => write(() => client!.createAgent(agent)),
        [client, write]);

    const patch = useCallback((id: string, patch: AgentPatchDto) => write(() => {
        const held = agents?.find(agent => agent.id === id);
        return client!.patchAgent(id, patch, held?.revision);
    }), [agents, client, write]);

    const remove = useCallback((id: string) => write(() => client!.deleteAgent(id)),
        [client, write]);

    const value = useMemo(() => ({
        agents: agents ?? [], loading, error, ensureLoaded, loaded, reload, create, patch, remove,
    }), [agents, loading, error, ensureLoaded, loaded, reload, create, patch, remove]);

    return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
};
