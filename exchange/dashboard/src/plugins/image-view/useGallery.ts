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
} from '@kiao-dashboard-core';
import { afterDeleting, imagesIn, positionOf } from './gallery';

export interface Gallery {
    /** 1-based rank among the folder images. */
    rank: number;
    count: number;
    /** Null at a folder end (disables the arrow). */
    previous: string | null;
    next: string | null;
    goPrevious: () => void;
    goNext: () => void;
    /** Confirm and delete the open image, then navigate onward. */
    remove: () => void;
}

/** Gallery state and actions for the open image. Uses the shared `useCurrentFileListContext` listing, refreshed by file operations. */
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
        // Compute destination before deletion.
        const destination = afterDeleting(images, path);

        Modal.confirm({
            title: `Delete “${extractName(path)}”?`,
            content: 'The picture is removed from the store.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    // deleteBatch also repairs links to the deleted file.
                    await client.deleteBatch([path]);
                } catch (error) {
                    console.error('Failed to delete the picture', path, error);
                    notification.error({ message: `Could not delete “${extractName(path)}”` });
                    return;
                }
                // Fall back to the folder if no image remains.
                navigation.open(storedLinkOf(destination ?? currentPath));
                refreshFileList();
            },
        });
    }, [path, images, client, navigation, currentPath, refreshFileList]);

    return { rank, count, previous, next, goPrevious, goNext, remove };
};
