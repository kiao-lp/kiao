import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { Tooltip } from '../../ui-foundation/feedback/Tooltip';
import { AimOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { RowContextMenu } from '../context-menu/RowContextMenu';
import { FileTreeCmp } from './FileTree-cmp';
import { ROOT } from './fileTreeModel';
import { useNavTreeStore } from './NavTreeStore-ctx';

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

/** Re-reads listings for files changed outside the app. */
const RefreshTreeButton: React.FC = () => {
  const refreshFileList = useRefreshFileList();
  return (
    <Button
    className="cms-nav-refresh-button"
    type="text"
    size="small"
    icon={<ReloadOutlined />}
    onClick={() => void refreshFileList()}
    aria-label="Refresh the file tree"
    data-testid="nav-refresh-tree"
  />
  );
};

/** The store tree in a vertical panel, with persistent scroll and refresh/locate controls. */
export const FileNavigationTreeCmp: React.FC = () => {
  const { scrollTop } = useNavTreeStore();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [rootMenuOpen, setRootMenuOpen] = useState(false);
  const [revealRequest, setRevealRequest] = useState(0);
  const locate = useCallback(() => setRevealRequest(count => count + 1), []);

  // Listings outlive the pane; restore scroll before paint.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scrollTop.current;
  }, [scrollTop]);

  return (
    <RowContextMenu path={ROOT} isDirectory open={rootMenuOpen} onOpenChange={setRootMenuOpen}>
      <div className="cms-nav-pane" onContextMenuCapture={() => setRootMenuOpen(false)}>
        {/* Overlay, outside the scroller: controls stay reachable without taking tree space. */}
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
    </RowContextMenu>
  );
};
