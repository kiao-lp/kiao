import React, { useCallback } from 'react';
import { FileMarkdownOutlined } from '@ant-design/icons';
import { useWorkerClient, useRenameTarget, useRefreshFileList, useCreationCommand } from '@cms-core';

export const MarkdownCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createMarkdown = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Markdown.md`;
        await client.update(newFilePath, "");
        refreshFileList();
        startRename(newFilePath);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-markdown', {
        id: 'new-markdown',
        label: 'Markdown',
        icon: <FileMarkdownOutlined />,
        order: 20,
        execute: (ctx) => createMarkdown(ctx.currentPath)
    }, [createMarkdown]);

    return <>{children}</>;
};
