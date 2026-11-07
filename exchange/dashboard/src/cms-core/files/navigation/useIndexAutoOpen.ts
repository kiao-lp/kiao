import React, { useEffect, useRef } from 'react';
import { FileDto, extractName, parentPath } from '../service';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useCurrentFileListContext } from '../core/CurrentFileList-ctx';
import { useNavigation } from './NavigationModel';

const INDEX_NAME = 'Index';

/** True for a non-directory named `Index` before its extension. Case-sensitive. */
export const isIndexFile = (file: FileDto) =>
    !file.isDirectory && extractName(file.path).split('.')[0] === INDEX_NAME;

// Whether `path` sits in `folder` or below it. The root folder is "", and everything is below it.
const isWithin = (path: string, folder: string) =>
    folder === '' ? path !== '' : path === folder || path.startsWith(folder + '/');

// Auto-opens the index on entry from outside; shows the listing on return from inside.
// Decides once per visit, on the first listing for the folder.
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

        // Use `currentPath` for folders: the root reports "." as its path, "" elsewhere.
        // Using "." would break return detection for the root index.
        const openPath = currentFile.isDirectory ? currentPath : currentFile.path;

        if (openPath !== openPathRef.current) {
            const previous = openPathRef.current;
            armedRef.current = previous === null || !isWithin(previous, openPath);
            openPathRef.current = openPath;
        }

        if (!currentFile.isDirectory || !armedRef.current) return;

        // Ignore the listing until its entries belong to `currentPath`.
        const listing = files.filter(file => parentPath(file.path) === currentPath);
        if (listing.length === 0) return;

        armedRef.current = false;

        // Several index files can coexist (`Index.md`, `Index.mmap.json`): the first listed wins.
        const index = listing.find(isIndexFile);
        if (index) nav.open(index.path);
    }, [currentFile, currentPath, files, nav]);
};

/** Leaf component for the listing subscription. Keeps listing updates from re-rendering the file browser. */
export const IndexAutoOpen: React.FC = () => {
    useIndexAutoOpen();
    return null;
};
