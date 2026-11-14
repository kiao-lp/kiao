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

    it('should draw the rectangle empty and the triangle filled, as they are drawn on the map', () => {
        expect(pictureOf('rectangle').getAttribute('fill')).toBe('none');
        expect(pictureOf('triangle').getAttribute('fill')).toBe('currentColor');
    });
});

describe('bodyWidthOptionsAround', () => {
    it('should offer the plain list for a width that is already on it', () => {
        expect(bodyWidthOptionsAround(24)).toBe(bodyWidthOptions);
    });

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
