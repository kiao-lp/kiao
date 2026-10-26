import React, { useCallback, useMemo, useRef, useState } from 'react';
import { theme, message, MenuProps } from 'antd';
import type { TableProps } from 'antd';
import { parentPath, WorkerClient } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useCurrentFileListContext, useRefreshFileList } from '../core/CurrentFileList-ctx';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useClipboard } from '../clipboard/ClipboardModel-ctx';
import { useNavigation } from '../navigation/NavigationModel';
import { useContextMenuItemsAt } from '../context-menu/ContextMenuRegistry-ctx';
import { creationTargetOf, useMenuItemsWithNew } from '../context-menu/useMenuItemsWithNew';
import { useIsCoarsePointer, dispatchContextMenuAt } from './useLongPress';
import { draggedPaths, draggedSelection, writeDraggedFiles } from '../dnd/dragPaths';
import type { BrowserRow } from './folderBrowserRows';

const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!target.closest('button, a, input, textarea, select, [data-row-action]');
};

const basename = (path: string): string => path.split('/').pop() || path;
const joinPath = (folder: string, name: string): string => {
    const f = folder.replace(/\/$/, '');
    return f ? `${f}/${name}` : name;
};

/** State + render props for the single controlled per-row context menu. */
export interface FolderRowMenu {
    items: MenuProps['items'];
    open: boolean;
    setOpen: (open: boolean) => void;
    pos: { x: number; y: number };
    anchorRef: React.RefObject<HTMLDivElement>;
}

export interface FolderRowProps {
    onRow: TableProps<BrowserRow>['onRow'];
    rowMenu: FolderRowMenu;
}

/**
 * The folder table's browsing behaviour: selection (click/shift/ctrl), open on
 * double-click/middle-click, drag-to-move, touch long-press, and the controlled
 * per-row context menu. Kept out of the view so the table component is layout.
 */
