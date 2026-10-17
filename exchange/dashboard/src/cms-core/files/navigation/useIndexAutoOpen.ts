import React, { useEffect, useRef } from 'react';
import { FileDto, extractName, parentPath } from '../service';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useCurrentFileListContext } from '../core/CurrentFileList-ctx';
import { useNavigation } from './NavigationModel';

const INDEX_NAME = 'Index';

/**
 * A folder's index file: a plain file named `Index` before its extension — `Index.md`,
 * `Index.mmap.json`, … The match is case-sensitive, so folders of sources full of
 * `index.ts` keep browsing as folders.
 */
export const isIndexFile = (file: FileDto) =>
    !file.isDirectory && extractName(file.path).split('.')[0] === INDEX_NAME;

// Whether `path` sits in `folder` or below it. The root folder is "", and everything is below it.
const isWithin = (path: string, folder: string) =>
    folder === '' ? path !== '' : path === folder || path.startsWith(folder + '/');

/**
 * Opening a folder that holds an index file opens that file instead of the listing, so a
 * folder can read as a page. Arriving from inside the folder — closing the index, or walking
 * back up from a descendant — shows the listing instead; that is what keeps the browser
 * reachable, and the close button an escape rather than a loop.
 *
 * The decision is taken once per visit, on the first listing that belongs to the folder:
 * later refreshes (a file renamed to `Index.md`, say) leave the browsing user alone.
 */
const useIndexAutoOpen = () => {
    const { currentPath, currentFile } = useFileBrowsingPersistenceContext();
    const files = useCurrentFileListContext();
    const nav = useNavigation();

    // What was open last, to tell entering a folder from coming back to it.
    const openPathRef = useRef<string | null>(null);
    // Whether this visit may still auto-open — the listing arrives after the folder itself.
    const armedRef = useRef(false);

    useEffect(() => {
        if (!currentFile) return;

        // A folder is named by currentPath, not by its own metadata: the store root reports
        // its path as "." while it is "" everywhere else, and the root would then never
        // recognise its own index as something it just came back from.
        const openPath = currentFile.isDirectory ? currentPath : currentFile.path;

        if (openPath !== openPathRef.current) {
            const previous = openPathRef.current;
            armedRef.current = previous === null || !isWithin(previous, openPath);
            openPathRef.current = openPath;
        }

        if (!currentFile.isDirectory || !armedRef.current) return;

        // The listing lags one fetch behind the folder; until it catches up, its entries
        // belong to the folder we came from and must not be mistaken for this one's.
        const listing = files.filter(file => parentPath(file.path) === currentPath);
        if (listing.length === 0) return;

        armedRef.current = false;

        // Several index files can coexist (`Index.md`, `Index.mmap.json`): the first listed wins.
        const index = listing.find(isIndexFile);
        if (index) nav.open(index.path);
    }, [currentFile, currentPath, files, nav]);
};

/**
 * Watching the folder listing is worth a component of its own: subscribing the file browser
 * itself would re-render it — and recompute its command, hotkey and context-menu registrations —
 * every time a listing lands. A leaf that renders nothing costs nothing.
 */
export const IndexAutoOpen: React.FC = () => {
    useIndexAutoOpen();
    return null;
};
