import { createElement, useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { notification } from 'antd';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useRefreshFileList } from './CurrentFileList-ctx';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useRenameTarget } from '../selection/RenameTarget-ctx';
import { collectDeleteScope, DeleteScope } from './deleteScope';
import { InProgressFeedback } from './InProgressFeedback-cmp';
import { parentPath } from '../service';

const folderLabel = (path: string): string => path || '/';

const deleteSourceFolderLabel = (paths: string[]): string => {
    const folders = [...new Set(paths.map(parentPath))];
    return folders.length === 1 ? folderLabel(folders[0]) : 'multiple folders';
};

export interface FileOperations {
    /** What deleting the current selection would take with it — drives the confirm modal (null when closed). */
    deleteScope: DeleteScope | null;
    requestDelete: (paths: string[]) => void;
    confirmDelete: () => Promise<void>;
    cancelDelete: () => void;
    createFolder: (currentPath: string) => Promise<void>;
    handleDownload: (path: string) => void;
    handleReplace: (path: string) => void;
}

/**
 * The file browser's mutating operations (delete, create folder, download,
 * replace) plus the delete-confirmation target state. Kept out of the plugin
 * component so the hotkey/context-menu registration reads as declarative wiring.
 */
export const useFileOperations = (): FileOperations => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const selection = useFileSelection();
    const { startRename } = useRenameTarget();

    const [deleteScope, setDeleteScope] = useState<DeleteScope | null>(null);

    const requestDelete = useCallback(async (paths: string[]) => {
        if (paths.length === 0) return;
        try {
            // The server describes what would go, in one request. Failing to describe it is not a
            // reason to refuse: the selection is what the user chose, and it is what will be sent.
            setDeleteScope(await collectDeleteScope(client, paths));
        } catch (e) {
            console.error('Failed to describe the delete scope', paths, e);
            setDeleteScope({ selection: paths, entries: [], truncated: false });
        }
    }, [client]);

    const confirmDelete = useCallback(async () => {
        if (!deleteScope || deleteScope.selection.length === 0) return;

        // The selection, not its expansion: the server removes a directory with everything under
        // it, and one link-fix operation on a folder already rewrites every reference to anything
        // inside it. A path per descendant bought nothing, and cost an operation per descendant to
        // run over every line of every file the pass reads.
        const targets = deleteScope.selection;
        const sourceFolder = deleteSourceFolderLabel(targets);
        // Dismiss the confirmation before presenting the non-interrupting
        // in-progress feedback. flushSync makes that visual order explicit.
        flushSync(() => {
            setDeleteScope(null);
        });
        const key = `file-delete-${Date.now()}`;
        notification.open({
            key,
            message: `Deleting files from ${sourceFolder}…`,
            description: createElement(InProgressFeedback),
            duration: 0,
        });

        try {
            await client.deleteBatch(targets);
            notification.destroy(key);
            notification.success({ message: `Files deleted from ${sourceFolder}` });
        } catch (e) {
            console.error('Delete failed', targets, e);
            notification.destroy(key);
            notification.error({
                message: `Delete from ${sourceFolder} completed with errors`,
                description: 'Some files could not be deleted.',
            });
        }
        selection.clear();
        refreshFileList();
    }, [deleteScope, client, selection, refreshFileList]);

    const cancelDelete = useCallback(() => {
        setDeleteScope(null);
    }, []);

    const createFolder = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath.replace(/\/$/, '') : currentPath;
        const newFolderPath = `${dir}/New folder`;
        await client.createFolder(newFolderPath);
        refreshFileList();
        setTimeout(() => {
            startRename(newFolderPath);
        }, 250);
    }, [client, refreshFileList, startRename]);

    const handleDownload = useCallback((path: string) => {
        client.download(path).catch(console.error);
    }, [client]);

    const handleReplace = useCallback((path: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) {
                client.update(path, f).then(() => refreshFileList()).catch(console.error);
            }
        };
        input.click();
    }, [client, refreshFileList]);

    return { deleteScope, requestDelete, confirmDelete, cancelDelete, createFolder, handleDownload, handleReplace };
};
