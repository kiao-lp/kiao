import { WorkerClient } from '..';

/** A file to upload, with the directory it must land in, relative to the upload target. */
export interface UploadItem {
    file: File;
    relativeDir: string;
}

export interface UploadTree {
    items: UploadItem[];
    /** Directories holding no files at any depth; uploading files alone would not recreate these. */
    emptyDirs: string[];
}

export interface UploadOutcome {
    succeeded: number;
    failed: { path: string; error: unknown }[];
}

const UPLOAD_CONCURRENCY = 4;

export const joinPath = (...segments: string[]): string =>
    segments.filter(s => s !== '').join('/').replace(/\/{2,}/g, '/');

const dirOf = (relativePath: string): string => {
    const cut = relativePath.lastIndexOf('/');
    return cut < 0 ? '' : relativePath.substring(0, cut);
};

/**
 * Reads a picker selection. A webkitdirectory input reports each file's path inside the chosen
 * folder as webkitRelativePath; a plain multiple input leaves it empty, giving a flat upload.
 * Such an input only ever yields files, so it can report no empty directories.
 */
export const collectFromInput = (files: File[]): UploadTree => ({
    items: files.map(file => ({ file, relativeDir: dirOf(file.webkitRelativePath || '') })),
    emptyDirs: [],
});

const readBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

/**
 * readEntries yields at most ~100 entries per call and signals the end with an empty batch, so a
 * directory has to be drained in a loop — a single call silently truncates large folders.
 */
const readAllEntries = async (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
    const all: FileSystemEntry[] = [];
    for (;;) {
        const batch = await readBatch(reader);
        if (batch.length === 0) return all;
        all.push(...batch);
    }
};

const entryFile = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

const walkEntry = async (entry: FileSystemEntry, parentDir: string, tree: UploadTree): Promise<void> => {
    if (entry.isFile) {
        tree.items.push({ file: await entryFile(entry as FileSystemFileEntry), relativeDir: parentDir });
        return;
    }
    if (!entry.isDirectory) return;

    const dir = joinPath(parentDir, entry.name);
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    if (children.length === 0) {
        tree.emptyDirs.push(dir);
        return;
    }
    for (const child of children) await walkEntry(child, dir, tree);
};

/**
 * The DataTransfer is neutered once the drop handler returns, so entries must be taken from it
 * before the first await. Where webkitGetAsEntry is unavailable this yields no entries, and the
 * caller falls back to the (structure-less) file list.
 */
export const captureDroppedEntries = (dataTransfer: DataTransfer): FileSystemEntry[] =>
    Array.from(dataTransfer.items)
        .filter(item => item.kind === 'file')
        .map(item => item.webkitGetAsEntry?.() ?? null)
        .filter((entry): entry is FileSystemEntry => entry !== null);

/** Expands dropped entries, recursing into directories, into a flat list of files plus their paths. */
export const collectFromEntries = async (entries: FileSystemEntry[]): Promise<UploadTree> => {
    const tree: UploadTree = { items: [], emptyDirs: [] };
    for (const entry of entries) await walkEntry(entry, '', tree);
    return tree;
};

/**
 * Uploads the tree under basePath, recreating its structure. The service joins an upload's path
 * field with the filename and creates missing parents, so nesting needs no mkdir of its own —
 * only the directories that contain no files have to be created explicitly.
 */
export const uploadTree = async (
    client: WorkerClient,
    basePath: string,
    tree: UploadTree,
    onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> => {
    const outcome: UploadOutcome = { succeeded: 0, failed: [] };

    for (const dir of tree.emptyDirs) {
        const target = joinPath(basePath, dir);
        try {
            await client.createFolder(target);
        } catch (error) {
            outcome.failed.push({ path: target, error });
        }
    }

    const total = tree.items.length;
    let cursor = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
        for (;;) {
            const index = cursor++;
            if (index >= total) return;
            const { file, relativeDir } = tree.items[index];
            const target = joinPath(basePath, relativeDir);
            try {
                await client.upload(target, file);
                outcome.succeeded++;
            } catch (error) {
                outcome.failed.push({ path: joinPath(target, file.name), error });
            }
            done++;
            onProgress?.(done, total);
        }
    };

    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));
    return outcome;
};
