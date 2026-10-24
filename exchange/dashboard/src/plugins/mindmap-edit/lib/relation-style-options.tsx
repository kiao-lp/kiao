import React from 'react';

import { NewRelationBody, RelationBody, RelationColor, MINDMAP_COLORS, colorTitle } from '../model';

/**
 * The choices offered for a relation's look, drawn rather than named — a body is a picture of the
 * shape it means, a colour a swatch of itself — as a note's own choices are in note-style-options.
 * The two families are apart because a relation has no border weight and no text, and a note is
 * not drawn along a curve. What they do share is the palette, which is the model's `MINDMAP_COLORS`
 * and neither file's: a red note and a red relation have to be the same red.
 */

const previewStyle: React.CSSProperties = { verticalAlign: 'middle' };

/**
 * The shapes, each drawn along the same little curve so that the picture says the other half of
 * what the choice means: the body follows the relation rather than lying across it. The rectangle
 * is empty and the triangles are filled, as they are on the map — a picture of a choice that is
 * not the choice is worse than a word for it. The triangle comes to a point at the left, which is
 * the end the relation is drawn from, and the reversed one is that very picture mirrored — the
 * two read as one choice made either way round.
 */
const bodyPaths: Record<Exclude<NewRelationBody, 'line'>, string> = {
    rectangle: 'M 2 8 Q 12 -2 22 8 L 22 13 Q 12 3 2 13 Z',
    triangle: 'M 2 12 Q 12 0 22 6 L 22 18 Q 12 6 2 12 Z',
    'triangle-reversed': 'M 22 12 Q 12 0 2 6 L 2 18 Q 12 6 22 12 Z'
};

const BodyPreview: React.FC<{ body: NewRelationBody }> = ({ body }) => {
    const curve = 'M 2 12 Q 12 0 22 12';

    if (body === 'line') {
        return (
            <svg width="24" height="14" style={previewStyle}>
                <path d={curve} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        );
    }

    // The empty one is drawn inside the box rather than up to its edge: an outline running off it
    // is a shape with a side missing, where a filled one is simply a shape that fills the box.
    if (body === 'rectangle') {
        return (
            <svg width="24" height="14" style={previewStyle}>
                <path d={bodyPaths.rectangle} fill="none" stroke="currentColor" strokeWidth="1.5"
                    strokeLinejoin="round" />
            </svg>
        );
    }

    return (
        <svg width="24" height="14" style={previewStyle}>
            <path d={bodyPaths[body]} fill="currentColor" />
        </svg>
    );
};

export const bodyOptions: { value: RelationBody; label: React.ReactNode; title: string }[] = [
    { value: 'line', label: <BodyPreview body="line" />, title: 'Line' },
    { value: 'rectangle', label: <BodyPreview body="rectangle" />, title: 'Rectangle' },
    { value: 'triangle', label: <BodyPreview body="triangle" />, title: 'Triangle' }
];

/**
 * The same shapes, with the triangle offered both ways round — what a relation about to be made
 * is chosen from. A relation is drawn from one note to another, so which end the point sits at is
 * a choice there; a relation already on the map is simply turned round from its own menu, which
 * is why that menu offers the three and this offers four.
 */
export const newRelationBodyOptions: { value: NewRelationBody; label: React.ReactNode; title: string }[] = [
    ...bodyOptions,
    {
        value: 'triangle-reversed',
        label: <BodyPreview body="triangle-reversed" />,
        title: 'Triangle the other way round'
    }
];

/** The widths a body is offered, in the steps the wheel over a relation walks through. */
export const bodyWidthOptions = [8, 12, 16, 24, 32, 48, 64]
    .map((width) => ({ value: width, label: String(width), title: String(width) }));

/**
 * The same widths, plus the one the relation is actually at when the wheel has walked it off the
 * list. A selector built on these reads the relation as it is rather than the nearest offered
 * width, and stays a way of putting it back onto one.
 */
export const bodyWidthOptionsAround = (width: number) =>
    bodyWidthOptions.some((option) => option.value === width)
        ? bodyWidthOptions
        : [...bodyWidthOptions, { value: width, label: String(width), title: String(width) }]
            .sort((a, b) => a.value - b.value);

const ColorSwatch: React.FC<{ color?: RelationColor }> = ({ color }) => (
    <span style={{
        display: 'inline-block',
        width: 18, height: 10, borderRadius: 2,
        verticalAlign: 'middle',
        backgroundColor: color ? `var(--mindmap-relation-${color})` : 'var(--mindmap-relation)'
    }} />
);

/**
 * The colours, the first being the one every relation is drawn in. It is offered as a swatch of
 * itself rather than as an empty box: it is a colour like the others, and the one to come back to.
 */
export const relationColorOptions: { value: string; label: React.ReactNode; title: string }[] = [
    { value: '', label: <ColorSwatch />, title: 'Default' },
    ...MINDMAP_COLORS.map((color) => ({
        value: color as string,
        label: <ColorSwatch color={color as RelationColor} />,
        title: colorTitle(color)
    }))
];
