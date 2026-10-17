import React, { useEffect } from 'react';
import {
    FileDto,
    CmsPlugin,
    extractFileNameFn,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    SideDocumentRow,
    SideDocumentToggles,
    useFileBrowsingPersistenceContext
} from '@cms-core';
import { MarkdownFileEditor } from './MarkdownEditor';
import { MarkdownCreationPlugin } from './MarkdownCreationPlugin';
import { StaticVersionPlugin } from './StaticVersionPlugin';
import { RenderDiagramsPlugin } from './RenderDiagramsPlugin';
import { MarkdownEditorToolbar, useMarkdownEditorControls } from '@cms-kit/markdown-editor';

import iconImg from './markdown-icon.svg';

const extension = ".md";

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
};

const MainView: MainViewCmp = () => {
    const controls = useMarkdownEditorControls({ defaultShowPreview: window.innerWidth > 768 });

    const { currentFile } = useFileBrowsingPersistenceContext();
    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    // A `.md` accepts the documents other plugins offer to put beside it — a mindmap, today.
    // Which ones exist is none of this plugin's business: it lends the row and the switches, and
    // cms-core fills them from the manifests (see cms-core/side-documents/).
    return (
        <>
            <LayoutContent>
                <SideDocumentRow hostHidden={!controls.showSource && !controls.showPreview}>
                    <MarkdownFileEditor ref={controls.editorRef} {...controls.bodyProps} />
                </SideDocumentRow>
            </LayoutContent>
            <TopBanner additionalPanels={<>
                <MarkdownEditorToolbar {...controls.toolbarProps} />
                <SideDocumentToggles />
            </>} />
        </>
    );
};

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {

    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'markdown-edit',
    fileConfigFor,
    fileExtensions: [extension],
    CreationProvider: MarkdownCreationPlugin,
    // App-level rather than tied to the open document: the entries are offered from the file browser,
    // where a file or a folder is right-clicked without being opened first.
    providers: [StaticVersionPlugin, RenderDiagramsPlugin],
};
