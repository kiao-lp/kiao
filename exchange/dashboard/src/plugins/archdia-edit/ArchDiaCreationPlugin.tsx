import React, { useCallback } from 'react';
import { PartitionOutlined } from '@ant-design/icons';
import { useWorkerClient, useRenameTarget, useRefreshFileList, useCreationCommand } from '@cms-core';

export const ArchDiaCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createArchDia = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Diagram.arch.md`;
        const defaultContent = `@startuml\ncomponent "New Component"\n@enduml\n---\n{\n  "size": {\n    "width": 1024,\n    "height": 768\n  },\n  "positions": {}\n}`;
        await client.update(newFilePath, defaultContent);
        refreshFileList();
        setTimeout(() => {
            startRename(newFilePath);
        }, 250);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-archdia', {
        id: 'new-archdia',
        label: 'Architecture Diagram',
        icon: <PartitionOutlined />,
        order: 30,
        execute: (ctx) => createArchDia(ctx.currentPath)
    }, [createArchDia]);

    return <>{children}</>;
};
