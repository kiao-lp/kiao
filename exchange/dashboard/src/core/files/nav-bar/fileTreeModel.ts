import { FileDto, parentPath } from 'src/core/files/service';

/** Store root path. Parent of top-level entries. */
export const ROOT = '';

/** Synthetic root entry. Listings have no root entry. */
export const ROOT_FILE: FileDto = { path: ROOT, isDirectory: true, size: 0, lastModified: 0 };

export interface FileTreeRow {
    path: string;
    file: FileDto;
    /** Root is 0. Its entries are 1. */
    depth: number;
    /** False for folders known to be empty. */
    expandable: boolean;
    expanded: boolean;
    isRoot: boolean;
}

/** Loaded listings by folder path. A missing key means not loaded. */
export type LoadedChildren = Record<string, FileDto[] | undefined>;

/**
 * Sets `folder` to `entries` and drops direct children no longer listed.
 * Deeper stale entries stay unreachable for the session.
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

/** Ancestor folders of `folder`, root first. */
export const folderChain = (folder: string): string[] => {
    const chain = [ROOT];
    let walked = '';
    for (const segment of folder.split('/').filter(Boolean)) {
        walked = walked ? `${walked}/${segment}` : segment;
        chain.push(walked);
    }
    return chain;
};

/** True for directories unless `childrenCount` is 0. A missing count is expandable. */
export const isExpandable = (file: FileDto): boolean =>
    file.isDirectory && file.childrenCount !== 0;

const byFolderThenName = (a: FileDto, b: FileDto): number => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
};

/**
 * Flattens loaded listings. Walks only expanded, loaded folders.
 * An expanded folder without a listing yields only its own row.
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

/** Expanded visible rows with no loaded listing. */
export const foldersToLoad = (rows: FileTreeRow[], children: LoadedChildren): string[] =>
    rows.filter(row => row.expanded && !children[row.path]).map(row => row.path);
