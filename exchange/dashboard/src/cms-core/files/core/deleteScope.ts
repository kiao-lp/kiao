import { WorkerClient, FileDto } from '../service';

export interface DeleteScope {
    /** Original selection, sent to the recursive delete endpoint. */
    selection: string[];
    /** Includes the selection, in walk order; only a prefix when truncated. */
    entries: FileDto[];
    /** The server cap omitted further entries. */
    truncated: boolean;
}

/**
 * Fetch a bounded preview for confirmation; delete the original selection, not the preview.
 * Callers may fall back to confirming the selection if the preview fails.
 */
export const collectDeleteScope = async (
    client: WorkerClient,
    selection: string[],
): Promise<DeleteScope> => {
    if (selection.length === 0) return { selection, entries: [], truncated: false };
    const { files, truncated } = await client.listRecursive(selection);
    return { selection, entries: files, truncated };
};
