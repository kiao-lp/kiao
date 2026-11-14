import React from 'react';

import { NewRelationBody, RelationBody, RelationColor, MINDMAP_COLORS, colorTitle } from '../model';

/**
 * The choices offered for a relation's look, drawn rather than named — a body is a picture of.
 * The two families are apart because a relation has no border weight and no text, and a note is not.
 */

const previewStyle: React.CSSProperties = { verticalAlign: 'middle' };

/** The shapes, each drawn along the same little curve so that the picture says the other half of what. */
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

/** The same shapes, with the triangle offered both ways round — what a relation about to be made is. */
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

/** The same widths, plus the one the relation is actually at when the wheel has walked it off the list. */
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

/** The colours, the first being the one every relation is drawn in. */
export const relationColorOptions: { value: string; label: React.ReactNode; title: string }[] = [
    { value: '', label: <ColorSwatch />, title: 'Default' },
    ...MINDMAP_COLORS.map((color) => ({
        value: color as string,
        label: <ColorSwatch color={color as RelationColor} />,
        title: colorTitle(color)
    }))
];
