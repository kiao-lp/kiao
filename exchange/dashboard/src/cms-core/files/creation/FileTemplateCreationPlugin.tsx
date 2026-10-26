import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOutlined, FileOutlined } from '@ant-design/icons';
import { useWorkerClient } from '../service/ui';
import { useRenameTarget } from '../selection/RenameTarget-ctx';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { useCreationCommandList } from './useCreationCommand';
import { CreationCommandDescriptor } from './CreationCommandRegistry';
import { FileDto, WorkerClient } from '../service';

const TEMPLATES_ROOT = 'kiao-user-config/file-templates';

const extractName = (path: string) => path.split('/').pop() || path;

export const FileTemplateCreationPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient() as WorkerClient;
    const { startRename } = useRenameTarget();
    const refreshFileList = useRefreshFileList();
    const [templates, setTemplates] = useState<FileDto[]>([]);

    useEffect(() => {
        let cancelled = false;
        client.listFiles(TEMPLATES_ROOT)
            .then(files => { if (!cancelled) setTemplates(files); })
            .catch(() => { if (!cancelled) setTemplates([]); });
        return () => { cancelled = true; };
    }, [client]);

    const applyTemplate = useCallback(async (template: FileDto, currentPath: string) => {
        const dir = currentPath.endsWith('/') ? currentPath.replace(/\/$/, '') : currentPath;
        // The service copies the whole template — a folder template with all its
        // contents — in one call, and reports where it landed: applying the same
        // template twice yields a " (copy)" name instead of overwriting the first.
        const [result] = await client.copyBatch([template.path], dir);
        refreshFileList();
        setTimeout(() => {
            startRename(result.to);
        }, 250);
    }, [client, refreshFileList, startRename]);

    const commands: CreationCommandDescriptor[] = useMemo(() =>
        templates
            .slice()
            .sort((a, b) => extractName(a.path).toLowerCase().localeCompare(extractName(b.path).toLowerCase()))
            .map((template, index) => ({
                id: `file-template-${template.path}`,
                label: extractName(template.path),
                icon: template.isDirectory ? <FolderOutlined /> : <FileOutlined />,
                order: 100 + index,
                execute: (ctx) => applyTemplate(template, ctx.currentPath),
            })),
    [templates, applyTemplate]);

    useCreationCommandList('file-template-creation', commands, [commands]);

    return <>{children}</>;
};
