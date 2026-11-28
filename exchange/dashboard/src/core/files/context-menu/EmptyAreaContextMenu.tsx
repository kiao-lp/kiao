import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useContextMenuItemsAt } from './ContextMenuRegistry-ctx';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useMenuItemsWithNew } from './useMenuItemsWithNew';
import { ContextMenu, type ContextMenuPoint } from '../../ui-foundation/interactions/ContextMenu';
import { useClipboardOptional } from '../clipboard/ClipboardModel-ctx';

interface EmptyAreaContextMenuProps {
    children: React.ReactNode;
}

export const EmptyAreaContextMenu: React.FC<EmptyAreaContextMenuProps> = ({ children }) => {
    const { currentPath } = useFileBrowsingPersistenceContext();
    const clipboard = useClipboardOptional();
    const refreshTextFiles = clipboard?.refreshTextFiles;
    const [anchor, setAnchor] = useState<ContextMenuPoint | null>(null);

    useEffect(() => { setAnchor(null); }, [currentPath]);

    const ctx = useMemo(() => ({
        paths: [],
        pointedPath: null,
        pointedFile: null,
        currentPath,
        isEmptyArea: true,
    }), [currentPath]);

    const registryItems = useContextMenuItemsAt(ctx);
    const items = useMenuItemsWithNew(registryItems);

    const onContextMenu = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-row-path]')) return; // row handles its own
        e.preventDefault();
        e.stopPropagation();
        setAnchor({ x: e.clientX, y: e.clientY });
        void refreshTextFiles?.();
    }, [refreshTextFiles]);

    return (
        <div onContextMenu={onContextMenu} style={{ width: '100%' }}>
            {children}
            <ContextMenu items={items} anchor={anchor} onClose={() => setAnchor(null)} />
        </div>
    );
};
