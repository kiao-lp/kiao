import React from 'react';
import { CurrentFileListProvider } from './CurrentFileList-ctx';

import { FileBrowsingPersistenceProvider } from './FileBrowsingPersistence-ctx';
import { FileBrowserPlugin } from './FileBrowsingPlugin';
import { NavTreeStoreProvider } from '../nav-bar/NavTreeStore-ctx';
import { RevealInTreeProvider } from '../nav-bar/RevealInTree-ctx';
import { FileSearchProvider } from './FileSearch-ctx';
import { CreationCommandRegistryProvider } from '../creation/CreationCommandRegistry-ctx';
import { SelectionModelProvider } from '../selection/SelectionModel-ctx';
import { RenameTargetProvider } from '../selection/RenameTarget-ctx';
import { ClipboardModelProvider } from '../clipboard/ClipboardModel-ctx';
import { ContextMenuRegistryProvider } from '../context-menu/ContextMenuRegistry-ctx';
import { ViewModeProvider } from '../view-mode/ViewMode-ctx';

// NavTreeStoreProvider is outermost: the navigation tree's listings and scroll offset are held
// here so they outlive the pane, which every plugin main view mounts a copy of. RevealInTreeProvider
// is beside it for the same reason — a request to show where a document is is made from a document
// or a panel and answered by whichever pane is up, so it belongs above both.
export const FileBrowsingProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <NavTreeStoreProvider>
     <RevealInTreeProvider>
      <FileBrowsingPersistenceProvider>
        <CurrentFileListProvider>
          <FileSearchProvider>
            <CreationCommandRegistryProvider>
              <SelectionModelProvider>
                <RenameTargetProvider>
                  <ClipboardModelProvider>
                    <ContextMenuRegistryProvider>
                      <ViewModeProvider>
                        <FileBrowserPlugin>{children}</FileBrowserPlugin>
                      </ViewModeProvider>
                    </ContextMenuRegistryProvider>
                  </ClipboardModelProvider>
                </RenameTargetProvider>
              </SelectionModelProvider>
            </CreationCommandRegistryProvider>
          </FileSearchProvider>
        </CurrentFileListProvider>
      </FileBrowsingPersistenceProvider>
     </RevealInTreeProvider>
    </NavTreeStoreProvider>
  );
};
