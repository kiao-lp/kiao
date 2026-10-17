import React, { useCallback } from 'react';
import { PictureOutlined } from '@ant-design/icons';
import { useCreationCommand, useRefreshFileList, useRenameTarget, useWorkerClient } from '@cms-core';
import { emptySvgDocument, encodeSvg } from './svgDocument';

export const SvgCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();

    const createSvg = useCallback(async (currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const newFilePath = `${dir}New Image.svg`;
        await client.update(newFilePath, encodeSvg(emptySvgDocument()));
        refreshFileList();
        setTimeout(() => {
            startRename(newFilePath);
        }, 250);
    }, [client, refreshFileList, startRename]);

    useCreationCommand('new-svg', {
        id: 'new-svg',
        label: 'SVG image',
        icon: <PictureOutlined />,
        order: 25,
        execute: (ctx) => createSvg(ctx.currentPath),
    }, [createSvg]);

    return <>{children}</>;
};
