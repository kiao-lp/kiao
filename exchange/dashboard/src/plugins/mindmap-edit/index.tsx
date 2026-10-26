import React, { ReactNode } from 'react';

import {
  FileDto,
  CmsPlugin,
  extractFileNameFn,
  useFileBrowsingPersistenceContext,
  FileLabelCmp,
  MainViewCmp,
  LayoutContent,
  TopBanner,
} from '@cms-core';

import './styles.css';
import iconImg from './mindmap.svg';

import { MindmapStateProvider } from './state';
import { MindmapHotkeysProvider } from './hotkeys';
import { MindmapPanel } from './components/MindmapPanel';
import { MindmapZoomControl } from './components/MindmapZoomControl';
import { NewColorControl } from './components/NewColorControl';
import { NewNoteStyleControl } from './components/NewNoteStyleControl';
import { NewRelationStyleControl } from './components/NewRelationStyleControl';
import { MindmapCreationPlugin } from './MindmapCreationPlugin';

const extension = ".mmap.json"

const mainView: MainViewCmp = () => {
  const { currentFile } = useFileBrowsingPersistenceContext();

  React.useEffect(() => {
    if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
  }, [currentFile]);

  return (
    <>
      <LayoutContent additionalPanels={<>
        <NewColorControl />
        <NewNoteStyleControl />
        <NewRelationStyleControl />
        <MindmapZoomControl />
      </>}>
        <MindmapPanel />
      </LayoutContent>
      <TopBanner />
    </>
  )
};

const GlobalProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { currentFile } = useFileBrowsingPersistenceContext();

  if (!currentFile) {
    return <>{children}</>;
  }

  return (
    <MindmapStateProvider mindmapId={currentFile.path}>
      <MindmapHotkeysProvider>
        {children}
      </MindmapHotkeysProvider>
    </MindmapStateProvider>
  );
};

const fileLabelCmp: FileLabelCmp = ({ file }) => (
  <><img src={iconImg} className="file-label-icon" alt={extractFileNameFn(extension)(file)} />{extractFileNameFn(extension)(file)}</>
);

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {

  fileLabelCmp,
  mainView,
  withGlobalProvider: (jsx: ReactNode) => <GlobalProvider>{jsx}</GlobalProvider>
} : null;

export const plugin: CmsPlugin = {
  id: 'mindmap-edit',
  fileConfigFor,
  fileExtensions: [extension],
  CreationProvider: MindmapCreationPlugin,
};
