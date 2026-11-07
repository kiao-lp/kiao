import React, { useCallback } from 'react';
import { NodeIndexOutlined } from '@ant-design/icons';
import { useWorkerClient, useRenameTarget, useRefreshFileList, useCreationCommand } from '@cms-core';
import { emptyMindmapDocument } from './model';

export const MindmapCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createMindmap = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Mindmap.mmap.json`;
        await client.saveDocument(newFilePath, emptyMindmapDocument());
        refreshFileList();
        setTimeout(() => {
            startRename(newFilePath);
        }, 250);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-mindmap', {
        id: 'new-mindmap',
        label: 'Mindmap',
        icon: <NodeIndexOutlined />,
        order: 40,
        execute: (ctx) => createMindmap(ctx.currentPath)
    }, [createMindmap]);

    return <>{children}</>;
};
