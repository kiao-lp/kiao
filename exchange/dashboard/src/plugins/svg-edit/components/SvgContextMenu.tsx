import React, { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuProps } from 'antd';
import {
    CopyOutlined, DeleteOutlined, FontSizeOutlined,
    VerticalAlignBottomOutlined, VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { useSelectionContext } from '@cms-core';
import { useSvgStateContext } from '../state';
import { FONT_STEP, useDeleteShapes, useDuplicateShapes, useResizeTextSelection } from '../hooks/useShapes';
import { shapeById } from '../model';

export interface SvgMenuAnchor {
    x: number;
    y: number;
}

interface SvgContextMenuProps {
    anchor: SvgMenuAnchor;
    onClose: () => void;
}

const MARGIN = 8;

/**
 * What a right-click on a shape offers: the shape verbs with no gesture of their own —
 * duplicate, restack, text size, delete — each with the standard key that says it too.
 * Opened over the selection the right-click landed in, or the single shape it picked
 * out; every choice runs and closes.
 */
export const SvgContextMenu: React.FC<SvgContextMenuProps> = ({ anchor, onClose }) => {
    const { document: svgDocument, restackShapes, saveSvg } = useSvgStateContext();
    const [selection] = useSelectionContext();
    const duplicateShapes = useDuplicateShapes();
    const deleteShapes = useDeleteShapes();
    const resizeText = useResizeTextSelection();
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<CSSProperties | null>(null);

    useLayoutEffect(() => {
        const element = menuRef.current;
        if (!element) return;
        setPosition({
            left: Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - element.offsetWidth - MARGIN)),
            top: Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - element.offsetHeight - MARGIN)),
        });
    }, [anchor]);

    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        // Escape closes here and clears the selection in the hotkey dispatcher, which
        // listens in the capture phase and so runs first: dismissing the menu this way
        // drops the selection with it, the way clicking the bare canvas does.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    const hasText = useMemo(() => {
        if (!svgDocument) return false;
        return selection.some(id => shapeById(svgDocument.drawing.nodes, id)?.tag === 'text');
    }, [svgDocument, selection]);

    const closeAfter = (run: () => void) => () => { run(); onClose(); };

    const textItems: NonNullable<MenuProps['items']> = hasText ? [
        { type: 'divider' },
        {
            key: 'larger',
            icon: <FontSizeOutlined />,
            label: 'Text larger',
            onClick: closeAfter(() => resizeText(FONT_STEP)),
        },
        {
            key: 'smaller',
            icon: <FontSizeOutlined />,
            label: 'Text smaller',
            onClick: closeAfter(() => resizeText(-FONT_STEP)),
        },
    ] : [];

    const items: MenuProps['items'] = [
        {
            key: 'duplicate',
            icon: <CopyOutlined />,
            label: 'Duplicate',
            extra: 'Ctrl+D',
            onClick: closeAfter(() => duplicateShapes()),
        },
        { type: 'divider' },
        {
            key: 'front',
            icon: <VerticalAlignTopOutlined />,
            label: 'Bring to front',
            extra: 'Ctrl+Shift+F',
            onClick: closeAfter(() => { restackShapes(selection, 'front'); saveSvg(); }),
        },
        {
            key: 'back',
            icon: <VerticalAlignBottomOutlined />,
            label: 'Send to back',
            extra: 'Ctrl+Shift+B',
            onClick: closeAfter(() => { restackShapes(selection, 'back'); saveSvg(); }),
        },
        ...textItems,
        { type: 'divider' },
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: 'Delete',
            extra: 'Del',
            danger: true,
            onClick: closeAfter(() => deleteShapes(selection)),
        },
    ];

    if (selection.length === 0) return null;

    return createPortal(
        <div
            ref={menuRef}
            className="svg-context-menu"
            style={position ?? { visibility: 'hidden' }}
            onContextMenu={event => event.preventDefault()}
        >
            <Menu items={items} selectable={false} />
        </div>,
        document.body,
    );
};
