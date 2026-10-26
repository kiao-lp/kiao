import React, { useMemo } from 'react';
import { Dropdown } from 'antd';
import { useContextMenuItemsAt } from './ContextMenuRegistry-ctx';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { PointedFileInfo } from './ContextMenuRegistry';
import { creationTargetOf, useMenuItemsWithNew } from './useMenuItemsWithNew';
import { KEEP_MENU_IN_VIEWPORT } from './menuPlacement';
import { useClipboardOptional } from '../clipboard/ClipboardModel-ctx';

interface RowContextMenuProps {
    path: string;
    isDirectory: boolean;
    children: React.ReactElement;
}

export const RowContextMenu: React.FC<RowContextMenuProps> = ({ path, isDirectory, children }) => {
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
        <Dropdown
            menu={{ items }}
            trigger={['contextMenu']}
            onOpenChange={open => { if (open && isDirectory) void clipboard?.refreshTextFiles(); }}
            {...KEEP_MENU_IN_VIEWPORT}
        >
            {children}
        </Dropdown>
    );
};
