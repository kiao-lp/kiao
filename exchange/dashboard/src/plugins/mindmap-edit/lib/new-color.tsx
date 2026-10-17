import React from 'react';

import {
    MindmapColor, MINDMAP_COLORS, colorTitle, NoteBackground, NewNoteStyle, NewRelationStyle
} from '../model';

/**
 * Combined note-border, fill, and relation colour. Empty means default ink and no fill.
 * The individual selectors may still differ.
 */
export type NewColor = MindmapColor | '';

/** null denotes mixed settings; the selector must display their actual colours. */
export const sharedNewColor = (
    { borderColor, background }: NewNoteStyle,
    { color }: NewRelationStyle
): NewColor | null => {
    if (borderColor === '' && background === 'none' && color === '') return '';
    return borderColor !== '' && background === borderColor && color === borderColor ? borderColor : null;
};

/** No fill is 'none' for backgrounds, but empty for border and relation ink. */
export const noteStyleInColor = (color: NewColor): Partial<NewNoteStyle> => ({
    borderColor: color,
    background: color === '' ? 'none' : color
});

export const relationStyleInColor = (color: NewColor): Partial<NewRelationStyle> => ({ color });

const ink = (color: NewColor) =>
    color ? `var(--mindmap-relation-${color})` : 'var(--mindmap-relation)';

/** Shows border, fill, and relation colours even when the settings differ. */
export const NewColorSwatch: React.FC<{
    borderColor: NewColor;
    background: NoteBackground;
    relation: NewColor;
}> = ({ borderColor, background, relation }) => (
    <span style={{
        display: 'inline-block',
        position: 'relative',
        width: 18, height: 14, borderRadius: 3,
        border: `2px solid ${ink(borderColor)}`,
        backgroundColor: background === 'none' ? 'transparent' : `var(--color-${background}-bg)`,
        verticalAlign: 'middle'
    }}>
        <span style={{
            position: 'absolute', insetInline: 0, top: 'calc(50% - 1.5px)', height: 3,
            backgroundColor: ink(relation)
        }} />
    </span>
);

/** Name swatches so options can be distinguished without relying on colour alone. */
export const newColorOptions: { value: string; label: React.ReactNode; title: string }[] = [
    {
        value: '',
        label: <NewColorSwatch borderColor="" background="none" relation="" />,
        title: 'Default'
    },
    ...MINDMAP_COLORS.map((color) => ({
        value: color as string,
        label: <NewColorSwatch borderColor={color} background={color} relation={color} />,
        title: colorTitle(color)
    }))
];
