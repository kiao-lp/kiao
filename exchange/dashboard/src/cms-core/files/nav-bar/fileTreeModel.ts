import { FileDto, parentPath } from 'src/cms-core/files/service';

/** The store root, as the browsing context names it — the parent of a top-level entry. */
export const ROOT = '';

/** The root has no listing entry of its own to stand for it in the tree. */
export const ROOT_FILE: FileDto = { path: ROOT, isDirectory: true, size: 0, lastModified: 0 };

/** One visible line of the tree: an entry, its indentation, and its branch state. */
export interface FileTreeRow {
    path: string;
    file: FileDto;
    /** The root sits at 0, the entries it holds at 1, and so on. */
    depth: number;
    /** Whether the row gets an expander — a folder known to be empty does not. */
    expandable: boolean;
    expanded: boolean;
    isRoot: boolean;
}

/** The listings loaded so far, keyed by folder path; a missing key is a folder not yet read. */
export type LoadedChildren = Record<string, FileDto[] | undefined>;

/**
 * The listings to hold once `folder` is known to hold `entries` — the new one, and everything
 * read so far except what `folder` has stopped listing.
 *
 * A branch keeps its listing while it is closed, so a folder deleted with its branch open would
 * otherwise leave its children behind in the store, waiting to be drawn again under the next
 * folder created with the same name. Only the level below `folder` is looked at: a grandchild
 * whose parent goes with it is left, unreachable, to the end of the session.
 */
export const withListing = (
    children: LoadedChildren,
    folder: string,
    entries: FileDto[],
): LoadedChildren => {
    const held = new Set(entries.map(entry => entry.path));
    const kept = Object.fromEntries(
        Object.entries(children).filter(([path]) => path === folder || parentPath(path) !== folder || held.has(path)),
    );
    return { ...kept, [folder]: entries };
};

/** The folders from the store root down to `folder`, root first and `folder` last. */
export const folderChain = (folder: string): string[] => {
    const chain = [ROOT];
    let walked = '';
    for (const segment of folder.split('/').filter(Boolean)) {
        walked = walked ? `${walked}/${segment}` : segment;
        chain.push(walked);
    }
    return chain;
};

/**
 * A folder can be opened unless the store already said it holds nothing: the count comes
 * with the listing, so an entry that arrived without one is taken as openable.
 */
export const isExpandable = (file: FileDto): boolean =>
    file.isDirectory && file.childrenCount !== 0;

/** Folders first, then by name — the order a file explorer lists a folder in. */
const byFolderThenName = (a: FileDto, b: FileDto): number => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
};

/**
 * Flattens the loaded listings into the lines to draw, walking only into folders that are
 * both expanded and loaded. An expanded folder still missing its listing yields its own row
 * and nothing below it — which is exactly what tells the loader to go and fetch it.
 */
export const buildRows = (children: LoadedChildren, expanded: ReadonlySet<string>): FileTreeRow[] => {
    const rootExpanded = expanded.has(ROOT);
    const rows: FileTreeRow[] = [{
        path: ROOT,
        file: ROOT_FILE,
        depth: 0,
        expandable: true,
        expanded: rootExpanded,
        isRoot: true,
    }];

    const walk = (folder: string, depth: number) => {
        const entries = children[folder];
        if (!entries) return;
        for (const file of [...entries].sort(byFolderThenName)) {
            const isOpen = file.isDirectory && expanded.has(file.path);
            rows.push({
                path: file.path,
                file,
                depth,
                expandable: isExpandable(file),
                expanded: isOpen,
                isRoot: false,
            });
            if (isOpen) walk(file.path, depth + 1);
        }
    };

    if (rootExpanded) walk(ROOT, 1);

    return rows;
};

/**
 * The folders whose listing is needed to draw the tree as it stands: the visible expanded
 * ones that have never been read. Collapsed branches — and expanded ones buried under a
 * collapsed parent — are not fetched, so a deeply remembered expansion costs nothing until
 * it is walked back into.
 */
export const foldersToLoad = (rows: FileTreeRow[], children: LoadedChildren): string[] =>
    rows.filter(row => row.expanded && !children[row.path]).map(row => row.path);
