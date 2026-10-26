import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import { AimOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRefreshFileList } from '../core/CurrentFileList-ctx';
import { FileTreeCmp } from './FileTree-cmp';
import { useNavTreeStore } from './NavTreeStore-ctx';

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

/** The store tree in a vertical panel, with persistent scroll and refresh/locate controls. */
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
