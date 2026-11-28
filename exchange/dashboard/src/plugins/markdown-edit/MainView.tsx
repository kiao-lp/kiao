import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import { NodeIndexOutlined } from '@ant-design/icons';
import { WorkerError } from 'kiao-worker';
import {
    IconButton,
    extractFileNameFn,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    useFileBrowsingPersistenceContext,
    useRefreshFileList,
    useSecondaryDocument,
    useWorkerClient,
} from '@kiao-dashboard-core';
import { MarkdownFileEditor } from './MarkdownEditor';
import { MarkdownEditorToolbar, TableOfContentsMenu, useMarkdownEditorControls } from '@kiao-dashboard-kit/markdown-editor';
import { MarkdownDocumentProvider, useMarkdownDocument } from './MarkdownDocument';
import { MarkdownMetadataControls } from './MarkdownMetadataControls';

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
        <IconButton
            label={`${open ? 'Hide' : 'Show'} Mindmap`}
            icon={<NodeIndexOutlined />}
            loading={creating}
            style={{ color: open ? 'var(--link)' : undefined, opacity: open ? 1 : 0.5 }}
            onClick={toggle}
        />
    );
};

const MarkdownView: MainViewCmp = () => {
    const controls = useMarkdownEditorControls({ defaultShowSource: false, defaultShowPreview: true });
    const { content } = useMarkdownDocument();

    const { currentFile } = useFileBrowsingPersistenceContext();
    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    return (
        <>
            <LayoutContent additionalPanels={<>
                <MarkdownMetadataControls />
                <MarkdownEditorToolbar {...controls.toolbarProps} />
                <MindmapToggle />
                <TableOfContentsMenu
                    value={content}
                    onNavigate={(line) => controls.editorRef.current?.goToLine(line)}
                />
            </>}>
                <MarkdownFileEditor ref={controls.editorRef} {...controls.bodyProps} />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    return (
        <MarkdownDocumentProvider key={currentFile?.path}>
            <MarkdownView />
        </MarkdownDocumentProvider>
    );
};

export default MainView;
