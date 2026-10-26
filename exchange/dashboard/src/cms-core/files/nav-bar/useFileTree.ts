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
    /** Opens a branch — reading it again — or closes it, and takes the git focus with it. */
    toggle: (path: string) => void;
    /** Opens every branch from the root down to `folder`, so what it holds gets a row. */
    expandTo: (folder: string) => void;
    /**
     * Whether the tree is still filling: an open branch on screen is waiting for its
     * listing, so rows are still to appear — and the ones already drawn still to move.
     */
    settling: boolean;
}

/**
 * The browsable tree of the store: which branches are open, and the listings behind them.
 *
 * Branches are read one folder at a time, on the way in, and the set of open ones is
 * remembered across sessions. Opening the tree is browsing, not navigating: the document
 * on screen only changes when a row is clicked.
 *
 * What opening or closing a branch does move is the git focus (see NavTreeStore-ctx): the
 * Git panel acts on the folder the hand last touched, so a branch opened to be looked at
 * moves source control there without moving the document.
 *
 * The listings outlive the pane (see NavTreeStore-ctx), which a document of another type
 * takes down with it: the tree is re-read where it stands rather than rebuilt from the root.
 */
export const useFileTree = (): FileTreeApi => {
    const client = useWorkerClient();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const currentListing = useCurrentFileListContext();
    const storeRevision = useStoreRevision();
    const [navTree, setNavTree] = useGlobalViewState('navTree', { expanded: [ROOT] as string[] });
    // The listings read so far, and the requests already on their way — both held above the
    // pane, which a document of another type takes down with it.
    const { children, setChildren, inFlight, setFocusedPath } = useNavTreeStore();

    const expanded = useMemo(() => new Set(navTree.expanded), [navTree.expanded]);
    const rows = useMemo(() => buildRows(children, expanded), [children, expanded]);

    // One request per folder at a time: the pending list is recomputed on every listing
    // that lands, and would otherwise ask again for what is already on its way.
    const load = useCallback((folder: string) => {
        if (inFlight.current.has(folder)) return;
        inFlight.current.add(folder);
        client.listFiles(folder)
            .then(entries => setChildren(prev => (sameListing(prev[folder], entries) ? prev : withListing(prev, folder, entries))))
            .catch(error => {
                console.error('Navigation tree: failed to list', folder, error);
                // Remembered as empty rather than left missing: a folder that is gone
                // would otherwise be asked for again on every render.
                setChildren(prev => (prev[folder] ? prev : { ...prev, [folder]: [] }));
            })
            .finally(() => { inFlight.current.delete(folder); });
    }, [client, setChildren, inFlight]);

    // The open branches on screen whose listing has not landed. The tree is drawn from what
    // has arrived, so while one is missing the tree is still growing under what it shows.
    const unread = useMemo(() => foldersToLoad(rows, children), [rows, children]);

    // The open folder is left out of the fetching: it comes from the file browser's own
    // listing, below.
    const pending = useMemo(() => unread.filter(folder => folder !== currentPath), [unread, currentPath]);

    useEffect(() => { pending.forEach(load); }, [pending, load]);

    // Everything the tree already holds is read again, in place — the rows keep their offsets,
    // and a listing that comes back unchanged never reaches React at all. Twice over:
    //
    // On mount, because what was read stays on screen across one: this is the freshness a tree
    // rebuilt from its root used to get by accident.
    //
    // And on every change of the store, because a rename, a deletion or a creation is not the
    // browsed folder's business alone. Any row of the tree can be the one a context menu acts
    // on, so the folder that changed is as likely to be one the browser is not on — and the
    // browsed folder itself arrives from the file browser's listing, below, either way.
    //
    // One pass per revision: the guard is what lets the effect see the rows as they stand when
    // it fires, rather than as they stood when the store changed.
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

    // Wherever browsing lands, the tree opens down to it: a file reached from a search hit,
    // a link or a fresh tab is shown in place rather than left for the user to find.
    useEffect(() => { expandTo(currentPath); }, [currentPath, expandTo]);

    // And the git focus follows it there: opening a row is the hand touching it too, so by the
    // time the browser has landed the two agree again. Only a branch opened or closed without
    // navigating leaves them apart — which is what the focus is for. `expandTo` itself stays
    // out of it: a reveal centres a row nobody touched, and must not move source control.
    useEffect(() => { setFocusedPath(currentPath); }, [currentPath, setFocusedPath]);

    // The open folder is already listed for the file browser, and that listing is refreshed
    // after every file operation: taking it as-is spares a request and puts a creation or a
    // deletion in the tree at the moment it appears in the browser. It lags one fetch behind
    // the folder, so entries belonging to the folder just left are left alone until it catches up.
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
        // Either way the row is where the hand is: it takes the git focus with it, so the
        // Git panel acts on the folder just looked at rather than on the one browsed.
        setFocusedPath(path);
        // Opening a branch reads it again: a tree left open for a day would otherwise
        // keep showing what the folder held when it was first walked into.
        if (!collapsing) load(path);
    }, [expanded, setNavTree, setFocusedPath, load]);

    return { rows, toggle, expandTo, settling: unread.length > 0 };
};
