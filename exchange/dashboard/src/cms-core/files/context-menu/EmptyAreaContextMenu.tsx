import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { useContextMenuItemsAt } from './ContextMenuRegistry-ctx';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useMenuItemsWithNew } from './useMenuItemsWithNew';
import { KEEP_MENU_IN_VIEWPORT } from './menuPlacement';

interface EmptyAreaContextMenuProps {
    children: React.ReactNode;
}

export const EmptyAreaContextMenu: React.FC<EmptyAreaContextMenuProps> = ({ children }) => {
    const { currentPath } = useFileBrowsingPersistenceContext();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const anchorRef = useRef<HTMLDivElement>(null);

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
        setPos({ x: e.clientX, y: e.clientY });
        setOpen(true);
    }, []);

    return (
        <div onContextMenu={onContextMenu} style={{ width: '100%' }}>
            {children}
            <Dropdown
                menu={{ items }}
                open={open}
                onOpenChange={setOpen}
                trigger={[]}
                {...KEEP_MENU_IN_VIEWPORT}
            >
                <div
                    ref={anchorRef}
                    style={{ position: 'fixed', left: pos.x, top: pos.y, width: 1, height: 1, pointerEvents: 'none' }}
                />
            </Dropdown>
        </div>
    );
};
