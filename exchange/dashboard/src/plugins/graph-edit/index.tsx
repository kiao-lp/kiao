import React from 'react';
import { lazyComponent, extractFileNameFn, type CmsPlugin, type FileDto, type FileLabelCmp } from '@cms-core';
import iconImg from './icon.svg';

const extension = '.graph.json';
const MainView = lazyComponent(() => import('./MainView'));

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const title = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={title} style={{ marginRight: 4, height: 16 }} />{title}</>;
};

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'graph-edit',
    fileConfigFor,
    fileExtensions: [extension],
};
