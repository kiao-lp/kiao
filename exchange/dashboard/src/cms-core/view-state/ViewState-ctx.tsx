import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import {
    DirtyKey,
    EMPTY_VIEW_STATE,
    ViewStateFile,
    ViewStateScope,
    dirtyKeyId,
    fileScope,
    folderScope,
    isUnchanged,
    mergeDirtyInto,
    normalizeViewState,
    readValue,
    viewStateDocFor,
    withFileScope,
    withFolderScope,
    withGlobal,
} from './viewStateModel';

/** How long editing settles before the file is written. */
const SAVE_DEBOUNCE_MS = 1500;

/**
 * The document this session belongs to, by viewport width — see
 * `viewStateDocFor`.
 *
 * Read once, when the provider mounts, and kept for the whole session. A window
 * dragged across the breakpoint mid-session keeps writing where it started:
 * switching would mean re-seeding every mounted pane from a document it has
 * never read, which is the flicker this whole mechanism exists to avoid. The
 * next load picks up the right one.
 */
const currentViewStateDoc = (): string => viewStateDocFor(window.innerWidth);

interface ViewStateContextValue {
    getFileScope: <T extends object>(path: string, key: string, defaults: T) => T;
    setFileScope: (path: string, key: string, value: ViewStateScope) => void;
    getFolderScope: <T extends object>(path: string, key: string, defaults: T) => T;
    setFolderScope: (path: string, key: string, value: ViewStateScope) => void;
    getGlobal: <T>(key: string, fallback: T) => T;
    setGlobal: (key: string, value: unknown) => void;
    /** Write pending changes now; awaited on file switch and tab hide. */
    flush: () => void;
}

/**
 * Outside a provider — a unit test, a component rendered in isolation — every
 * read yields the caller's defaults and every write is dropped. Remembering a
 * layout is an enhancement; nothing should break for lack of it.
 */
const INERT_STORE: ViewStateContextValue = {
    getFileScope: (_path, _key, defaults) => defaults,
    setFileScope: () => { },
    getFolderScope: (_path, _key, defaults) => defaults,
    setFolderScope: () => { },
    getGlobal: (_key, fallback) => fallback,
    setGlobal: () => { },
    flush: () => { },
};

const ViewStateContext = createContext<ViewStateContextValue>(INERT_STORE);
const ViewStateReadyContext = createContext(false);

export const ViewStateReady: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    useContext(ViewStateReadyContext) ? <>{children}</> : <div>Loading view state…</div>;

export const useViewStateStore = (): ViewStateContextValue => useContext(ViewStateContext);

/**
 * Loads the view state config document at startup and owns every write to it.
 *
 * Which document depends on how wide the viewport is: a small screen keeps its
 * layout apart from a roomy one, since neither arrangement suits the other.
 *
 * ViewStateReady mounts panes once the document has resolved, so each seeds its
 * `useState` from the stored value in the same tick it mounts — restoring a
 * layout without ever painting the default one first.
 *
 * Failure is never fatal: a missing document is seeded, and any other error
 * falls back to an empty one. In that degraded case writing is disabled, so a
 * backend hiccup can never overwrite good state with defaults.
 */
