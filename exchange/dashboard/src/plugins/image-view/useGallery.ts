import { useCallback, useMemo } from 'react';
import { Modal, notification } from 'antd';
import {
    extractName,
    storedLinkOf,
    useCurrentFileListContext,
    useFileBrowsingPersistenceContext,
    useWorkerClient,
    useNavigation,
    useRefreshFileList,
} from '@cms-core';
import { afterDeleting, imagesIn, positionOf } from './gallery';

export interface Gallery {
    /** 1-based rank of the open picture among the folder's, and how many there are. */
    rank: number;
    count: number;
    /** Null at an end of the folder — what leaves an arrow disabled. */
    previous: string | null;
    next: string | null;
    goPrevious: () => void;
    goNext: () => void;
    /** Asks, then deletes the open picture and moves on to whatever is left. */
    remove: () => void;
}

/**
 * The open picture read as one of its folder's, and the two things that can be done with that:
 * step to a neighbour, and throw the open one away.
 *
 * The folder listing is the browser's own (`useCurrentFileListContext`) — a file's `currentPath`
 * *is* its folder, so the listing already on hand is the right one and no second request is made
 * for it. It is also refreshed by every file operation the app runs, so a picture deleted from the
 * file browser in another pane stops being a neighbour here without this hook watching anything.
 */
export const useGallery = (): Gallery => {
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const files = useCurrentFileListContext();
    const navigation = useNavigation();
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();

    const path = currentFile?.path ?? '';
    const images = useMemo(() => imagesIn(files), [files]);
    const { rank, count, previous, next } = useMemo(() => positionOf(images, path), [images, path]);

    const open = useCallback(
        (target: string | null) => { if (target) navigation.open(storedLinkOf(target)); },
        [navigation],
    );

    const goPrevious = useCallback(() => open(previous), [open, previous]);
    const goNext = useCallback(() => open(next), [open, next]);

    const remove = useCallback(() => {
        if (!path) return;
        // Read before the deletion: the listing this answers from no longer holds the file after.
        const destination = afterDeleting(images, path);

        Modal.confirm({
            title: `Delete “${extractName(path)}”?`,
            content: 'The picture is removed from the store.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    // `deleteBatch`, as the file browser deletes: it is the request that also
                    // fixes the links pointing at what is going.
                    await client.deleteBatch([path]);
                } catch (error) {
                    console.error('Failed to delete the picture', path, error);
                    notification.error({ message: `Could not delete “${extractName(path)}”` });
                    return;
                }
                // The folder itself when nothing is left to look at.
                navigation.open(storedLinkOf(destination ?? currentPath));
                refreshFileList();
            },
        });
    }, [path, images, client, navigation, currentPath, refreshFileList]);

    return { rank, count, previous, next, goPrevious, goNext, remove };
};
