import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DiamondNoteSvg } from './DiamondNoteSvg';
import { Note } from '../model';

const note = (edge?: Note['edge']): Note =>
    ({ id: 'NOTE-1', userBounds: [0, 0, 100, 60], content: 'a note', shape: 'diamond', edge });

const polygonOf = (container: HTMLElement) => container.querySelector('polygon') as SVGPolygonElement;

describe('DiamondNoteSvg outline', () => {
    it('outlines a note that names no edge as the one-pixel border every other shape gets', () => {
        const { container } = render(<DiamondNoteSvg element={note()} />);

        expect(polygonOf(container).getAttribute('stroke-width')).toBe('1');
        expect(polygonOf(container).getAttribute('stroke')).toBe('var(--mindmap-relation)');
    });

    it('draws the thinnest weight the same whether it was picked or left unsaid', () => {
        const unsaid = render(<DiamondNoteSvg element={note()} />).container;
        const picked = render(<DiamondNoteSvg element={note('solid-1')} />).container;

        expect(polygonOf(unsaid).getAttribute('stroke-width'))
            .toBe(polygonOf(picked).getAttribute('stroke-width'));
    });

    it('leaves a note with no border unoutlined', () => {
        const { container } = render(<DiamondNoteSvg element={note('none')} />);

        expect(polygonOf(container).getAttribute('stroke-width')).toBe('0');
        expect(polygonOf(container).getAttribute('stroke')).toBe('none');
    });

    it('gives each weight the width the stylesheet gives the other shapes', () => {
        const widthOf = (edge: Note['edge']) =>
            polygonOf(render(<DiamondNoteSvg element={note(edge)} />).container).getAttribute('stroke-width');

        expect(widthOf('solid-2')).toBe('2');
        expect(widthOf('solid-4')).toBe('4');
        expect(widthOf('solid-6')).toBe('6');
        expect(widthOf('solid-8')).toBe('8');
        expect(widthOf('dotted')).toBe('2');
    });
});
