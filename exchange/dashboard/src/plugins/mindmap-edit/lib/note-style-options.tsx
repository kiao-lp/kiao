import React from 'react';

import { NoteShape, NoteEdge, NoteBackground, NoteBorderColor, MINDMAP_COLORS, colorTitle } from '../model';

/**
 * The choices offered for a note's look, drawn rather than named: a border weight is a line of
 * that weight, a background a swatch of that colour, a border colour a box outlined in it.
 * Shared by the toolbar of the note being edited and by the style new notes are made with, so
 * the two never drift apart.
 */

const EdgePreview: React.FC<{ edge: NoteEdge }> = ({ edge }) => {
    if (edge === 'none') {
        return <span style={{ display: 'inline-block', width: 28, opacity: 0.5 }}>—</span>;
    }
    if (edge === 'dotted') {
        return <span style={{
            display: 'inline-block', width: 28, height: 0,
            borderTop: '2px dotted currentColor', verticalAlign: 'middle'
        }} />;
    }
    const weight = parseInt(edge.replace('solid-', ''), 10);
    return <span style={{
        display: 'inline-block', width: 28, height: 0,
        borderTop: `${weight}px solid currentColor`, verticalAlign: 'middle'
    }} />;
};

export const edgeOptions: { value: NoteEdge; label: React.ReactNode }[] = [
    'none', 'dotted', 'solid-1', 'solid-2', 'solid-4', 'solid-6', 'solid-8'
].map((v) => ({ value: v as NoteEdge, label: <EdgePreview edge={v as NoteEdge} /> }));

const shapeSvgStyle: React.CSSProperties = { verticalAlign: 'middle' };

const ShapePreview: React.FC<{ shape: NoteShape }> = ({ shape }) => {
    const stroke = 'currentColor';
    switch (shape) {
        case 'ellipse':
            return (
                <svg width="20" height="14" style={shapeSvgStyle}>
                    <ellipse cx="10" cy="7" rx="9" ry="6" fill="none" stroke={stroke} strokeWidth="1.5" />
                </svg>
            );
        case 'rectangle':
            return (
                <svg width="20" height="14" style={shapeSvgStyle}>
                    <rect x="1" y="1" width="18" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" />
                </svg>
            );
        case 'diamond':
            return (
                <svg width="20" height="14" style={shapeSvgStyle}>
                    <polygon points="10,1 19,7 10,13 1,7" fill="none" stroke={stroke} strokeWidth="1.5" />
                </svg>
            );
    }
};

export const shapeOptions: { value: NoteShape; label: React.ReactNode }[] = [
    { value: 'ellipse', label: <ShapePreview shape="ellipse" /> },
    { value: 'rectangle', label: <ShapePreview shape="rectangle" /> },
    { value: 'diamond', label: <ShapePreview shape="diamond" /> }
];

const BackgroundSwatch: React.FC<{ bg: NoteBackground }> = ({ bg }) => {
    const common: React.CSSProperties = {
        display: 'inline-block',
        width: 18, height: 14, borderRadius: 3,
        border: '1px solid var(--mindmap-relation)',
        verticalAlign: 'middle'
    };
    if (bg === 'none') {
        return <span style={{
            ...common,
            backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, currentColor 3px 4px)',
            opacity: 0.6
        }} />;
    }
    return <span style={{ ...common, backgroundColor: `var(--color-${bg}-bg)` }} />;
};

/**
 * The ten fills, and no fill at all — offered first, being what a note is drawn with when it has
 * not been coloured. Each is named as well as drawn: ten swatches are told apart by eye only up
 * to a point, and the name is what a list of them can be spoken and searched by.
 */
export const backgroundOptions: { value: NoteBackground; label: React.ReactNode; title: string }[] = [
    { value: 'none', label: <BackgroundSwatch bg="none" />, title: 'None' },
    ...MINDMAP_COLORS.map((color) => ({
        value: color as NoteBackground,
        label: <BackgroundSwatch bg={color} />,
        title: colorTitle(color)
    }))
];

/**
 * A border, drawn as the box it outlines rather than as a filled swatch: the choice is a colour
 * of ink and not of fill, and the picture says which of the two it is. The first is the colour
 * every border is drawn in, offered as a swatch of itself as the relation's default is — it is a
 * colour like the others, and the one to come back to.
 */
const BorderSwatch: React.FC<{ color?: NoteBorderColor }> = ({ color }) => (
    <span style={{
        display: 'inline-block',
        width: 18, height: 14, borderRadius: 3,
        border: `2px solid ${color ? `var(--mindmap-relation-${color})` : 'var(--mindmap-relation)'}`,
        verticalAlign: 'middle'
    }} />
);

export const borderColorOptions: { value: string; label: React.ReactNode; title: string }[] = [
    { value: '', label: <BorderSwatch />, title: 'Default' },
    ...MINDMAP_COLORS.map((color) => ({
        value: color as string,
        label: <BorderSwatch color={color} />,
        title: colorTitle(color)
    }))
];

/**
 * Text sizes, in the steps the `txt+` and `txt-` commands walk through, around the 20 pixels a
 * note that says nothing is drawn at.
 */
export const fontSizeOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40]
    .map((size) => ({ value: size, label: String(size) }));

/**
 * The same sizes, plus the one the note is actually at when `txt+` and `txt-` have walked it off
 * the list — 22, 26, 34. A selector built on these therefore reads the note as it is rather than
 * the nearest round number, and remains a way of putting it back onto a known size.
 */
export const fontSizeOptionsAround = (size: number) =>
    fontSizeOptions.some((option) => option.value === size)
        ? fontSizeOptions
        : [...fontSizeOptions, { value: size, label: String(size) }].sort((a, b) => a.value - b.value);
