import { WorkerClient } from '../service';

export type ClipboardMode = 'cut' | 'copy';

export interface PasteOutcome {
    succeeded: number;
    failed: { path: string; error: unknown }[];
}

const basename = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
};

const joinPath = (folder: string, name: string): string => {
    const f = folder.replace(/\/$/, '');
    return f ? `${f}/${name}` : name;
};

export const performCut = async (
    client: WorkerClient,
    entries: string[],
    targetFolder: string,
): Promise<PasteOutcome> => {
    const outcome: PasteOutcome = { succeeded: 0, failed: [] };
    const toMove = entries.filter(src => joinPath(targetFolder, basename(src)) !== src);
    if (toMove.length === 0) return outcome;

    try {
        await client.moveBatch(toMove, targetFolder);
        outcome.succeeded = toMove.length;
    } catch (error) {
        // No per-entry retry: worker link-fixes the whole store per request.
        for (const src of toMove) {
            outcome.failed.push({ path: src, error });
        }
    }
    return outcome;
};

/**
 * Pastes with one copyBatch call. Worker handles recursion and naming;
 * a failed batch fails as a whole.
 */
export const performCopy = async (
    client: WorkerClient,
    entries: string[],
    targetFolder: string,
): Promise<PasteOutcome> => {
    const outcome: PasteOutcome = { succeeded: 0, failed: [] };
    if (entries.length === 0) return outcome;

    try {
        const results = await client.copyBatch(entries, targetFolder);
        outcome.succeeded = results.length;
    } catch (error) {
        for (const src of entries) {
            outcome.failed.push({ path: src, error });
        }
    }
    return outcome;
};
