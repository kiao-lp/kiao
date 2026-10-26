import React, { useCallback } from 'react';
import { FileProtectOutlined } from '@ant-design/icons';
import { useCreationCommand, useRefreshFileList, useRenameTarget, useWorkerClient } from '@cms-core';

const initialSchema = JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'New Schema',
    type: 'object',
    properties: {},
}, null, 2) + '\n';

export const JsonSchemaCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const { startRename } = useRenameTarget();

    const create = useCallback(async (currentPath: string) => {
        const path = `${currentPath.replace(/\/?$/, '/')}New Schema.schema.json`;
        await client.update(path, initialSchema);
        refreshFileList();
        startRename(path);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('json-schema-edit', {
        id: 'new-json-schema',
        label: 'JSON Schema',
        icon: <FileProtectOutlined />,
        order: 28,
        execute: ctx => create(ctx.currentPath),
    }, [create]);

    return <>{children}</>;
};
