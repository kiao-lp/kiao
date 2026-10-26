import React from 'react';
import { Select } from 'antd';

import { useMindmapStateContext } from '../state';
import { colorSelectProps } from '../lib/color-select';
import {
    NewColor, NewColorSwatch, newColorOptions, noteStyleInColor, relationStyleInColor, sharedNewColor
} from '../lib/new-color';

/**
 * The colour the map is being drawn in: one choice standing for three — a new note's border, its
 * background, and a new relation — which is what colouring a map by hand nearly always wants. It
 * opens the bar, before the note's own style and the relation's own style, because what it sets
 * belongs to neither of them alone; the three selectors it moves stay where they are, for the map
 * that wants its fill and its ink to differ.
 *
 * It shows the colour when the three agree, and nothing when they do not — a selector claiming a
 * colour that only two of the three are actually set to would be a picture of a map that is not
 * being drawn. What it draws then, in place of a value, is the three as they stand.
 */
export const NewColorControl: React.FC = () => {
    const {
        newNoteStyle, patchNewNoteStyle, newRelationStyle, patchNewRelationStyle
    } = useMindmapStateContext();

    // The two go into one view state through the same synchronous store, so the pair of patches
    // lands as one change — see useFileViewState.
    const pickColor = (color: NewColor) => {
        patchNewNoteStyle(noteStyleInColor(color));
        patchNewRelationStyle(relationStyleInColor(color));
    };

    const shared = sharedNewColor(newNoteStyle, newRelationStyle);

    return (
        <Select
            // As its neighbours are: no width, so the box is exactly its swatch, and a popup
            // sized by what is in it rather than by a box that narrow.
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
            title="One colour for a new note's border and background and a new relation"
        />
    );
};
