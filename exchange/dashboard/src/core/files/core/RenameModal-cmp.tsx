import React from 'react';
import { useNavigate } from 'react-router-dom';
import { NameDialog } from '../../ui-foundation/forms/NameDialog';
import { parentPath, extractName, renameSelectionRange } from 'src/core/files/service';
import { usePluginListContext } from 'src/core/extensibility/PluginList-ctx';
import { useWorkerClient } from 'src/core/files/service/ui';
import { useFileBrowsingPersistenceContext } from './FileBrowsingPersistence-ctx';
import { useCurrentFileListContext, useRefreshFileList } from './CurrentFileList-ctx';
import { useRenameTarget } from '../selection/RenameTarget-ctx';

export const RenameModal: React.FC = () => {
    const { renameTarget, cancelRename } = useRenameTarget();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { knownExtensions } = usePluginListContext();
    const fileList = useCurrentFileListContext();
    const navigate = useNavigate();
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();

    const currentName = renameTarget ? extractName(renameTarget) : '';
    const isDirectory = fileList.find(file => file.path === renameTarget)?.isDirectory;

    const rename = async (name: string) => {
        if (!renameTarget || !name || name === currentName) return;
        const newPath = `${parentPath(renameTarget)}/${name}`;
        await client.rename(renameTarget, newPath);
        refreshFileList();
        if (renameTarget === currentFile?.path) navigate(newPath);
    };

    return (
        <NameDialog
            open={renameTarget !== null}
            title="Rename"
            label={isDirectory ? 'Folder name' : 'File name'}
            okText="Rename"
            initialName={currentName}
            selection={renameSelectionRange(currentName, isDirectory ? [] : knownExtensions)}
            inputTestId="rename-input"
            voice
            allowEmpty
            onSubmit={rename}
            onClose={cancelRename}
        />
    );
};
