import React from 'react';
import { lazyComponent, extractFileNameFn, type CmsPlugin, type FileDto, type FileLabelCmp } from '@cms-core';
import iconImg from './markdown-icon.svg';
import { MarkdownCreationPlugin } from './MarkdownCreationPlugin';
import { StaticVersionPlugin } from './StaticVersionPlugin';
import { RenderDiagramsPlugin } from './RenderDiagramsPlugin';

const extension = '.md';
const MainView = lazyComponent(() => import('./MainView'));

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const fileTitle = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={fileTitle} />{fileTitle}</>;
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
    providers: [StaticVersionPlugin, RenderDiagramsPlugin],
};
