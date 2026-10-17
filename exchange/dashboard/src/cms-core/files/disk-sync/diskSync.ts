export type DiskChange =
    | 'in-sync'
    | 'reload'
    | 'conflict';

/**
 * synced is the text last read or handed to the writer.
 * disk === local covers our own save, including writes not yet reflected in synced.
 * disk === synced covers our own save followed by further local edits.
 */
export const decideDiskChange = (disk: string, local: string, synced: string): DiskChange => {
    if (disk === local) return 'in-sync';
    if (disk === synced) return 'in-sync';
    if (local === synced) return 'reload';
    return 'conflict';
};
