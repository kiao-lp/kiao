import React, { useCallback } from 'react';
import { FileTextOutlined } from '@ant-design/icons';
import { useWorkerClient, useRenameTarget, useRefreshFileList, useCreationCommand } from '@cms-core';

export const TextCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createText = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Text.txt`;
        await client.update(newFilePath, "");
        refreshFileList();
        startRename(newFilePath);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-text', {
        id: 'new-text',
        label: 'Text',
        icon: <FileTextOutlined />,
        order: 25,
        execute: (ctx) => createText(ctx.currentPath)
    }, [createText]);

    return <>{children}</>;
};
