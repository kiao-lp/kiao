import React, { SyntheticEvent, useMemo } from 'react';
import { Select, Button } from 'antd';
import {
    VerticalAlignTopOutlined,
    VerticalAlignMiddleOutlined,
    VerticalAlignBottomOutlined,
    AlignLeftOutlined,
    AlignCenterOutlined,
    AlignRightOutlined,
    DeleteOutlined
} from '@ant-design/icons';

import { DEFAULT_NEW_NOTE_STYLE, Note, NoteBorderColor, NoteTextAlign, NoteVerticalAlign } from '../../model';
import {
    backgroundOptions, borderColorOptions, edgeOptions, fontSizeOptionsAround, shapeOptions
} from '../note-style-options';
import { colorSelectProps } from '../color-select';

export interface NoteEditToolbarProps {
    note: Note;
    onPatch: (patch: Partial<Note>) => void;
    onDelete: () => void;
}

const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();


const verticalAlignOptions: { value: NoteVerticalAlign; label: React.ReactNode }[] = [
    { value: 'top', label: <VerticalAlignTopOutlined /> },
    { value: 'middle', label: <VerticalAlignMiddleOutlined /> },
    { value: 'bottom', label: <VerticalAlignBottomOutlined /> }
];

const textAlignOptions: { value: NoteTextAlign; label: React.ReactNode }[] = [
    { value: 'left', label: <AlignLeftOutlined /> },
    { value: 'center', label: <AlignCenterOutlined /> },
    { value: 'right', label: <AlignRightOutlined /> }
];

const zIndexOptions = Array.from({ length: 10 }, (_, i) => ({ value: i, label: String(i) }));


export const NoteEditToolbar: React.FC<NoteEditToolbarProps> = ({ note, onPatch, onDelete }) => {
    const selectProps = useMemo(() => ({
        size: 'small' as const,
        style: { width: 'auto' } as React.CSSProperties,
        styles: { popup: { root: { zIndex: 10001 } } },
        popupMatchSelectWidth: false
    }), []);

    const fontSize = note.fontSize ?? DEFAULT_NEW_NOTE_STYLE.fontSize;
    const fontSizeOptions = useMemo(() => fontSizeOptionsAround(fontSize), [fontSize]);

    return (
        <div
            className="mindmap-note-edit-toolbar"
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onClick={stopPropagation}
        >
            <Select
                {...selectProps}
                value={note.verticalAlign ?? 'top'}
                options={verticalAlignOptions}
                onChange={(v) => onPatch({ verticalAlign: v })}
                title="Vertical alignment"
            />
            <Select
                {...selectProps}
                value={note.textAlign ?? 'center'}
                options={textAlignOptions}
                onChange={(v) => onPatch({ textAlign: v })}
                title="Horizontal alignment"
            />
            <Select
                {...selectProps}
                value={fontSize}
                options={fontSizeOptions}
                onChange={(v) => onPatch({ fontSize: v })}
                title="Text size"
            />
            <Select
                {...selectProps}
                value={note.edge ?? 'solid-1'}
                options={edgeOptions}
                onChange={(v) => onPatch({ edge: v })}
                title="Border weight"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={note.borderColor ?? ''}
                options={borderColorOptions}
                onChange={(v) => onPatch({ borderColor: (v || undefined) as NoteBorderColor })}
                title="Border color"
            />
            <Select
                {...selectProps}
                value={note.shape ?? 'rectangle'}
                options={shapeOptions}
                onChange={(v) => onPatch({ shape: v })}
                title="Shape"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={note.background ?? 'none'}
                options={backgroundOptions}
                onChange={(v) => onPatch({ background: v })}
                title="Background color"
            />
            <Select
                {...selectProps}
                value={note.zIndex ?? 3}
                options={zIndexOptions}
                onChange={(v) => onPatch({ zIndex: v })}
                title="Z-index"
            />
            <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={onDelete}
                title="Delete note"
            />
        </div>
    );
};
