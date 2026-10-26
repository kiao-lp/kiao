import React from 'react';
import { Note, NoteEdge, NoteBackground, NoteBorderColor } from '../model';

interface DiamondNoteSvgProps {
    element: Note;
}

const getStrokeDashArray = (edge?: NoteEdge) => {
    switch (edge) {
        case 'dotted': return '4, 4';
        default: return undefined;
    }
};

/**
 * The weight of the outline, in the widths `note-edge-*` gives the other shapes. A note that
 * names no edge is one at `solid-1` — that is what `.mindmap-rect` draws it with and what its
 * toolbar shows for it — so an absent edge is one pixel here too, and not nothing. Drawn as
 * nothing, a diamond had no outline until a weight had been picked, and picking the very weight
 * it was already claiming to be at was what made it appear.
 */
const getStrokeWidth = (edge?: NoteEdge) => {
    switch (edge) {
        case 'none': return 0;
        case 'dotted': return 2;
        case 'solid-2': return 2;
        case 'solid-4': return 4;
        case 'solid-6': return 6;
        case 'solid-8': return 8;
        case 'solid-1':
        default: return 1;
    }
};

/**
 * A diamond is drawn here rather than by the stylesheet, so the fill and the ink the rules in
 * styles.css would have given it are named here instead — from the very same theme variables, so
 * the ten colours are one palette however the note is shaped.
 */
const getFillColor = (bg?: NoteBackground) => {
    if (bg === 'none') return 'transparent';
    return bg ? `var(--color-${bg}-bg)` : 'var(--accent-bg)';
};

const getStrokeColor = (borderColor?: NoteBorderColor) =>
    borderColor ? `var(--mindmap-relation-${borderColor})` : 'var(--mindmap-relation)';

export const DiamondNoteSvg: React.FC<DiamondNoteSvgProps> = React.memo(({ element }) => {
    const strokeWidth = getStrokeWidth(element.edge);
    const strokeDashArray = getStrokeDashArray(element.edge);
    const fill = getFillColor(element.background);

    // If edge is none, or we don't have an edge, we might still want a transparent stroke or just 0 width
    const stroke = strokeWidth > 0 ? getStrokeColor(element.borderColor) : 'none';

    return (
        <svg
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none', // excessive clicking through? maybe not needed if it's just background
                zIndex: -1 // Ensure it sits behind text (positioned vs static stacking)
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
        >
            <polygon
                points="50,0 100,50 50,100 0,50"
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDashArray}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
});
