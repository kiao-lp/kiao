import React from 'react';
import { lazyComponent, extractName, type DashboardPlugin, type FileDto, type FileLabelCmp } from '@kiao-dashboard-core';
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

export const plugin = {
    id: 'pdf-view',
    fileConfigFor,
    fileExtensions: [extension],
} satisfies DashboardPlugin;
