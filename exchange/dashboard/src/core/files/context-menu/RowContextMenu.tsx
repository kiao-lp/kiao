import React, { useMemo } from 'react';
import { useContextMenuItemsAt } from './ContextMenuRegistry-ctx';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { PointedFileInfo } from './ContextMenuRegistry';
import { creationTargetOf, useMenuItemsWithNew } from './useMenuItemsWithNew';
import { ContextMenu } from '../../ui-foundation/interactions/ContextMenu';
import { useClipboardOptional } from '../clipboard/ClipboardModel-ctx';

interface RowContextMenuProps {
    path: string;
    isDirectory: boolean;
    children: React.ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export const RowContextMenu: React.FC<RowContextMenuProps> = ({ path, isDirectory, children, open, onOpenChange }) => {
    const selection = useFileSelection();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const clipboard = useClipboardOptional();

    const ctx = useMemo(() => {
        const selected = selection.getSelected();
        const paths = selected.includes(path) && selected.length > 0 ? selected : [path];
        const pointedFile: PointedFileInfo = { path, isDirectory };
        return {
            paths,
            pointedPath: path,
            pointedFile,
            currentPath,
            isEmptyArea: false,
        };
    }, [selection, path, isDirectory, currentPath]);

    const registryItems = useContextMenuItemsAt(ctx);
    const items = useMenuItemsWithNew(registryItems, creationTargetOf(path, isDirectory));

    return (
        <ContextMenu
            items={items}
            open={open}
            onOpenChange={open => {
                onOpenChange?.(open);
                if (open && isDirectory) void clipboard?.refreshTextFiles();
            }}
        >
            {children}
        </ContextMenu>
    );
};
