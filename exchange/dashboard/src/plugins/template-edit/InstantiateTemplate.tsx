import React, { useCallback } from 'react';
import { Modal, message } from 'antd';
import { extractName, useFileBrowsingPersistenceContext, useWorkerClient, useRefreshFileList } from '@cms-core';
import { TemplateInstantiation } from '@cms-kit/template-fields';
import { useTemplatePersistenceContext } from './TemplatePersistence-ctx';
import { instantiationTargetOf } from './instantiationTarget';

export const InstantiateTemplate: React.FC = () => {
    const { template } = useTemplatePersistenceContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();

    const target = currentFile ? instantiationTargetOf(currentFile.path) : null;

    const write = useCallback(async (path: string, result: string) => {
        try {
            await client.update(path, result);
            refreshFileList();
            message.success(`Instantiated into ${extractName(path)}`);
        } catch (e: any) {
            message.error(`Instantiation failed: ${e?.message ?? e}`);
        }
    }, [client, refreshFileList]);

    // Instantiating twice is the normal way of iterating on the values, so the
    // second time round the markdown file is simply rewritten — but only once
    // the user has agreed to lose whatever it holds.
    const instantiate = useCallback(async (result: string) => {
        if (!target) return;
        // A path that is not there answers `null` rather than failing (worker /info).
        const exists = await client.getFileMetadata(target).then(meta => !!meta).catch(() => false);
        if (!exists) {
            await write(target, result);
            return;
        }
        Modal.confirm({
            title: `Replace ${extractName(target)}?`,
            content: 'The file is already there — instantiating overwrites its content.',
            okText: 'Replace',
            cancelText: 'Cancel',
            onOk: () => write(target, result),
        });
    }, [client, target, write]);

    if (!template) return <div>Loading...</div>;

    if (!template.rootTemplate) return <div>Missing Root Template</div>;

    const title = template.name || "Template Instantiation";

    // No fixed height: the face sizes to its content and the tab above scrolls when that
    // exceeds it — a tall template is read to the bottom instead of being cut off. minHeight
    // keeps a small template filling the tab as before.
    return (
        <div style={{ padding: '20px', minHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            <h1 style={{ marginBottom: '20px' }}>{title}</h1>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <TemplateInstantiation
                    template={template}
                    onInstantiate={instantiate}
                />
            </div>
        </div>
    );
}
