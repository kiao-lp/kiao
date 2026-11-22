import React, { useEffect, useRef, useState } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { Pointable } from 'react-advanced-interactions';
import { parentPath } from 'src/core/files/service';
import { FileLabelSwitch } from '../core/FileLabelSwitch-cmp';
import { SilentLink } from '../core/SilentLink-cmp';
import { RowContextMenu } from '../context-menu/RowContextMenu';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useIsCoarsePointer } from '../../ui-foundation/interactions/useLongPress';
import { writeDraggedFiles } from '../dnd/dragPaths';
import { FileTreeRow } from './fileTreeModel';
import { useFileTree } from './useFileTree';
import { useRevealInTree } from './RevealInTree-ctx';

const INDENT = 12;

type TreeRowProps = {
    row: FileTreeRow;
    current: boolean;
    onToggle: (path: string) => void;
};

const TreeRowCmp: React.FC<TreeRowProps> = ({ row, current, onToggle }) => {
    // The expander browses the tree; it must not take the click that opens the row itself.
    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle(row.path);
    };

    // Whole row is draggable except root and touch, where long-press opens the menu.
    // `SilentLink` is a div, so no nested drag competes.
    const isCoarse = useIsCoarsePointer();
    const draggable = !row.isRoot && !isCoarse;

    return (
        <Pointable id={row.path}>
            <RowContextMenu path={row.path} isDirectory={row.file.isDirectory}>
                <div
                    className={`cms-nav-tree-row${current ? ' cms-nav-tree-row-current' : ''}`}
                    style={{ paddingLeft: 4 + row.depth * INDENT }}
                    onContextMenu={e => e.stopPropagation()}
                    draggable={draggable}
                    onDragStart={draggable
                        ? e => writeDraggedFiles(e.dataTransfer, [{ path: row.path, isDirectory: row.file.isDirectory }])
                        : undefined}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-expanded={row.expandable ? row.expanded : undefined}
                    data-current-row={current || undefined}
                    // Reveal lookup key; root path is the empty string.
                    data-row-path={row.path}
                >
                    <span
                        className="cms-nav-tree-switcher"
                        onClick={row.expandable ? handleToggle : undefined}
                        data-testid={row.isRoot ? 'nav-toggle-root' : `nav-toggle-${row.path}`}
                        aria-hidden={!row.expandable}
                    >
                        {row.expandable && (row.expanded ? <DownOutlined /> : <RightOutlined />)}
                    </span>
                    <SilentLink
                        to={row.path}
                        className="cms-nav-tree-label"
                        data-testid={row.isRoot ? 'nav-item-root' : `nav-item-${row.path}`}
                    >
                        {row.isRoot
                            ? <div className="file-label cms-nav-tree-root-label">/</div>
                            : <FileLabelSwitch file={row.file} />}
                    </SilentLink>
                </div>
            </RowContextMenu>
        </Pointable>
    );
};

export type FileTreeCmpProps = {
    /** Incremented per locate click; each new value is one request. */
    revealRequest?: number;
};

// False when the pane has no layout box.
const wholeInPane = (row: Element, pane: HTMLElement | null): boolean => {
    const paneBox = pane?.getBoundingClientRect();
    if (!paneBox?.height) return false;
    const rowBox = row.getBoundingClientRect();
    return rowBox.top >= paneBox.top && rowBox.bottom <= paneBox.bottom;
};

// Finds by scanning `data-row-path`; avoids selector escaping for quotes/backslashes.
const rowElement = (container: HTMLElement | null, path: string): HTMLElement | null =>
    Array.from(container?.querySelectorAll<HTMLElement>('[data-row-path]') ?? [])
        .find(row => row.dataset.rowPath === path) ?? null;

/** The mark on a row a reveal has just brought into view; `core.css` says how it fades. */
const FLASH_CLASS = 'cms-nav-tree-row-flash';

// Marks a revealed row. Removing, forcing layout, then re-adding restarts the animation.
const flash = (row: HTMLElement): void => {
    row.classList.remove(FLASH_CLASS);
    void row.offsetWidth;
    row.classList.add(FLASH_CLASS);
    row.addEventListener('animationend', () => row.classList.remove(FLASH_CLASS), { once: true });
};

/** Store tree with in-place folders; open state survives browsing. */
export const FileTreeCmp: React.FC<FileTreeCmpProps> = ({ revealRequest = 0 }) => {
    const { rows, toggle, expandTo, settling } = useFileTree();
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const { request, taken } = useRevealInTree();
    const containerRef = useRef<HTMLDivElement>(null);

    // Root reports `.` as its path, which matches no row; use the file path for files.
    const currentRowPath = currentFile && !currentFile.isDirectory ? currentFile.path : currentPath;

    // State, not a ref: taking a request changes tree shape.
    // The requesting pass still sees the previous rows.
    const [pending, setPending] = useState<string | null>(null);

    // Auto-reveal once per document; re-checks on shape change while settling.
    // Manual branch opens must not move the pane.
    const shownFor = useRef<string | null>(null);
    useEffect(() => {
        // A pending request takes precedence and always centres.
        if (pending !== null) return;
        if (shownFor.current === currentRowPath) return;
        const container = containerRef.current;
        if (!container) return;
        const row = rowElement(container, currentRowPath);
        if (!row) return;
        if (!settling) shownFor.current = currentRowPath;
        // Centre only when the row is not already fully visible.
        if (!wholeInPane(row, container.parentElement)) row.scrollIntoView({ block: 'center' });
    }, [rows, settling, currentRowPath, pending]);

    // Locate button: re-open the path and reveal the open document.
    const answered = useRef(revealRequest);
    useEffect(() => {
        if (answered.current === revealRequest) return;
        answered.current = revealRequest;
        setPending(currentRowPath);
        expandTo(currentPath);
    }, [revealRequest, currentRowPath, currentPath, expandTo]);

    // External reveal expands only to the containing folder.
    // Consumed on take so a later pane does not replay it.
    useEffect(() => {
        if (request === null) return;
        setPending(request);
        expandTo(parentPath(request));
        taken();
    }, [request, expandTo, taken]);

    // Pending stands while settling.
    // Dropped when settled and still missing, so it cannot block auto-reveal.
    useEffect(() => {
        if (pending === null) return;
        const row = rowElement(containerRef.current, pending);
        if (!row) {
            if (!settling) setPending(null);
            return;
        }
        if (!settling) setPending(null);
        // Marks the open document as shown to avoid a second scroll.
        if (pending === currentRowPath) shownFor.current = currentRowPath;
        // Explicit reveal centres even when visible.
        row.scrollIntoView({ block: 'center' });
        flash(row);
    }, [pending, rows, settling, currentRowPath]);

    return (
        <div className="cms-nav-tree" role="tree" ref={containerRef} data-testid="nav-tree">
            {rows.map(row => (
                <TreeRowCmp
                    key={row.path || '/'}
                    row={row}
                    current={row.path === currentRowPath}
                    onToggle={toggle}
                />
            ))}
        </div>
    );
};
