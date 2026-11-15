import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import { useWorkerClient } from '@kiao-dashboard-core';
import {
    Decision, DecisionSource, DECISIONS_PATH, displayNameOf, parseDecision,
    readSources, sourcesFileText, withSourcePaths,
} from './decisionsFile';

interface DecisionsValue {
    sources: DecisionSource[];
    sourcesLoading: boolean;
    decisions: Decision[];
    decisionsLoading: boolean;
    addSourcePaths: (paths: string[]) => void;
    updateSource: (index: number, patch: Partial<DecisionSource>) => void;
    removeSource: (index: number) => void;
    ensureLoaded: () => void;
    reload: () => void;
}

const DecisionsContext = createContext<DecisionsValue | null>(null);

export const useDecisions = (): DecisionsValue => {
    const context = useContext(DecisionsContext);
    if (!context) throw new Error('useDecisions must be used within a DecisionsProvider');
    return context;
};

const SAVE_DEBOUNCE_MS = 800;

const parseFile = (content: string): unknown => {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
};

export const DecisionsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const [sources, setSources] = useState<DecisionSource[]>([]);
    const [sourcesLoading, setSourcesLoading] = useState(true);
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [decisionsLoading, setDecisionsLoading] = useState(false);

    const pending = useRef<string | null>(null);
    const saving = useRef<Promise<unknown>>(Promise.resolve());

    const flush = useCallback(() => {
        const content = pending.current;
        if (content === null) return;
        pending.current = null;
        saving.current = client.update(DECISIONS_PATH, content)
            .catch(error => console.error('Failed to save the decision sources', error));
    }, [client]);

    const scheduleSave = useMemo(() => debounce(flush, SAVE_DEBOUNCE_MS), [flush]);

    const flushNow = useCallback(() => {
        scheduleSave.cancel();
        flush();
        return saving.current;
    }, [flush, scheduleSave]);

    useEffect(() => {
        const onBeforeUnload = () => flushNow();
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            flushNow();
        };
    }, [flushNow]);

    const [readId, setReadId] = useState<number | null>(null);
    const ensureLoaded = useCallback(() => setReadId(id => id ?? 0), []);
    const reload = useCallback(() => setReadId(id => (id ?? 0) + 1), []);

    useEffect(() => {
        if (readId === null) return;
        let cancelled = false;
        setSourcesLoading(true);
        flushNow()
            .then(() => client.getFileText(DECISIONS_PATH).catch(() => ''))
            .then(content => {
                if (cancelled) return;
                setSources(readSources(parseFile(content)));
                setSourcesLoading(false);
            });
        return () => { cancelled = true; };
    }, [client, readId, flushNow]);

    const held = useRef(sources);
    held.current = sources;

    const write = useCallback((next: DecisionSource[]) => {
        held.current = next;
        setSources(next);
        pending.current = sourcesFileText(next);
        scheduleSave();
    }, [scheduleSave]);

    const addSourcePaths = useCallback((paths: string[]) => {
        const next = withSourcePaths(held.current, paths);
        if (next.length !== held.current.length) write(next);
    }, [write]);

    const updateSource = useCallback((index: number, patch: Partial<DecisionSource>) => {
        if (!held.current[index]) return;
        write(held.current.map((source, i) => (i === index ? { ...source, ...patch } : source)));
    }, [write]);

    const removeSource = useCallback((index: number) => {
        if (!held.current[index]) return;
        write(held.current.filter((_, i) => i !== index));
    }, [write]);

    useEffect(() => {
        if (readId === null) return;
        let cancelled = false;
        setDecisionsLoading(true);
        Promise.all(sources.map(async source => {
            const files = await client.listFiles(source.path).catch(() => []);
            const markdown = files.filter(file => !file.isDirectory && file.path.toLowerCase().endsWith('.md'));
            const parsed = await Promise.all(markdown.map(async file => {
                const text = await client.getFileText(file.path).catch(() => '');
                return text ? parseDecision(file.path, displayNameOf(source), text) : null;
            }));
            return parsed.filter((d): d is Decision => d !== null);
        })).then(groups => {
            if (cancelled) return;
            setDecisions(groups.flat());
            setDecisionsLoading(false);
        });
        return () => { cancelled = true; };
    }, [client, sources, readId]);

    const value = useMemo<DecisionsValue>(
        () => ({
            sources, sourcesLoading, decisions, decisionsLoading,
            addSourcePaths, updateSource, removeSource, ensureLoaded, reload,
        }),
        [sources, sourcesLoading, decisions, decisionsLoading, addSourcePaths, updateSource, removeSource, ensureLoaded, reload],
    );

    return <DecisionsContext.Provider value={value}>{children}</DecisionsContext.Provider>;
};
