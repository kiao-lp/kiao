import React from 'react';
import { lazyComponent, extractFileNameFn, type CmsPlugin, type FileDto, type FileLabelCmp } from '@cms-core';
import iconImg from './archdia.svg';
import { ArchDiaCreationPlugin } from './ArchDiaCreationPlugin';

const extension = '.arch.md';
const MainView = lazyComponent(() => import('./MainView'));

const fileLabelCmp: FileLabelCmp = ({ file }) => (
    <><img src={iconImg} className="file-label-icon" alt={extractFileNameFn(extension)(file)} />{extractFileNameFn(extension)(file)}</>
);

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'archdia-edit',
    fileConfigFor,
    fileExtensions: [extension],
    CreationProvider: ArchDiaCreationPlugin,
};
