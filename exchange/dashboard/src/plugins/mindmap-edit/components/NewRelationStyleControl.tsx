import React, { useMemo } from 'react';
import { Button, Flex, Select } from 'antd';
import { FormatPainterOutlined } from '@ant-design/icons';
import { useSelectionContext } from '@cms-core';

import { useMindmapStateContext } from '../state';
import { useApplyRelationStyleToSelection } from '../hooks/useRelation';
import { NewRelationBody, RelationColor } from '../model';
import { bodyWidthOptions, newRelationBodyOptions, relationColorOptions } from '../lib/relation-style-options';
import { colorSelectProps } from '../lib/color-select';

/** The style the next relation will be drawn in — the shape of its body, how wide that is, and its. */
export const NewRelationStyleControl: React.FC = () => {
    const { newRelationStyle, patchNewRelationStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();
    const applyStyleToSelection = useApplyRelationStyleToSelection();

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
