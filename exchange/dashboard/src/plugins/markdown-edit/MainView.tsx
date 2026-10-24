import React, { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { NodeIndexOutlined } from '@ant-design/icons';
import { WorkerError } from 'kiao-worker';
import {
    extractFileNameFn,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    Tooltip,
    useFileBrowsingPersistenceContext,
    useRefreshFileList,
    useSecondaryDocument,
    useWorkerClient,
} from '@cms-core';
import { MarkdownFileEditor } from './MarkdownEditor';
import { MarkdownEditorToolbar, useMarkdownEditorControls } from '@cms-kit/markdown-editor';

const extension = ".md";
const mindmapExtension = ".mmap.json";

const MindmapToggle: React.FC = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const secondary = useSecondaryDocument();
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const [creating, setCreating] = useState(false);

    if (!currentFile || currentFile.path.endsWith(mindmapExtension)) return null;

    const path = `${currentFile.path}${mindmapExtension}`;
    const open = secondary.file?.path === path;

    const toggle = async () => {
        if (open) {
            secondary.close();
            return;
        }
        setCreating(true);
        try {
            let exists = true;
            try {
                exists = (await client.getFileMetadata(path)) != null;
            } catch (error) {
                if (error instanceof WorkerError && error.response.status === 404) exists = false;
                else throw error;
            }
            if (!exists) {
                await client.saveDocument(path, {
                    content: { elements: { notes: [], relations: [] } },
                    docType: 'QuickMindmap',
                    docId: crypto.randomUUID(),
                    docTypeVersion: 1,
                    createdAt: new Date().toISOString(),
                });
                refreshFileList();
            }
            secondary.open({ path, isDirectory: false, size: 0, lastModified: 0 });
        } catch {
            message.error(`Could not open ${path.split('/').pop()}`);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Tooltip title={`${open ? 'Hide' : 'Show'} Mindmap`}>
            <Button
                type="text"
                size="small"
                icon={<NodeIndexOutlined />}
                loading={creating}
                style={{ color: open ? 'var(--link)' : undefined, opacity: open ? 1 : 0.5 }}
                onClick={toggle}
                aria-label={`${open ? 'Hide' : 'Show'} Mindmap`}
            />
        </Tooltip>
    );
};

const MainView: MainViewCmp = () => {
    const controls = useMarkdownEditorControls({ defaultShowPreview: window.innerWidth > 768 });

    const { currentFile } = useFileBrowsingPersistenceContext();
    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    return (
        <>
            <LayoutContent additionalPanels={<>
                <MarkdownEditorToolbar {...controls.toolbarProps} />
                <MindmapToggle />
            </>}>
                <MarkdownFileEditor ref={controls.editorRef} {...controls.bodyProps} />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

export default MainView;
