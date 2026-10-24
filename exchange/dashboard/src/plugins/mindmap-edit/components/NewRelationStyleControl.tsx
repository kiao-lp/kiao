import React, { useMemo } from 'react';
import { Button, Flex, Select } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { useSelectionContext } from '@cms-core';

import { useMindmapStateContext } from '../state';
import { useApplyRelationStyleToSelection } from '../hooks/useRelation';
import { NewRelationBody, RelationColor } from '../model';
import { bodyWidthOptions, newRelationBodyOptions, relationColorOptions } from '../lib/relation-style-options';
import { colorSelectProps } from '../lib/color-select';

/**
 * The style the next relation will be drawn in — the shape of its body, how wide that is, and its
 * colour. Relations come in series as notes do, so the choice is made once here rather than
 * through each relation's own menu, and it is kept beside the style new notes are made with:
 * both belong to the map as it is being worked on, not to what is saved.
 *
 * A choice with nothing to say is not shown: a line, being stroked rather than filled, has no
 * width to pick — the same rule the relation's own menu goes by.
 *
 * The brush at its right hands that same style to the relations currently selected, as the one
 * beside it does for notes: a run of relations already drawn is brought into line in one gesture
 * rather than through each of their menus in turn.
 */
export const NewRelationStyleControl: React.FC = () => {
    const { newRelationStyle, patchNewRelationStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();
    const applyStyleToSelection = useApplyRelationStyleToSelection();

    // As for the note style beside it, no width is set, so each box is exactly as wide as the
    // picture or the number it shows. The popup takes its width from what is in it rather than
    // from the box, which would leave an item nothing but its own padding — see the relation menu.
    const selectProps = useMemo(() => ({
        size: 'small' as const,
        style: { width: 'auto' } as React.CSSProperties,
        popupMatchSelectWidth: false
    }), []);

    return (
        <Flex gap={4} align="center" className="mindmap-new-relation-style">
            <Select
                {...selectProps}
                value={newRelationStyle.body}
                options={newRelationBodyOptions}
                onChange={(body: NewRelationBody) => patchNewRelationStyle({ body })}
                title="Body of a new relation"
            />
            {newRelationStyle.body !== 'line' && <Select
                {...selectProps}
                value={newRelationStyle.width}
                options={bodyWidthOptions}
                onChange={(width: number) => patchNewRelationStyle({ width })}
                title="Body width of a new relation"
            />}
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={newRelationStyle.color}
                options={relationColorOptions}
                onChange={(color: RelationColor | '') => patchNewRelationStyle({ color })}
                title="Colour of a new relation"
            />
            <Button
                size="small"
                type="text"
                icon={<FormatPainterOutlined />}
                disabled={selection.length === 0}
                onClick={applyStyleToSelection}
                title="Apply this style to the selected relations"
            />
        </Flex>
    );
};
