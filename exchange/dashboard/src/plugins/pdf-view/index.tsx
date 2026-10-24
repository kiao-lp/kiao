import React from 'react';
import { lazyComponent, extractName, type CmsPlugin, type FileDto, type FileLabelCmp } from '@cms-core';
import iconImg from './pdf-icon.svg';

const extension = '.pdf';
const MainView = lazyComponent(() => import('./MainView'));

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractName(file.path);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
}

const fileConfigFor = (file: FileDto) => file.path.toLowerCase().endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'pdf-view',
    fileConfigFor,
    fileExtensions: [extension],
};
