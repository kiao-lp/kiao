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
import iconImg from './ttst-icon.svg';
import { TTST_EXTENSION } from '@cms-kit/tts';

const TtstEditor = lazyComponent(() => import('./TtstEditor').then(m => ({ default: m.TtstEditor })));

const extension = TTST_EXTENSION;

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    return (
        <>
            <LayoutContent>
                {currentFile && <TtstEditor key={currentFile.path} path={currentFile.path} />}
            </LayoutContent>
            <TopBanner />
        </>
    );
};

// The `.config.json` sidecar is deliberately unclaimed: on its own it means nothing without its
// script, and code-edit renders it perfectly well as raw JSON.
// See /exchange/dashboard/docs/solution-design/README.md, "A sidecar is deliberately unclaimed".
const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'ttst-edit',
    fileConfigFor,
    fileExtensions: [extension],
};
