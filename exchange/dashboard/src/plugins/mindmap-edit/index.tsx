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

// State & Commands
import { MindmapStateProvider } from './state';
import { MindmapCommandsProvider } from './commands';

// Components (from simplified components module)
import { MindmapViewportCmp } from './components/MindmapViewport';
import { MindmapDragAndDropProvider } from './components/MindmapDragAndDrop';
import { RelationDragProvider } from './components/RelationDrag-ctx';
import { MindmapZoomControl } from './components/MindmapZoomControl';
import { NewColorControl } from './components/NewColorControl';
import { NewNoteStyleControl } from './components/NewNoteStyleControl';
import { NewRelationStyleControl } from './components/NewRelationStyleControl';
import { MindmapCreationPlugin } from './MindmapCreationPlugin';
import { mindmapSideDocument } from './MindmapSideDocument';

// === Configuration ===

const extension = ".mmap.json"

// === Main View ===

const mainView: MainViewCmp = () => {
  const { currentFile } = useFileBrowsingPersistenceContext();

  React.useEffect(() => {
    if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
  }, [currentFile]);

  return (
    <>
      <LayoutContent>
        <MindmapDragAndDropProvider>
          <RelationDragProvider>
            <MindmapViewportCmp />
          </RelationDragProvider>
        </MindmapDragAndDropProvider>
      </LayoutContent>
      <TopBanner additionalPanels={<><NewColorControl /><NewNoteStyleControl /><NewRelationStyleControl /><MindmapZoomControl /></>} />
    </>
  )
};

// === Global Provider (simplified flat hierarchy) ===

const GlobalProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { currentFile } = useFileBrowsingPersistenceContext();

  if (!currentFile) {
    return <>{children}</>;
  }

  return (
    <MindmapStateProvider mindmapId={currentFile.path}>
      <MindmapCommandsProvider>
        {children}
      </MindmapCommandsProvider>
    </MindmapStateProvider>
  );
};

// === File Label ===



const fileLabelCmp: FileLabelCmp = ({ file }) => (
  <><img src={iconImg} className="file-label-icon" alt={extractFileNameFn(extension)(file)} />{extractFileNameFn(extension)(file)}</>
);

// === Export ===

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
  // A map is also offered *beside* another document — see MindmapSideDocument.
  sideDocuments: [mindmapSideDocument],
};
