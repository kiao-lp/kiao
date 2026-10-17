import React, { useMemo } from 'react';
import { FolderOutlined } from '@ant-design/icons';
import { useWorkerClient } from 'kiao-worker';
import { usePluginHotkeys } from '../../commands/usePluginHotkeys';
import { usePointedElementContext } from 'src/cms-core/lib/react-advanced-interactions/PointedElementContext';
import { useRefreshFileList } from './CurrentFileList-ctx';
import { useCreationCommand } from '../creation/useCreationCommand';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useRenameTarget } from '../selection/RenameTarget-ctx';
import { useClipboard } from '../clipboard/ClipboardModel-ctx';
import { useNavigation } from '../navigation/NavigationModel';
import { IndexAutoOpen } from '../navigation/useIndexAutoOpen';
import { useContextMenuItems } from '../context-menu/useContextMenuItems';
import { RenameModal } from './RenameModal-cmp';
import { DeleteConfirmModal } from './DeleteConfirmModal-cmp';
import { useFileOperations } from './useFileOperations';
import { useDuplicateFiles } from './useDuplicateFiles';
import { useReindexFiles } from './useReindexFiles';
import { buildFileBrowserHotkeys } from './fileBrowserHotkeys';
import { buildFileBrowserContextMenu } from './fileBrowserContextMenu';
import { ServerActions } from '../actions/ServerActions-cmp';

export const FileBrowserPlugin: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [pointedElement] = usePointedElementContext();
  const refreshFileList = useRefreshFileList();
  const selection = useFileSelection();
  const { startRename } = useRenameTarget();
  const clipboard = useClipboard();
  const nav = useNavigation();
  const workerClient = useWorkerClient();
  const duplicateFiles = useDuplicateFiles();
  const reindexFiles = useReindexFiles();

  const {
    deleteScope, requestDelete, confirmDelete, cancelDelete,
    createFolder, handleDownload, handleReplace,
  } = useFileOperations();

  useCreationCommand('new-folder', {
    id: 'new-folder',
    label: 'Folder',
    icon: <FolderOutlined />,
    order: 10,
    execute: (ctx) => createFolder(ctx.currentPath)
  }, [createFolder]);

  usePluginHotkeys('file-browser-selection', buildFileBrowserHotkeys({
    selection, pointedElement, clipboard, nav, startRename, createFolder, requestDelete,
  }), [pointedElement, startRename, selection, clipboard, nav, createFolder, requestDelete]);

  const contextMenuItems = useMemo(() => buildFileBrowserContextMenu({
    nav, clipboard, selection, workerClient, startRename, duplicateFiles, requestDelete,
    handleDownload, handleReplace, reindexFiles, refreshFileList,
  }), [nav, clipboard, refreshFileList, selection, workerClient, startRename, duplicateFiles,
    handleDownload, handleReplace, requestDelete, reindexFiles]);

  useContextMenuItems('file-browser-default', contextMenuItems, [contextMenuItems]);

  return (
    <>
      {children}
      {/* Entering a folder that holds an Index file opens it instead of the listing. */}
      <IndexAutoOpen />
      <RenameModal />
      <DeleteConfirmModal scope={deleteScope} onConfirm={confirmDelete} onCancel={cancelDelete} />
      <ServerActions />
    </>
  );
};
