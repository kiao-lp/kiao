import React, { useMemo } from 'react';
import { Button, Flex, Select } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { useSelectionContext } from '@cms-core';

import { useMindmapStateContext } from '../state';
import { useApplyStyleToSelection } from '../hooks/useNote';
import {
    backgroundOptions, borderColorOptions, edgeOptions, fontSizeOptions, shapeOptions
} from '../lib/note-style-options';
import { colorSelectProps } from '../lib/color-select';
import { NoteBorderColor } from '../model';

/**
 * The style the next note will be made with — text size, shape, border weight, border colour and
 * background. Notes come in series, so it is set once here rather than through each note's own
 * toolbar, and it is kept beside the zoom: both belong to the map as it is being worked on, not
 * to what is saved.
 *
 * The brush at its right hands that same style to the notes currently selected, which is how a
 * run of notes already drawn is brought into line without visiting each one's toolbar.
 */
export const NewNoteStyleControl: React.FC = () => {
    const { newNoteStyle, patchNewNoteStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();
    const applyStyleToSelection = useApplyStyleToSelection();

    // The banner takes the arrow and its gap off every select it holds (cms-core.css), and no
    // width is set here, so each box is exactly as wide as the swatch or the size it is showing.
    // The popup is sized by its own content instead: matched to a box that narrow, an item would
    // be nothing but its padding — see the style new relations are drawn in, beside this one.
    const selectProps = useMemo(() => ({
        size: 'small' as const,
        style: { width: 'auto' } as React.CSSProperties,
        popupMatchSelectWidth: false
    }), []);

    return (
        <Flex gap={4} align="center" className="mindmap-new-note-style">
            <Select
                {...selectProps}
                value={newNoteStyle.fontSize}
                options={fontSizeOptions}
                onChange={(fontSize) => patchNewNoteStyle({ fontSize })}
                title="Text size of a new note"
            />
            <Select
                {...selectProps}
                value={newNoteStyle.shape}
                options={shapeOptions}
                onChange={(shape) => patchNewNoteStyle({ shape })}
                title="Shape of a new note"
            />
            <Select
                {...selectProps}
                value={newNoteStyle.edge}
                options={edgeOptions}
                onChange={(edge) => patchNewNoteStyle({ edge })}
                title="Border weight of a new note"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={newNoteStyle.borderColor}
                options={borderColorOptions}
                onChange={(borderColor: NoteBorderColor | '') => patchNewNoteStyle({ borderColor })}
                title="Border colour of a new note"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={newNoteStyle.background}
                options={backgroundOptions}
                onChange={(background) => patchNewNoteStyle({ background })}
                title="Background colour of a new note"
            />
            <Button
                size="small"
                type="text"
                icon={<FormatPainterOutlined />}
                disabled={selection.length === 0}
                onClick={applyStyleToSelection}
                title="Apply this style to the selected notes"
            />
        </Flex>
    );
};
