import React, { useEffect } from 'react';
import {
    FileDto,
    CmsPlugin,
    lazyComponent,
    extractFileNameFn,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    useFileBrowsingPersistenceContext
} from '@cms-core';
import { TextCreationPlugin } from './TextCreationPlugin';
import { FileTextOutlined } from '@ant-design/icons';

const TextEditor = lazyComponent(() => import('./TextEditor').then(m => ({ default: m.TextEditor })));

// Plain text this plugin owns. `.cls` is a class file in the LaTeX sense — a text source no
// other plugin claims — not the compiled kind, which is not text at all. `.csv` and `.tsv` are
// read as the tabular text they are, including the `.index.csv` a workbook or a PDF leaves beside
// itself; no syntax colours them, so no viewer claims them.
const extensions = [".txt", ".jsonl", ".cls", ".csv", ".tsv"];

// The store's own declaration of what in it is not KIAO content (see migrations/README.md)
// is plain text whose name is `.kiao-files` entire, and it sits at the root of every store. Without
// this it would be the one file a user can see and cannot open. It stays out of `extensions`, which
// also drives the rename modal's name/extension split: this name is the whole thing, and renaming
// it away from it is exactly what stops it working.
const openable = [...extensions, ".kiao-files"];

const extensionFor = (file: FileDto) => openable.find((extension) => file.path.endsWith(extension));

const fileTitleFor = (file: FileDto) => {
    const withoutExtension = extractFileNameFn(extensionFor(file) ?? "")(file);
    return withoutExtension || extractFileNameFn("")(file); // a name that is entirely its extension
};

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = fileTitleFor(file);
    return <><FileTextOutlined style={{ marginRight: 4 }} />{fileTitle}</>;
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    useEffect(() => {
        if (currentFile) document.title = fileTitleFor(currentFile);
    }, [currentFile]);

    return (
        <>
            <LayoutContent>
                <TextEditor />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

const fileConfigFor = (file: FileDto) => extensionFor(file) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'text-edit',
    fileConfigFor,
    fileExtensions: extensions,
    // Generic like code-edit's: `.jsonl` is any line-delimited JSON, and an `.actlog.jsonl` is
    // the activity log's. Looked at only once the specific claimants have passed.
    fallback: true,
    CreationProvider: TextCreationPlugin,
};
