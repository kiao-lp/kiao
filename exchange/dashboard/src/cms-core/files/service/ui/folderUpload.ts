import { WorkerClient } from '..';

/** File with its target-relative directory. */
export interface UploadItem {
    file: File;
    relativeDir: string;
}

export interface UploadTree {
    items: UploadItem[];
    /** Directories with no files; file uploads alone do not recreate them. */
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

/** Reads a picker selection. Uses `webkitRelativePath`; empty gives a flat upload with no empty dirs. */
export const collectFromInput = (files: File[]): UploadTree => ({
    items: files.map(file => ({ file, relativeDir: dirOf(file.webkitRelativePath || '') })),
    emptyDirs: [],
});

const readBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

// `readEntries` caps at ~100 per call and ends with an empty batch; loop or large folders truncate.
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

/** Captures entries before the drop handler returns; `DataTransfer` is invalid after. Empty when `webkitGetAsEntry` is unavailable. */
export const captureDroppedEntries = (dataTransfer: DataTransfer): FileSystemEntry[] =>
    Array.from(dataTransfer.items)
        .filter(item => item.kind === 'file')
        .map(item => item.webkitGetAsEntry?.() ?? null)
        .filter((entry): entry is FileSystemEntry => entry !== null);

export const collectFromEntries = async (entries: FileSystemEntry[]): Promise<UploadTree> => {
    const tree: UploadTree = { items: [], emptyDirs: [] };
    for (const entry of entries) await walkEntry(entry, '', tree);
    return tree;
};

/** Uploads the tree under `basePath`. The service creates missing parents; only empty dirs are created explicitly. */
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
