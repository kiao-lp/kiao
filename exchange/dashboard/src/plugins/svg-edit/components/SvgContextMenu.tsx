import React from 'react';
import type { MenuProps } from 'antd';
import {
    CopyOutlined, DeleteOutlined, FontSizeOutlined,
    VerticalAlignBottomOutlined, VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { ContextMenu, type ContextMenuPoint, useSelectionContext } from '@kiao-dashboard-core';
import { useSvgStateContext } from '../state';
import { FONT_STEP, useDeleteShapes, useDuplicateShapes, useResizeTextSelection } from '../hooks/useShapes';
import { shapeById } from '../model';

interface SvgContextMenuProps {
    anchor: ContextMenuPoint | null;
    onClose: () => void;
}

export const SvgContextMenu: React.FC<SvgContextMenuProps> = ({ anchor, onClose }) => {
    const { document: svgDocument, restackShapes, saveSvg } = useSvgStateContext();
    const [selection] = useSelectionContext();
    const duplicateShapes = useDuplicateShapes();
    const deleteShapes = useDeleteShapes();
    const resizeText = useResizeTextSelection();
    const hasText = svgDocument && selection.some(id => shapeById(svgDocument.drawing.nodes, id)?.tag === 'text');

    const textItems: NonNullable<MenuProps['items']> = hasText ? [
        { type: 'divider' },
        {
            key: 'larger',
            icon: <FontSizeOutlined />,
            label: 'Text larger',
            onClick: () => resizeText(FONT_STEP),
        },
        {
            key: 'smaller',
            icon: <FontSizeOutlined />,
            label: 'Text smaller',
            onClick: () => resizeText(-FONT_STEP),
        },
    ] : [];

    const items: MenuProps['items'] = [
        {
            key: 'duplicate',
            icon: <CopyOutlined />,
            label: 'Duplicate',
            extra: 'Ctrl+D',
            onClick: () => duplicateShapes(),
        },
        { type: 'divider' },
        {
            key: 'front',
            icon: <VerticalAlignTopOutlined />,
            label: 'Bring to front',
            extra: 'Ctrl+Shift+F',
            onClick: () => { restackShapes(selection, 'front'); saveSvg(); },
        },
        {
            key: 'back',
            icon: <VerticalAlignBottomOutlined />,
            label: 'Send to back',
            extra: 'Ctrl+Shift+B',
            onClick: () => { restackShapes(selection, 'back'); saveSvg(); },
        },
        ...textItems,
        { type: 'divider' },
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: 'Delete',
            extra: 'Del',
            danger: true,
            onClick: () => deleteShapes(selection),
        },
    ];

    return <ContextMenu items={items} anchor={selection.length ? anchor : null} onClose={onClose} />;
};
