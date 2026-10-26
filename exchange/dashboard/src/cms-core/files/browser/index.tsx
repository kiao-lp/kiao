import React from 'react';
import { FileDto, extractName } from 'src/cms-core/files/service';
import { FolderBrowserCmp } from './FolderBrowser-cmp';
import { FileGridCmp } from '../view-mode/FileGrid-cmp';
import { useViewMode } from '../view-mode/ViewMode-ctx';
import { FileBrowserControls } from './FileBrowserControls';

import iconImg from './folder-yellow.svg';
import { FileLabelCmp, MainViewCmp, CmsPlugin } from '../../core/FileBasedPlugin';

import { LayoutContent, TopBanner, useFileBrowsingPersistenceContext } from '@cms-core';

const FolderView: React.FC = () => {
  const { currentPath } = useFileBrowsingPersistenceContext();
  const { mode } = useViewMode(currentPath);

  return mode === 'grid' ? <FileGridCmp /> : <FolderBrowserCmp />;
};

const mainView: MainViewCmp = () => {
  const { currentFile } = useFileBrowsingPersistenceContext();

  React.useEffect(() => {
    if (currentFile) {
      document.title = extractTitle(currentFile);
    }
  }, [currentFile]);

  return (
    <>
      <LayoutContent additionalPanels={<FileBrowserControls />}>
        <FolderView />
      </LayoutContent>
      <TopBanner />
    </>
  )
};

const extractTitle = (file: FileDto) => extractName(file.path);

const fileLabelCmp: FileLabelCmp = ({ file }) =>
  <><img src={iconImg} className="file-label-icon" alt={extractTitle(file)} />{extractTitle(file)}</>;

const fileConfigFor = (file: FileDto) => file.isDirectory ? {
  fileLabelCmp,

  mainView,
} : null;

// FolderBrowser lives in cms-core but is registered like a plugin: it claims any
// directory and renders the file grid/list. It ships neither a creation command nor
// a toolbar tab.
export const plugin: CmsPlugin = {
  id: 'folder-browser',
  fileConfigFor,
};