export const useFolderRowProps = (visiblePaths: string[]): FolderRowProps => {
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const { token } = theme.useToken();
    const workerClient = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();
    const listing = useCurrentFileListContext();
    const selection = useFileSelection();
    const clipboard = useClipboard();
    const nav = useNavigation();
    const isCoarse = useIsCoarsePointer();

    // Refs so handlers read latest state without re-binding row event listeners.
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const navRef = useRef(nav);
    navRef.current = nav;
    const visiblePathsRef = useRef(visiblePaths);
    visiblePathsRef.current = visiblePaths;
    const currentPathRef = useRef(currentPath);
    currentPathRef.current = currentPath;
    // A drag says whether what it carries is a folder, and the listing is what knows.
    const listingRef = useRef(listing);
    listingRef.current = listing;

    // Per-row context menu uses a single controlled Dropdown (avoids per-row mount churn).
    const [rowMenuOpen, setRowMenuOpen] = useState(false);
    const [rowMenuPos, setRowMenuPos] = useState({ x: 0, y: 0 });
    const [rowMenuTarget, setRowMenuTarget] = useState<{ path: string; isDirectory: boolean } | null>(null);
    const rowMenuAnchorRef = useRef<HTMLDivElement>(null);

    // Single controlled context-menu items, computed from the current target.
    const rowMenuCtx = useMemo(() => {
        if (!rowMenuTarget) return null;
        const selectedNow = selection.getSelected();
        const paths = selectedNow.includes(rowMenuTarget.path) && selectedNow.length > 0
            ? selectedNow
            : [rowMenuTarget.path];
        return {
            paths,
            pointedPath: rowMenuTarget.path,
            pointedFile: { path: rowMenuTarget.path, isDirectory: rowMenuTarget.isDirectory },
            currentPath,
            isEmptyArea: false as const,
        };
    }, [rowMenuTarget, selection, currentPath]);

    const registryItems = useContextMenuItemsAt(rowMenuCtx ?? {
        paths: [], pointedPath: null, pointedFile: null, currentPath: '', isEmptyArea: false,
    });

    const rowMenuItems = useMenuItemsWithNew(
        registryItems,
        rowMenuTarget ? creationTargetOf(rowMenuTarget.path, rowMenuTarget.isDirectory) : undefined,
    );

    const onRow: TableProps<BrowserRow>['onRow'] = useCallback((record: BrowserRow) => {
        const isUp = !!record.isUpRow;
        const path = record.value;
        const isFolder = !!record.file?.isDirectory;

        const classNames = ['cms-folder-row'];
        if (selection.isSelected(path)) classNames.push('cms-row-selected');
        if (path === currentFile?.path) classNames.push('cms-row-current');
        if (clipboard.isCut(path)) classNames.push('cms-row-cut');

        const handlers: React.HTMLAttributes<HTMLElement> & { draggable?: boolean } = {
            className: classNames.join(' '),
            style: { cursor: 'pointer' },
        };

        (handlers as Record<string, unknown>)['data-row-path'] = path;

        if (isUp) {
            return handlers;
        }

        handlers.onClick = (e) => {
            if (isInteractiveTarget(e.target)) return;
            const sel = selectionRef.current;
            const visible = visiblePathsRef.current;
            if (e.shiftKey) {
                sel.selectRange(path, visible);
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                sel.select(path, 'toggle');
                return;
            }
            sel.select(path, 'replace');
        };

        handlers.onDoubleClick = (e) => {
            if (isInteractiveTarget(e.target)) return;
            if (e.ctrlKey || e.metaKey) { navRef.current.openInNewTab(path); return; }
            if (e.shiftKey) { navRef.current.openInNewWindow(path); return; }
            navRef.current.open(path);
        };

        handlers.onAuxClick = (e) => {
            if (e.button === 1) {
                e.preventDefault();
                navRef.current.openInNewTab(path);
            }
        };

        handlers.onContextMenu = (e) => {
            e.preventDefault();
            setRowMenuTarget({ path, isDirectory: isFolder });
            setRowMenuPos({ x: e.clientX, y: e.clientY });
            setRowMenuOpen(true);
            if (isFolder) void clipboard.refreshTextFiles();
        };

        handlers.draggable = !isCoarse;
        if (!isCoarse) {
            handlers.onDragStart = (e: React.DragEvent) => {
                const selected = selectionRef.current.getSelected();
                const dragged = selected.includes(path) && selected.length > 1 ? selected : [path];
                writeDraggedFiles(e.dataTransfer, draggedSelection(dragged, listingRef.current));
            };
            handlers.onDragOver = (e: React.DragEvent<HTMLElement>) => {
                if (!record.isUpRow && !isFolder) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                (e.currentTarget as HTMLElement).style.backgroundColor = token.colorFillSecondary;
            };
            handlers.onDragLeave = (e: React.DragEvent<HTMLElement>) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '';
            };
            handlers.onDrop = async (e: React.DragEvent<HTMLElement>) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).style.backgroundColor = '';
                const sources = draggedPaths(e.dataTransfer);
                if (sources.length === 0) return;
                const targetFolder = record.isUpRow
                    ? parentPath(currentPathRef.current || '')
                    : (isFolder ? path : null);
                if (targetFolder === null) return;
                const toMove = sources.filter(src => joinPath(targetFolder, basename(src)) !== src);
                if (toMove.length === 0) return;
                // One moveBatch, not one rename per source: the service runs the link-fixer over
                // the whole store per request, so a per-source loop pays for that walk N times.
                // Same shape as the grid view's drop handler (DragDropController).
                try {
                    await workerClient.moveBatch(toMove, targetFolder);
                } catch (err) {
                    console.error('Drag-move batch failed', err);
                    message.error(`Could not move ${toMove.length} ${toMove.length === 1 ? 'item' : 'items'} to ${targetFolder || '/'}`);
                }
                refreshFileList();
            };
        }

        // Touch long-press → synthetic contextmenu so the controlled Dropdown opens at the touch point.
        if (isCoarse) {
            let timerId: number | null = null;
            let startX = 0, startY = 0;
            handlers.onPointerDown = (e) => {
                if (e.pointerType !== 'touch') return;
                startX = e.clientX; startY = e.clientY;
                const target = e.currentTarget as HTMLElement;
                timerId = window.setTimeout(() => {
                    dispatchContextMenuAt(target, startX, startY);
                    timerId = null;
                }, 500);
            };
            const cancel = () => { if (timerId !== null) { window.clearTimeout(timerId); timerId = null; } };
            handlers.onPointerUp = cancel;
            handlers.onPointerCancel = cancel;
            handlers.onPointerMove = (e) => {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel();
            };
        }

        return handlers;
    }, [selection, clipboard, currentFile, token.colorFillSecondary, workerClient, refreshFileList, isCoarse]);

    return {
        onRow,
        rowMenu: {
            items: rowMenuItems,
            open: rowMenuOpen,
            setOpen: setRowMenuOpen,
            pos: rowMenuPos,
            anchorRef: rowMenuAnchorRef,
        },
    };
};
