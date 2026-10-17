import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MINDMAP_COLORS, RelationBody } from '../model';
import {
    bodyOptions, bodyWidthOptions, bodyWidthOptionsAround, newRelationBodyOptions, relationColorOptions
} from './relation-style-options';

describe('bodyOptions', () => {
    const pictureOf = (body: RelationBody) => {
        const { container } = render(<>{bodyOptions.find((option) => option.value === body)!.label}</>);
        return container.querySelector('path')!;
    };

    // The picture is the whole of what the choice is read by, so it has to be the shape the map
    // draws — and the map draws a rectangle as an empty one, its own outline and no ink inside.
    it('should draw the rectangle empty and the triangle filled, as they are drawn on the map', () => {
        expect(pictureOf('rectangle').getAttribute('fill')).toBe('none');
        expect(pictureOf('triangle').getAttribute('fill')).toBe('currentColor');
    });
});

describe('bodyWidthOptionsAround', () => {
    it('should offer the plain list for a width that is already on it', () => {
        expect(bodyWidthOptionsAround(24)).toBe(bodyWidthOptions);
    });

    // The wheel over a relation steps by whatever the wheel gives, so a body often sits between
    // the offered widths, and the selector has to read the relation as it is.
    it('should offer the width the wheel left it at, in its place among the others', () => {
        const around = bodyWidthOptionsAround(28);

        expect(around.map((option) => option.value)).toEqual([8, 12, 16, 24, 28, 32, 48, 64]);
        expect(around.find((option) => option.value === 28)?.label).toBe('28');
    });

    it('should leave the plain list untouched', () => {
        bodyWidthOptionsAround(28);
        expect(bodyWidthOptions).toHaveLength(7);
    });
});

describe('relationColorOptions', () => {
    // The first is the colour every relation is drawn in, and choosing it takes the field off —
    // which is why it is the empty value rather than a name of its own.
    it('should offer the colour a relation has when it says nothing, as the empty value', () => {
        expect(relationColorOptions[0].value).toBe('');
        expect(relationColorOptions.map((option) => option.value))
            .toEqual(['', ...MINDMAP_COLORS]);
    });

    it('should name every colour it draws, there being nothing but a swatch to go by', () => {
        expect(relationColorOptions.every((option) => option.title.length > 0)).toBe(true);
    });
});

describe('newRelationBodyOptions', () => {
    // A relation is made from one note towards another, so the triangle is a choice either way
    // round there; a relation already drawn is turned round from its own menu, which offers three.
    it('should offer the three shapes a relation can take, the triangle both ways round', () => {
        expect(newRelationBodyOptions.map((option) => option.value))
            .toEqual(['line', 'rectangle', 'triangle', 'triangle-reversed']);
    });

    it('should offer the very options the relation menu offers for the shapes it shares', () => {
        expect(newRelationBodyOptions.slice(0, bodyOptions.length)).toEqual(bodyOptions);
    });

    it('should name every shape it draws, there being nothing but a picture to go by', () => {
        expect(newRelationBodyOptions.every((option) => option.title.length > 0)).toBe(true);
    });
});
