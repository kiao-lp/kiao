import React from 'react';
import { Select } from 'antd';

import { useMindmapStateContext } from '../state';
import { colorSelectProps } from '../lib/color-select';
import {
    NewColor, NewColorSwatch, newColorOptions, noteStyleInColor, relationStyleInColor, sharedNewColor
} from '../lib/new-color';

/**
 * The colour the map is being drawn in: one choice standing for three — a new note's border, its.
 * It opens the bar, before the note's own style and the relation's own style, because what it sets.
 */
export const NewColorControl: React.FC = () => {
    const {
        newNoteStyle, patchNewNoteStyle, newRelationStyle, patchNewRelationStyle
    } = useMindmapStateContext();

    const pickColor = (color: NewColor) => {
        patchNewNoteStyle(noteStyleInColor(color));
        patchNewRelationStyle(relationStyleInColor(color));
    };

    const shared = sharedNewColor(newNoteStyle, newRelationStyle);

    return (
        <Select
            size="small"
            style={{ width: 'auto' }}
            popupMatchSelectWidth={false}
            {...colorSelectProps}
            value={shared ?? undefined}
            placeholder={<NewColorSwatch
                borderColor={newNoteStyle.borderColor}
                background={newNoteStyle.background}
                relation={newRelationStyle.color} />}
            options={newColorOptions}
            onChange={pickColor}
            aria-label="One colour for a new note's border and background and a new relation"
        />
    );
};
