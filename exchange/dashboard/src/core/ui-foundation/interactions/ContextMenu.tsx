import React, { cloneElement } from 'react';
import { Dropdown, type DropdownProps, type MenuProps } from 'antd';
import { KEEP_MENU_IN_VIEWPORT } from './menuPlacement';

export interface ContextMenuPoint {
    x: number;
    y: number;
}

type ContextMenuProps = {
    items: MenuProps['items'];
    selectedKeys?: MenuProps['selectedKeys'];
} & (
    | {
        children: React.ReactElement<{ onContextMenu?: React.MouseEventHandler }>;
        disabled?: boolean;
        autoFocus?: boolean;
        open?: boolean;
        onOpenChange?: (open: boolean) => void;
    }
    | {
        /** Client coordinates from a gesture handled by the caller. Null closes the menu. */
        anchor: ContextMenuPoint | null;
        onClose: () => void;
    }
);

const suppressNativeMenu: React.MouseEventHandler = event => {
    event.preventDefault();
    event.stopPropagation();
};

export const ContextMenu: React.FC<ContextMenuProps> = props => {
    let trigger: React.ReactElement;
    let visibility: Pick<DropdownProps, 'open' | 'onOpenChange' | 'disabled' | 'autoFocus'>;
    if ('anchor' in props) {
        const { anchor, onClose } = props;
        visibility = { open: anchor !== null, onOpenChange: open => { if (!open) onClose(); } };
        // A new anchor element realigns an open menu when the point moves.
        trigger = (
            <span key={anchor && `${anchor.x}:${anchor.y}`} aria-hidden="true"
                style={{ position: 'fixed', left: anchor?.x, top: anchor?.y, width: 1, height: 1, pointerEvents: 'none' }} />
        );
    } else {
        const { children, disabled, autoFocus, open, onOpenChange } = props;
        visibility = { disabled, autoFocus, open: disabled ? false : open, onOpenChange };
        trigger = disabled ? children : cloneElement(children, {
            onContextMenu: event => {
                // The closest trigger owns the gesture, even inside another menu's trigger.
                event.stopPropagation();
                children.props.onContextMenu?.(event);
            },
        });
    }

    return (
        <Dropdown menu={{ items: props.items ?? [], selectedKeys: props.selectedKeys, onContextMenu: suppressNativeMenu }}
            trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT} {...visibility}>
            {trigger}
        </Dropdown>
    );
};
