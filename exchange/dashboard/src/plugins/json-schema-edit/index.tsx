import React from 'react';
import { lazyComponent, extractFileNameFn, type CmsPlugin, type FileDto, type FileLabelCmp } from '@cms-core';
import { JsonSchemaCreationPlugin } from './JsonSchemaCreationPlugin';
import icon from './icon.svg';

const extension = '.schema.json';
const MainView = lazyComponent(() => import('./MainView'));

const fileLabelCmp: FileLabelCmp = ({ file }) => <>
    <img src={icon} className="file-label-icon" alt="JSON Schema" />
    {extractFileNameFn(extension)(file)}
</>;

export const plugin: CmsPlugin = {
    id: 'json-schema-edit',
    fileExtensions: [extension],
    fileConfigFor: (file: FileDto) => !file.isDirectory && file.path.toLowerCase().endsWith(extension)
        ? { fileLabelCmp, mainView: MainView } : null,
    CreationProvider: JsonSchemaCreationPlugin,
};
