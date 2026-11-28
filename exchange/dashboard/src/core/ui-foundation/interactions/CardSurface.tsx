import React from 'react';
import type { MenuProps } from 'antd';
import classNames from 'classnames';
import { ContextMenu } from './ContextMenu';
import styles from './CardSurface.module.css';

interface CardSurfaceProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'onClick' | 'role' | 'tabIndex'> {
    selected: boolean;
    onOpen: () => void;
    onToggleSelection: () => void;
    menuItems: MenuProps['items'];
    onMenuOpen?: () => void;
}

const CONTROL_SELECTOR = 'a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), '
    + '[role="button"], [role="link"], [data-card-control]';

// The nearest control must be the surface itself. Let links and other controls handle their own gestures.
const fromSurface = (event: React.SyntheticEvent<HTMLDivElement>): boolean =>
    !event.defaultPrevented && event.target instanceof Element
    && event.target.closest(CONTROL_SELECTOR) === event.currentTarget;

/** Apply --card-surface-fill to the face of the card, which can be a child shape. */
export const CardSurface: React.FC<CardSurfaceProps> = ({
    selected, onOpen, onToggleSelection, menuItems, onMenuOpen, className, onKeyDown, onPointerDown, ...props
}) => {
    const activate = (event: React.MouseEvent | React.KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey) onToggleSelection();
        else onOpen();
    };

    return (
        <ContextMenu items={menuItems} onOpenChange={open => { if (open) onMenuOpen?.(); }}>
            <div
                {...props}
                className={classNames(styles.surface, className)}
                role="button"
                tabIndex={0}
                data-selected={selected || undefined}
                onPointerDown={event => { if (fromSurface(event)) onPointerDown?.(event); }}
                onClick={event => { if (fromSurface(event)) activate(event); }}
                onKeyDown={event => {
                    if (!fromSurface(event)) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (!event.repeat) activate(event);
                    } else {
                        onKeyDown?.(event);
                    }
                }}
            />
        </ContextMenu>
    );
};
