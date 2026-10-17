import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Menu } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import type { MenuProps } from 'antd';
import { AimOutlined, ReloadOutlined } from '@ant-design/icons';
import { SilentLink } from '../core/SilentLink-cmp';

import { FileLabelSwitch } from '../core/FileLabelSwitch-cmp';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { FileDto, parentPath } from 'src/cms-core/files/service';
import { Pointable } from 'react-advanced-interactions';
import { RowContextMenu } from '../context-menu/RowContextMenu';
import { useCurrentFileListContext, useRefreshFileList } from '../core/CurrentFileList-ctx';
import { NewButtonCmp } from './NewButton-cmp';
import { FileTreeCmp } from './FileTree-cmp';
import { useNavTreeStore } from './NavTreeStore-ctx';

const fileToItem = (file: FileDto): Required<MenuProps>['items'][number] => ({
  key: file.path,
  label: (
    <Pointable id={file.path}>
      <RowContextMenu path={file.path} isDirectory={!!file.isDirectory}>
        <SilentLink to={file.path} style={{ color: 'inherit', display: 'block' }} data-testid={`nav-item-${file.path}`}>
          <FileLabelSwitch file={file} hideIconIfSingleChar={true} />
        </SilentLink>
      </RowContextMenu>
    </Pointable>
  ),
  style: { padding: '0 8px', margin: 0 },
  className: 'cms-nav-item'
});

/**
 * The navigation along a bar: one line holding the open folder's entries, with files dropped past
 * thirty of them so the line stays readable. Its tab is horizontal-only, so this is what the top
 * bar draws and the only place it goes.
 */
export const FileNavigationMenuCmp: React.FC = () => {
  const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
  const files = useCurrentFileListContext();

  const items: MenuProps['items'] = useMemo(() => {
    let menuItems: MenuProps['items'] = [];

    // The bar lists the current folder, so the parent belongs in it like any other folder —
    // open document or not. Closing the document is a different move, offered by the cross
    // floating over the document itself (LayoutContent).
    if (currentPath) {
      const upPath = parentPath(currentPath);
      menuItems.push({
        key: "UP",
        label: (
          <SilentLink to={upPath} style={{ color: 'inherit', display: 'block' }}>
            <span style={{ fontWeight: 600 }}>..</span>
          </SilentLink>
        ),
        style: { padding: '0 8px', margin: 0 },
        className: 'cms-nav-item'
      });
    }

    const sortByName = (a: FileDto, b: FileDto) => a.path.toLowerCase().localeCompare(b.path.toLowerCase());
    const directories = files.filter(file => file.isDirectory).sort(sortByName);
    const nonDirectories = files.filter(file => !file.isDirectory).sort(sortByName);

    menuItems = [
      ...menuItems,
      ...directories.map(fileToItem),
      ...(files.length < 30 ? nonDirectories : []).map(fileToItem)
    ];

    return menuItems;
  }, [files, currentPath]);

  return (
    <div className="cms-nav-menu-horizontal-wrap">
      <NewButtonCmp />
      <Menu
        mode="horizontal"
        items={items}
        selectedKeys={currentFile?.path ? [currentFile.path] : []}
        className="cms-nav-menu"
        selectable={false}
      />
    </div>
  );
};

/**
 * Back to the open document, wherever browsing the tree has taken the pane — the move an
 * IDE keeps a crosshair for. It floats in the pane's corner rather than standing among the
 * rows: it is wanted precisely when the row it looks for is off screen.
 */
const LocateCurrentButton: React.FC<{ onLocate: () => void }> = ({ onLocate }) => (
  <Tooltip title="Show the open document">
    <Button
      className="cms-nav-locate-button"
      type="text"
      size="small"
      icon={<AimOutlined />}
      onClick={onLocate}
      aria-label="Show the open document in the tree"
      data-testid="nav-locate-current"
    />
  </Tooltip>
);

/**
 * Re-reads the store listings behind the tree — the move for files changed outside the
 * app, which no automatic pass has picked up yet. It is the tree's half of the file
 * browser's own refresh: one call re-reads the browsed folder and tells every other
 * listing, the tree's branches included, to read itself again.
 */
const RefreshTreeButton: React.FC = () => {
  const refreshFileList = useRefreshFileList();
  return (
    <Tooltip title="Refresh the file tree">
      <Button
        className="cms-nav-refresh-button"
        type="text"
        size="small"
        icon={<ReloadOutlined />}
        onClick={() => void refreshFileList()}
        aria-label="Refresh the file tree"
        data-testid="nav-refresh-tree"
      />
    </Tooltip>
  );
};

/**
 * The navigation down a column. A column is a pane rather than a bar, so it shows the store as a
 * tree the whole way down instead of one folder at a time: no `..` row, and no cut-off past thirty
 * entries. Its tab is vertical-only, so it goes down either column and nowhere else — and its own
 * tab, so it shows alongside the line across the top rather than instead of it.
 */
export const FileNavigationTreeCmp: React.FC = () => {
  const { scrollTop } = useNavTreeStore();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const locate = useCallback(() => setRevealRequest(count => count + 1), []);

  // Opening a document of another type mounts a new pane, and a new pane starts at the top.
  // The tree it draws is the one that was there — its listings outlive it — so the offset is
  // put back before the frame is painted and the pane simply stays where the hand left it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scrollTop.current;
  }, [scrollTop]);

  return (
    <div className="cms-nav-pane">
      {/* Left out of the scroller, and laid over it rather than above it: finding the open
          document again must be within reach at any depth of the tree, and a line of the pane
          spent on saying so is a line the tree does not get. The refresh stands to its left,
          where the hand looks for it next to the crosshair. */}
      <div className="cms-nav-pane-actions">
        <RefreshTreeButton />
        <LocateCurrentButton onLocate={locate} />
      </div>
      <div
        ref={scrollerRef}
        onScroll={e => { scrollTop.current = e.currentTarget.scrollTop; }}
        className="cms-nav-pane-scroller"
      >
        <FileTreeCmp revealRequest={revealRequest} />
      </div>
    </div>
  );
};
