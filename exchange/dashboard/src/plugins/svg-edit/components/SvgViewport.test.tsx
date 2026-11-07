import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { decodeSvg } from '../svgDocument';
import { reactPropsOf, styleObjectOf } from './SvgShapeView';

const svgState = vi.hoisted(() => ({ value: null as any }));

vi.mock('../state', async () => {
    const actual = await vi.importActual<typeof import('../state')>('../state');
    return { ...actual, useSvgStateContext: () => svgState.value };
});

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [[], vi.fn()],
}));

import { SvgViewport } from './SvgViewport';

const show = (source: string) => {
    svgState.value = {
        document: decodeSvg(source),
        setDocument: vi.fn(),
        saveSvg: vi.fn(),
        patchShape: vi.fn(),
        measured: {},
        reportMeasured: vi.fn(),
        mode: 'canvas',
        zoom: 1,
        setZoom: vi.fn(),
    };
    return render(<SvgViewport />);
};

describe('styleObjectOf', () => {
    it('parses declarations into a React style object', () => {
        expect(styleObjectOf('fill: red; stroke-width: 2;')).toEqual({ fill: 'red', strokeWidth: '2' });
    });

    it('keeps custom properties verbatim', () => {
        expect(styleObjectOf('--k-bg:#020411;')).toEqual({ '--k-bg': '#020411' });
    });

    it('tolerates empty and malformed declarations', () => {
        expect(styleObjectOf('')).toEqual({});
        expect(styleObjectOf(';;;')).toEqual({});
        expect(styleObjectOf('fill')).toEqual({});
        expect(styleObjectOf('fill:; : red;')).toEqual({});
    });
});

describe('reactPropsOf', () => {
    it('maps attribute names but leaves style out', () => {
        expect(reactPropsOf({ 'stroke-width': '2', class: 'cluster' }))
            .toEqual({ strokeWidth: '2', className: 'cluster' });
        expect(reactPropsOf({ style: 'fill: red;' })).toEqual({});
    });
});

describe('SvgViewport with styled files', () => {
    it('mounts a file whose root carries a style attribute', () => {
        const { container } = show(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"'
            + ' style="width:810px;background:#F9FAFB;">'
            + '<rect x="10" y="20" width="120" height="60" fill="red"/></svg>',
        );
        const canvas = container.querySelector('.svg-canvas');
        expect(canvas).not.toBeNull();
        expect((canvas as SVGSVGElement).style.getPropertyValue('background')).toBe('rgb(249, 250, 251)');
    });

    it('keeps its own class beside the root one', () => {
        const { container } = show(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" class="archdia-svg">'
            + '<rect x="10" y="20" width="120" height="60"/></svg>',
        );
        const canvas = container.querySelector('svg');
        expect(canvas?.classList.contains('svg-canvas')).toBe(true);
        expect(canvas?.classList.contains('archdia-svg')).toBe(true);
    });

    it('applies a shape style under the move cursor', () => {
        const { container } = show(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">'
            + '<rect x="10" y="20" width="120" height="60" style="fill: red; stroke-width: 2;"/></svg>',
        );
        const rect = container.querySelector('[data-shape-id]');
        expect(rect).not.toBeNull();
        const style = (rect as SVGRectElement).style;
        expect(style.getPropertyValue('fill')).toBe('red');
        expect(style.getPropertyValue('stroke-width')).toBe('2');
        expect(style.getPropertyValue('cursor')).toBe('move');
    });
});
