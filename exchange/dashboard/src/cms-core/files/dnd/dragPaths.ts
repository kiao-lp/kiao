/**
 * Store drag protocol: application/x-kiao-paths carries a JSON string array;
 * application/x-kiao-folders identifies its directory subset. text/plain is exported for other apps, never accepted as a store drag.
 * Allow copyMove: folder targets move entries, while text targets copy their paths.
 */

import { extractName, FileDto } from '../service';
import { storedLinkOf } from '../../lib/internal-links';

const PATHS_MIME = 'application/x-kiao-paths';
const FOLDERS_MIME = 'application/x-kiao-folders';

export interface DraggedFile {
    path: string;
    isDirectory: boolean;
}

const parseList = (raw: string | undefined): string[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(entry => typeof entry === 'string') : [];
    } catch {
        return [];
    }
};

/** Call during dragstart, when the drag data is writable. */
export const writeDraggedFiles = (data: DataTransfer, files: DraggedFile[]): void => {
    const paths = files.map(file => file.path);
    data.setData(PATHS_MIME, JSON.stringify(paths));
    data.setData(FOLDERS_MIME, JSON.stringify(files.filter(file => file.isDirectory).map(file => file.path)));
    data.setData('text/plain', paths.join('\n'));
    data.effectAllowed = 'copyMove';
};

/** Empty for drags without store paths. */
export const readDraggedFiles = (data: DataTransfer | null): DraggedFile[] => {
    const paths = parseList(data?.getData(PATHS_MIME));
    if (!paths.length) return [];
    const folders = new Set(parseList(data?.getData(FOLDERS_MIME)));
    return paths.map(path => ({ path, isDirectory: folders.has(path) }));
};

/** All selected paths must belong to this listing so their directory flags are available. */
export const draggedSelection = (paths: string[], listing: FileDto[]): DraggedFile[] => {
    const folders = new Set(listing.filter(file => file.isDirectory).map(file => file.path));
    return paths.map(path => ({ path, isDirectory: folders.has(path) }));
};

export const draggedPaths = (data: DataTransfer | null): string[] =>
    readDraggedFiles(data).map(file => file.path);

/** During dragover, browsers expose types but prohibit reading drag data. */
export const holdsDraggedFiles = (data: DataTransfer | null): boolean =>
    Array.from(data?.types ?? []).includes(PATHS_MIME);

/** Strip brackets from the label so entry names cannot break the markdown link. */
export const markdownLinkOf = ({ path }: DraggedFile): string =>
    `[${(extractName(path) || '/').replace(/[[\]]/g, '')}](${storedLinkOf(path)})`;

export const markdownLinksOf = (files: DraggedFile[]): string =>
    files.map(markdownLinkOf).join(' ');