export const ViewStateProvider: React.FC<{
    children: React.ReactNode;
    /** Defer the gate to ViewStateReady so independent startup requests can begin immediately. */
    waitForLoad?: boolean;
}> = ({ children, waitForLoad = true }) => {
    const workerClient = useWorkerClient();
    const [loaded, setLoaded] = useState(false);
    const [docName] = useState(currentViewStateDoc);

    const docRef = useRef<ViewStateFile>({ ...EMPTY_VIEW_STATE });
    /** Only the scopes this tab touched are pushed back — see mergeDirtyInto. */
    const dirtyRef = useRef<Map<string, DirtyKey>>(new Map());
    const writableRef = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const raw = await workerClient.getConfigJson<unknown>(docName);
                if (cancelled) return;
                docRef.current = normalizeViewState(raw);
                writableRef.current = true;
            } catch (e) {
                if (e instanceof WorkerError && e.response.status === 404) {
                    // First run: seed the document so it exists and is hand-editable.
                    try {
                        await workerClient.saveConfigJson(docName, EMPTY_VIEW_STATE);
                        writableRef.current = true;
                    } catch (saveErr) {
                        console.warn('View state: failed to create the state document', saveErr);
                    }
                } else {
                    // Backend unreachable or malformed document: run on defaults and,
                    // crucially, do not write — we would clobber what we could not read.
                    console.warn('View state: failed to load, running without persistence', e);
                }
            }
            if (!cancelled) setLoaded(true);
        };

        load();
        return () => { cancelled = true; };
    }, [workerClient, docName]);

    const write = useCallback(async () => {
        if (!writableRef.current || dirtyRef.current.size === 0) return;
        const dirty = [...dirtyRef.current.values()];
        dirtyRef.current.clear();
        try {
            // Re-read before writing: unit content opens in new browser tabs, so
            // another tab may have saved since we loaded, and worker has
            // no ETag to detect it.
            let remote: ViewStateFile;
            try {
                remote = normalizeViewState(await workerClient.getConfigJson<unknown>(docName));
            } catch {
                remote = { ...EMPTY_VIEW_STATE };
            }
            const merged = mergeDirtyInto(remote, docRef.current, dirty, Date.now());
            docRef.current = merged;
            await workerClient.saveConfigJson(docName, merged);
        } catch (e) {
            console.warn('View state: failed to save', e);
        }
    }, [workerClient, docName]);

    const scheduleSave = useMemo(() => debounce(() => { void write(); }, SAVE_DEBOUNCE_MS), [write]);

    const flush = useCallback(() => { scheduleSave.flush(); }, [scheduleSave]);

    useEffect(() => {
        // A tab going away — closed, reloaded, or leaving for the OIDC redirect —
        // must not take the last few seconds of layout changes with it.
        const onHide = () => { if (document.visibilityState === 'hidden') scheduleSave.flush(); };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('beforeunload', flush);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('beforeunload', flush);
            scheduleSave.flush();
        };
    }, [scheduleSave, flush]);

    const markDirty = useCallback((key: DirtyKey) => {
        dirtyRef.current.set(dirtyKeyId(key), key);
        scheduleSave();
    }, [scheduleSave]);

    const value = useMemo<ViewStateContextValue>(() => ({
        getFileScope: (path, key, defaults) => fileScope(docRef.current, path, key, defaults),
        setFileScope: (path, key, scope) => {
            if (!path) return;
            if (isUnchanged(docRef.current.files[path]?.[key], scope)) return;
            docRef.current = withFileScope(docRef.current, path, key, scope, Date.now());
            markDirty({ section: 'files', path, key });
        },
        getFolderScope: (path, key, defaults) => folderScope(docRef.current, path, key, defaults),
        setFolderScope: (path, key, scope) => {
            if (isUnchanged(docRef.current.folders[path]?.[key], scope)) return;
            docRef.current = withFolderScope(docRef.current, path, key, scope);
            markDirty({ section: 'folders', path, key });
        },
        getGlobal: (key, fallback) => readValue(docRef.current.global, key, fallback),
        setGlobal: (key, v) => {
            if (isUnchanged(docRef.current.global[key], v)) return;
            docRef.current = withGlobal(docRef.current, key, v);
            markDirty({ section: 'global', key });
        },
        flush,
    }), [markDirty, flush]);

    return <ViewStateContext.Provider value={value}>
        <ViewStateReadyContext.Provider value={loaded}>
            {waitForLoad ? <ViewStateReady>{children}</ViewStateReady> : children}
        </ViewStateReadyContext.Provider>
    </ViewStateContext.Provider>;
};
