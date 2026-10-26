import React, { useCallback, useEffect, useMemo } from 'react';
import { Table, Dropdown } from 'antd';
import type { TableProps } from 'antd';
import { parentPath, FileDto, WorkerClient } from 'src/cms-core/files/service';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { FileUploadArea, useWorkerClient } from 'src/cms-core/files/service/ui';
import { useCurrentFileListContext, useRefreshFileList } from '../core/CurrentFileList-ctx';
import { SilentLink } from '../core/SilentLink-cmp';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { EmptyAreaContextMenu } from '../context-menu/EmptyAreaContextMenu';
import { BrowserRow, fileToItem } from './folderBrowserRows';
import { buildFolderBrowserColumns } from './folderBrowserColumns';
import { useFolderRowProps } from './useFolderRowProps';
import { useDuplicateFiles } from '../core/useDuplicateFiles';
import { KEEP_MENU_IN_VIEWPORT } from '../context-menu/menuPlacement';

export type FolderBrowserProps = {
  exclude?: (file: FileDto) => boolean;
};

export const FolderBrowserCmp: React.FC<FolderBrowserProps> = ({ exclude = () => false }) => {
  const { currentPath } = useFileBrowsingPersistenceContext();
  const files = useCurrentFileListContext();
  const workerClient = useWorkerClient() as WorkerClient;
  const refreshFileList = useRefreshFileList();
  const selection = useFileSelection();
  const duplicateFiles = useDuplicateFiles();

  // The folder's own listing, and nothing else: the search results open as a panel on the
  // central area's stack (FileSearchResultsView), over this listing rather than in place of it.
  const dataSource: BrowserRow[] = useMemo(() => {
    const upPath = currentPath ? parentPath(currentPath) : "";
    let rows: BrowserRow[] = currentPath ? [{
      key: "UP",
      value: "UP",
      isUpRow: true,
      label: (
        <SilentLink to={upPath} style={{ color: 'inherit', display: 'block' }}>
          ..
        </SilentLink>
      )
    }] : [];

    const sortByName = (a: FileDto, b: FileDto) => a.path.toLowerCase().localeCompare(b.path.toLowerCase());
    const directories = files.filter(file => file.isDirectory && !exclude(file)).sort(sortByName);
    const nonDirectories = files.filter(file => !file.isDirectory && !exclude(file)).sort(sortByName);

    rows = [
      ...rows,
      ...(files.length < 30 ? directories.map(fileToItem) : []),
      ...nonDirectories.map(fileToItem)
    ];

    return rows;
  }, [files, currentPath, exclude]);

  const visiblePaths = useMemo(
    () => dataSource.filter(r => !r.isUpRow).map(r => r.value),
    [dataSource],
  );
  useEffect(() => {
    selection.setVisiblePaths(visiblePaths);
  }, [selection, visiblePaths]);

  const handleDownload = (path: string) => {
    workerClient.download(path).catch(console.error);
  };

  const handleReplace = (path: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) {
        workerClient.update(path, f).then(() => refreshFileList()).catch(console.error);
      }
    };
    input.click();
  };

  // The row's own menu points at one file; the context menu is the one that carries a selection.
  const handleDuplicate = useCallback((path: string) => { duplicateFiles([path]); }, [duplicateFiles]);

  const columns: TableProps<BrowserRow>['columns'] = useMemo(
    () => buildFolderBrowserColumns({
      onDownload: handleDownload, onReplace: handleReplace, onDuplicate: handleDuplicate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleDuplicate],
  );

  const { onRow, rowMenu } = useFolderRowProps(visiblePaths);

  return (
    <>
      <EmptyAreaContextMenu>
        <div className="cms-folder-browser-area">
          <Table
            dataSource={dataSource}
            columns={columns}
            pagination={false}
            showHeader={true}
            size="small"
            onRow={onRow}
          />
        </div>
      </EmptyAreaContextMenu>
      <FileUploadArea path={currentPath} />

      <Dropdown
        menu={{ items: rowMenu.items }}
        open={rowMenu.open}
        onOpenChange={rowMenu.setOpen}
        trigger={[]}
        {...KEEP_MENU_IN_VIEWPORT}
      >
        <div
          ref={rowMenu.anchorRef}
          style={{ position: 'fixed', left: rowMenu.pos.x, top: rowMenu.pos.y, width: 1, height: 1, pointerEvents: 'none' }}
        />
      </Dropdown>
    </>
  );
};
