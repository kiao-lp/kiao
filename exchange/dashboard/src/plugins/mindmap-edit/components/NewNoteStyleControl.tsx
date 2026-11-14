import React, { useMemo } from 'react';
import { Button, Flex, Select } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { useSelectionContext } from '@kiao-dashboard-core';

import { useMindmapStateContext } from '../state';
import { useApplyStyleToSelection } from '../hooks/useNote';
import {
    backgroundOptions, borderColorOptions, edgeOptions, fontSizeOptions, shapeOptions
} from '../lib/note-style-options';
import { colorSelectProps } from '../lib/color-select';
import { NoteBorderColor } from '../model';

/** The style the next note will be made with — text size, shape, border weight, border colour. */
export const NewNoteStyleControl: React.FC = () => {
    const { newNoteStyle, patchNewNoteStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();
    const applyStyleToSelection = useApplyStyleToSelection();

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
                aria-label="Text size of a new note"
            />
            <Select
                {...selectProps}
                value={newNoteStyle.shape}
                options={shapeOptions}
                onChange={(shape) => patchNewNoteStyle({ shape })}
                aria-label="Shape of a new note"
            />
            <Select
                {...selectProps}
                value={newNoteStyle.edge}
                options={edgeOptions}
                onChange={(edge) => patchNewNoteStyle({ edge })}
                aria-label="Border weight of a new note"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={newNoteStyle.borderColor}
                options={borderColorOptions}
                onChange={(borderColor: NoteBorderColor | '') => patchNewNoteStyle({ borderColor })}
                aria-label="Border colour of a new note"
            />
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={newNoteStyle.background}
                options={backgroundOptions}
                onChange={(background) => patchNewNoteStyle({ background })}
                aria-label="Background colour of a new note"
            />
            <Button
                size="small"
                type="text"
                icon={<FormatPainterOutlined />}
                disabled={selection.length === 0}
                onClick={applyStyleToSelection}
                aria-label="Apply this style to the selected notes"
            />
        </Flex>
    );
};
