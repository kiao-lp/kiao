import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const svgState = vi.hoisted(() => ({ value: null as any }));
const selectionState = vi.hoisted(() => ({ value: ['r1'] as string[], set: vi.fn() }));

vi.mock('../state', async () => {
    const actual = await vi.importActual<typeof import('../state')>('../state');
    return { ...actual, useSvgStateContext: () => svgState.value };
});

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [selectionState.value, selectionState.set],
}));

import { useArrowKeyMove } from './useArrowKeyMove';

const Probe: React.FC = () => {
    useArrowKeyMove();
    return null;
};

const drawingOf = () => ({
    canvas: { width: 800, height: 600 },
    nodes: [
        { kind: 'shape', shape: { id: 'r1', tag: 'rect', attrs: { x: '10', y: '20', width: '120', height: '60' } } },
        { kind: 'shape', shape: { id: 't1', tag: 'text', text: 'Hi', attrs: { x: '10', y: '20', 'font-size': '20' } } },
    ],
});

const spies = vi.hoisted(() => ({ setDocument: vi.fn(), saveSvg: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    selectionState.value = ['r1'];
    svgState.value = {
        document: { drawing: drawingOf(), rootAttrs: {} },
        setDocument: spies.setDocument,
        saveSvg: spies.saveSvg,
        mode: 'canvas',
    };
});

// Rendered per test, after the selection is set: the mocked selection has no
// reactivity of its own, so a value assigned after render would never arrive.
const show = () => render(<Probe />);

const press = (key: string, init: KeyboardEventInit = {}) => {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });
};

const applied = () => spies.setDocument.mock.calls[0][0](svgState.value.document);

describe('useArrowKeyMove with Alt', () => {
    it('widens the shape on Alt+ArrowRight instead of moving it', () => {
        show();
        press('ArrowRight', { altKey: true });
        expect(spies.setDocument).toHaveBeenCalledTimes(1);
        const rect = applied().drawing.nodes[0].shape;
        expect(rect.attrs.width).toBe('130');
        expect(rect.attrs.x).toBe('5');
        expect(spies.saveSvg).toHaveBeenCalled();
    });

    it('shortens the shape on Alt+ArrowUp', () => {
        show();
        press('ArrowUp', { altKey: true });
        const rect = applied().drawing.nodes[0].shape;
        expect(rect.attrs.height).toBe('50');
    });

    it('grows the font of a text on Alt+ArrowUp', () => {
        selectionState.value = ['t1'];
        show();
        press('ArrowUp', { altKey: true });
        const text = applied().drawing.nodes[1].shape;
        expect(text.attrs['font-size']).toBe('22');
    });

    it('shrinks the font of a text on Alt+ArrowDown', () => {
        selectionState.value = ['t1'];
        show();
        press('ArrowDown', { altKey: true });
        const text = applied().drawing.nodes[1].shape;
        expect(text.attrs['font-size']).toBe('18');
    });

    it('still moves on a bare arrow', () => {
        show();
        press('ArrowRight');
        const rect = applied().drawing.nodes[0].shape;
        expect(rect.attrs.x).toBe('16');
        expect(rect.attrs.width).toBe('120');
    });
});
