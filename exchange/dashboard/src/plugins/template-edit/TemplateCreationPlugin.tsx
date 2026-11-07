import React, { useCallback } from 'react';
import { FileTextOutlined } from '@ant-design/icons';
import { useWorkerClient, useRenameTarget, useRefreshFileList, useCreationCommand } from '@cms-core';
import { serializeTempMd } from '@cms-kit/template-lang';

export const TemplateCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createTemplate = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Template.temp.md`;
        await client.update(newFilePath, serializeTempMd({
            index: "",
            name: "New Template",
            rootTemplate: {
                id: "root",
                textTemplate: ""
            },
            subTemplates: []
        }));
        refreshFileList();
        setTimeout(() => {
            startRename(newFilePath);
        }, 250);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-template', {
        id: 'new-template',
        label: 'Template',
        icon: <FileTextOutlined />,
        order: 50,
        execute: (ctx) => createTemplate(ctx.currentPath)
    }, [createTemplate]);

    return <>{children}</>;
};
