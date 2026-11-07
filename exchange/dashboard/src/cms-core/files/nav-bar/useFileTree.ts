import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FileDto, parentPath } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useGlobalViewState } from 'src/cms-core/view-state';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useCurrentFileListContext, useStoreRevision } from '../core/CurrentFileList-ctx';
import { useNavTreeStore } from './NavTreeStore-ctx';
import { FileTreeRow, ROOT, buildRows, folderChain, foldersToLoad, withListing } from './fileTreeModel';

const sameListing = (a: FileDto[] | undefined, b: FileDto[]) => JSON.stringify(a) === JSON.stringify(b);

export interface FileTreeApi {
    rows: FileTreeRow[];
    /** Toggles a branch and moves git focus to it. Reopening reloads its listing. */
    toggle: (path: string) => void;
    /** Opens all ancestors of `folder`. */
    expandTo: (folder: string) => void;
    /** True while an expanded row has no listing yet. */
    settling: boolean;
}

/** Store tree state: persisted expansion and per-folder listings. Toggling does not navigate; it moves git focus. */
export const useFileTree = (): FileTreeApi => {
    const client = useWorkerClient();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const currentListing = useCurrentFileListContext();
    const storeRevision = useStoreRevision();
    const [navTree, setNavTree] = useGlobalViewState('navTree', { expanded: [ROOT] as string[] });
    // Listings and in-flight requests live in NavTreeStore, above the pane.
    const { children, setChildren, inFlight, setFocusedPath } = useNavTreeStore();

    const expanded = useMemo(() => new Set(navTree.expanded), [navTree.expanded]);
    const rows = useMemo(() => buildRows(children, expanded), [children, expanded]);

    // Prevents duplicate in-flight requests per folder.
    const load = useCallback((folder: string) => {
        if (inFlight.current.has(folder)) return;
        inFlight.current.add(folder);
        client.listFiles(folder)
            .then(entries => setChildren(prev => (sameListing(prev[folder], entries) ? prev : withListing(prev, folder, entries))))
            .catch(error => {
                console.error('Navigation tree: failed to list', folder, error);
                // Cache as empty so a missing folder is not retried on every render.
                setChildren(prev => (prev[folder] ? prev : { ...prev, [folder]: [] }));
            })
            .finally(() => { inFlight.current.delete(folder); });
    }, [client, setChildren, inFlight]);

    const unread = useMemo(() => foldersToLoad(rows, children), [rows, children]);

    // The browsed folder is excluded; its listing comes from the browser below.
    const pending = useMemo(() => unread.filter(folder => folder !== currentPath), [unread, currentPath]);

    useEffect(() => { pending.forEach(load); }, [pending, load]);

    // Re-reads loaded expanded rows on mount and on store change, once per revision.
    // Covers changes outside the browsed folder.
    const refreshed = useRef(-1);
    useEffect(() => {
        if (refreshed.current === storeRevision) return;
        refreshed.current = storeRevision;
        rows.filter(row => row.expanded && children[row.path] && row.path !== currentPath)
            .forEach(row => load(row.path));
    }, [storeRevision, rows, children, currentPath, load]);

    const expandTo = useCallback((folder: string) => {
        setNavTree(prev => {
            const missing = folderChain(folder).filter(chained => !prev.expanded.includes(chained));
            return missing.length === 0 ? prev : { ...prev, expanded: [...prev.expanded, ...missing] };
        });
    }, [setNavTree]);

    useEffect(() => { expandTo(currentPath); }, [currentPath, expandTo]);

    // Browsing moves git focus; `expandTo` alone must not.
    useEffect(() => { setFocusedPath(currentPath); }, [currentPath, setFocusedPath]);

    // Reuses the browser listing for the browsed folder.
    // Ignores it while it still holds the previous folder's entries.
    useEffect(() => {
        if (!currentListing.every(file => parentPath(file.path) === currentPath)) return;
        setChildren(prev => (sameListing(prev[currentPath], currentListing)
            ? prev
            : withListing(prev, currentPath, currentListing)));
    }, [currentListing, currentPath, setChildren]);

    const toggle = useCallback((path: string) => {
        const collapsing = expanded.has(path);
        setNavTree(prev => ({
            ...prev,
            expanded: collapsing ? prev.expanded.filter(folder => folder !== path) : [...prev.expanded, path],
        }));
        setFocusedPath(path);
        if (!collapsing) load(path);
    }, [expanded, setNavTree, setFocusedPath, load]);

    return { rows, toggle, expandTo, settling: unread.length > 0 };
};
