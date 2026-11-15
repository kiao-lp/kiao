import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NewRunnerDto, RunnerDto, RunnerPatchDto, useHybridflowClient } from './service';

interface RunnersValue {

    runners: RunnerDto[];
    loading: boolean;
    error: string | null;
    /** Reads the list the first time it is asked for, and never again unasked. */
    ensureLoaded: () => void;
    /** The list, having read it where it has not been read yet — what a reader that must be right about it. */
    loaded: () => Promise<RunnerDto[]>;
    reload: () => Promise<void>;

    create: (runner: NewRunnerDto) => Promise<RunnerDto>;

    patch: (id: string, patch: RunnerPatchDto) => Promise<RunnerDto>;

    remove: (id: string) => Promise<void>;
}

const RunnersContext = createContext<RunnersValue | null>(null);

/** The runners, wherever they are read: the panel that keeps them, the task editor that picks one,. */
export const useRunners = (): RunnersValue => {
    const value = useContext(RunnersContext) ?? NO_RUNNERS;
    // Nothing is read at app start — only where runners are shown.
    const { ensureLoaded } = value;
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);
    return value;
};

const noop = () => {   };
const noService = () => Promise.reject(new Error('no hybridflow store'));

const NO_RUNNERS: RunnersValue = {
    runners: [],
    loading: false,
    error: null,
    ensureLoaded: noop,
    loaded: () => Promise.resolve([]),
    reload: () => Promise.resolve(),
    create: noService,
    patch: noService,
    remove: () => noService() as Promise<void>,
};

/** The runners for the life of the app. */
export const RunnersProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const [runners, setRunners] = useState<RunnerDto[] | null>(null);

    const last = useRef<RunnerDto[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reading = useRef<Promise<void> | null>(null);

    const keep = useCallback((list: RunnerDto[]) => {
        last.current = list;
        setRunners(list);
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
                keep(await client.runners());
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
        if (runners === null && !reading.current) void reload();
    }, [runners, reload]);

    const loaded = useCallback(async (): Promise<RunnerDto[]> => {
        if (last.current === null) await reload();
        return last.current ?? [];
    }, [reload]);

    const write = useCallback(async <T,>(call: () => Promise<T>): Promise<T> => {
        if (!client) throw new Error('This instance is not configured to reach a hybridflow store.');
        try {
            const out = await call();
            await reload();
            return out;
        } catch (cause) {
            await reload().catch(() => { });
            throw cause;
        }
    }, [client, reload]);

    const create = useCallback((runner: NewRunnerDto) => write(() => client!.createRunner(runner)),
        [client, write]);

    const patch = useCallback((id: string, patch: RunnerPatchDto) => write(() => {
        const held = runners?.find(runner => runner.id === id);
        return client!.patchRunner(id, patch, held?.revision);
    }), [runners, client, write]);

    const remove = useCallback((id: string) => write(() => client!.deleteRunner(id)),
        [client, write]);

    const value = useMemo(() => ({
        runners: runners ?? [], loading, error, ensureLoaded, loaded, reload, create, patch, remove,
    }), [runners, loading, error, ensureLoaded, loaded, reload, create, patch, remove]);

    return <RunnersContext.Provider value={value}>{children}</RunnersContext.Provider>;
};
