import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { VoiceInput } from '../../ui/VoiceInput';
import { parentPath, extractName, renameSelectionRange } from 'src/cms-core/files/service';
import { usePluginListContext } from 'src/cms-core/core/PluginList-ctx';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
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

    const isOpen = renameTarget !== null;
    const currentName = renameTarget ? extractName(renameTarget) : '';
    const [name, setName] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
        }
    }, [isOpen, currentName]);

    const targetIsDirectory = useMemo(
        () => !!renameTarget && !!fileList.find(file => file.path === renameTarget)?.isDirectory,
        [renameTarget, fileList],
    );

    const finishRename = useCallback(async () => {
        if (!renameTarget) return;
        const finalName = name.trim();
        if (finalName && finalName !== currentName) {
            const newPath = `${parentPath(renameTarget)}/${finalName}`;
            await client.rename(renameTarget, newPath);
            refreshFileList();
            if (currentFile && renameTarget === currentFile.path) {
                navigate(newPath);
            }
        }
        cancelRename();
    }, [renameTarget, name, currentName, client, refreshFileList, currentFile, navigate, cancelRename]);

    const focusInput = useCallback((open: boolean) => {
        if (!open) return;
        const input = wrapperRef.current?.querySelector('input');
        if (!input) return;
        input.focus();
        const { start, end } = renameSelectionRange(currentName, targetIsDirectory ? [] : knownExtensions);
        input.setSelectionRange(start, end);
    }, [currentName, knownExtensions, targetIsDirectory]);

    return (
        <Modal
            title="Rename"
            open={isOpen}
            onOk={finishRename}
            onCancel={cancelRename}
            okText="Rename"
            afterOpenChange={focusInput}
            destroyOnHidden
        >
            <div ref={wrapperRef}>
                <VoiceInput
                    type='text'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onPressEnter={finishRename}
                    autoFocus
                    data-testid="rename-input"
                />
            </div>
        </Modal>
    );
};
