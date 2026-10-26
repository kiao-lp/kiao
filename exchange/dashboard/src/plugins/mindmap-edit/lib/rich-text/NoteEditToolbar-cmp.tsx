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

// --- The options this toolbar defines itself; those for a note's look come from note-style-options ---

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

// --- Toolbar component ---

export const NoteEditToolbar: React.FC<NoteEditToolbarProps> = ({ note, onPatch, onDelete }) => {
    // A box that shows its value and nothing else is as wide as that value: no width of its own,
    // so it hugs the swatch or the two digits it draws. styles.css takes the arrow and its gap off
    // these selectors; a set width would have put the same slack back on the right of every one.
    // The popup takes its width from what is in it rather than from that box, which is barely
    // wider than one swatch and would clip every item down to its own padding.
    const selectProps = useMemo(() => ({
        size: 'small' as const,
        style: { width: 'auto' } as React.CSSProperties,
        styles: { popup: { root: { zIndex: 10001 } } },
        popupMatchSelectWidth: false
    }), []);

    // The size the note is drawn at, whether or not it is one of the offered ones: `txt+` and
    // `txt-` step by two, so a note often sits between them, and the selector has to say so.
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
