import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileBrowsingPersistenceContext } from 'src/cms-core/files/core/FileBrowsingPersistence-ctx';
import { useViewStateStore } from './ViewState-ctx';
import type { ViewStateScope } from './viewStateModel';

/** `setState`-shaped updater: a patch, or a function producing one. */
export type ScopeUpdater<T> = Partial<T> | ((prev: T) => Partial<T>);

/**
 * Remembered UI state for the file currently open, restored the next time that
 * same file is opened.
 *
 * `scopeKey` namespaces one plugin's slice, e.g. `'markdown'` or `'pdf'`. The
 * defaults are read once; adding a key to them later is safe, since a stored
 * scope is merged over the defaults rather than replacing them.
 *
 *     const [view, setView] = useFileViewState('pdf', { pageNumber: 1, zoom: 1 });
 *     setView({ pageNumber: 4 });
 */
export const useFileViewState = <T extends object>(
    scopeKey: string,
    defaults: T,
): [T, (updater: ScopeUpdater<T>) => void] => {
    const store = useViewStateStore();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const path = currentFile?.path ?? '';

    // Defaults are usually an inline literal, so its identity changes every
    // render; the first one wins and is never re-read.
    const defaultsRef = useRef(defaults);

    const [state, setState] = useState<T>(() => store.getFileScope(path, scopeKey, defaultsRef.current));
    const stateRef = useRef(state);
    stateRef.current = state;

    // A plugin's main view is not remounted when navigating between two files it
    // both handles, so the scope has to be re-seeded when the path changes under
    // it. This is the documented "adjust state while rendering" pattern.
    const [seededPath, setSeededPath] = useState(path);
    if (seededPath !== path) {
        const seeded = store.getFileScope(path, scopeKey, defaultsRef.current);
        stateRef.current = seeded;
        setSeededPath(path);
        setState(seeded);
    }

    const pathRef = useRef(path);
    pathRef.current = path;

    const update = useCallback((updater: ScopeUpdater<T>) => {
        const patch = typeof updater === 'function' ? updater(stateRef.current) : updater;
        const next = { ...stateRef.current, ...patch };
        stateRef.current = next;
        setState(next);
        store.setFileScope(pathRef.current, scopeKey, next as ViewStateScope);
    }, [store, scopeKey]);

    return [state, update];
};

/** Same, keyed by a folder path rather than the open file (file browser). */
export const useFolderViewState = <T extends object>(
    folderPath: string,
    scopeKey: string,
    defaults: T,
): [T, (updater: ScopeUpdater<T>) => void] => {
    const store = useViewStateStore();
    const defaultsRef = useRef(defaults);

    const [state, setState] = useState<T>(() => store.getFolderScope(folderPath, scopeKey, defaultsRef.current));
    const stateRef = useRef(state);
    stateRef.current = state;

    const [seededPath, setSeededPath] = useState(folderPath);
    if (seededPath !== folderPath) {
        const seeded = store.getFolderScope(folderPath, scopeKey, defaultsRef.current);
        stateRef.current = seeded;
        setSeededPath(folderPath);
        setState(seeded);
    }

    const pathRef = useRef(folderPath);
    pathRef.current = folderPath;

    const update = useCallback((updater: ScopeUpdater<T>) => {
        const patch = typeof updater === 'function' ? updater(stateRef.current) : updater;
        const next = { ...stateRef.current, ...patch };
        stateRef.current = next;
        setState(next);
        store.setFolderScope(pathRef.current, scopeKey, next as ViewStateScope);
    }, [store, scopeKey]);

    return [state, update];
};

/**
 * An app-wide preference — theme, the tool bar columns, voice language. Same contract
 * as `useState`, with the value persisted for the next session.
 */
export const useGlobalViewState = <T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] => {
    const store = useViewStateStore();
    const fallbackRef = useRef(fallback);

    const [state, setState] = useState<T>(() => store.getGlobal(key, fallbackRef.current));
    const stateRef = useRef(state);
    stateRef.current = state;

    const update = useCallback((next: T | ((prev: T) => T)) => {
        const value = typeof next === 'function' ? (next as (prev: T) => T)(stateRef.current) : next;
        stateRef.current = value;
        setState(value);
        store.setGlobal(key, value);
    }, [store, key]);

    return [state, update];
};

/**
 * Write pending view state as soon as the open file changes, so a crash between
 * two navigations cannot lose the layout of the file just left.
 */
export const useFlushViewStateOnFileChange = (): void => {
    const store = useViewStateStore();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const path = currentFile?.path ?? '';
    const previous = useRef(path);

    useEffect(() => {
        if (previous.current !== path) {
            previous.current = path;
            store.flush();
        }
    }, [path, store]);
};
