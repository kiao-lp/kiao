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
        // No per-entry retry, for the same reason performCopy has none: worker runs the
        // link-fixer over the whole store once per request, so retrying entry by entry does that
        // walk N more times — and the usual reason the batch failed is that it was already too
        // slow for the proxy's read timeout, with the move itself very possibly done.
        for (const src of toMove) {
            outcome.failed.push({ path: src, error });
        }
    }
    return outcome;
};

/**
 * Pastes copied entries into a folder with a single `copyBatch` call.
 *
 * The whole recursion — walking a directory, resolving " (copy)" names, refusing a destination
 * that sits inside its own source — lives in worker. Doing it here meant one round trip
 * per file plus a probe per candidate name, which on a folder of any size read as a hang. There
 * is deliberately no per-file fallback: a batch that fails fails as a whole, exactly like the
 * recursive delete.
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
